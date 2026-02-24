import { getSupabaseAdminClient } from './supabaseAdmin.js';

export type ConversationRole = 'user' | 'assistant' | 'tool';
export type ConversationStorageMode = 'database' | 'memory_fallback';
export type ConversationReviewStatus = 'unprocessed' | 'ready' | 'processed';

export interface ConversationTurn {
  role: ConversationRole;
  content: string;
  at: string;
  channel?: string;
  source?: string;
  reasoning?: string;
}

export interface ConversationSessionRecord {
  session_id: string;
  answers: Record<string, unknown>;
  asked_keys: string[];
  transcript: ConversationTurn[];
  last_question_key: string | null;
  review_notes: string;
  review_status: ConversationReviewStatus;
  created_at: string;
  updated_at: string;
}

const TABLE_NAME = 'estimate_sessions';
const memorySessions = new Map<string, ConversationSessionRecord>();
let storageMode: ConversationStorageMode = 'memory_fallback';
const DEFAULT_REVIEW_STATUS: ConversationReviewStatus = 'unprocessed';
const CHANNEL_PREFIX_RE = /^\[(web|voice|sms|test)\]\s*/i;
const DEDUPE_WINDOW_MS = 20_000;

type ConversationChannel = 'web' | 'voice' | 'sms' | 'test' | 'unknown';

type ParsedConversationContent = {
  channel: ConversationChannel;
  stripped: string;
  canonical: string;
};

function coerceReviewStatus(value: unknown): ConversationReviewStatus {
  if (value === 'ready') return 'ready';
  if (value === 'processed') return 'processed';
  if (value === 'unprocessed') return 'unprocessed';
  return DEFAULT_REVIEW_STATUS;
}

function normalizeReviewNotes(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nowIso(): string {
  return new Date().toISOString();
}

function isMissingTableError(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes(TABLE_NAME) &&
    (text.includes('does not exist') || text.includes('relation') || text.includes('schema cache') || text.includes('could not find'))
  );
}

function isReviewColumnMissingError(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes('column') &&
    (text.includes('review_status') || text.includes('review_notes')) &&
    (text.includes('does not exist') || text.includes('could not find'))
  );
}

function isConnectivityError(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes('fetch failed') ||
    text.includes('enotfound') ||
    text.includes('econnrefused') ||
    text.includes('network') ||
    text.includes('failed to fetch')
  );
}

function mapSupabaseErrorMessage(message: string): string {
  if (isConnectivityError(message)) {
    return 'Supabase connection failed. Verify SUPABASE_URL points to an active project and SUPABASE_SERVICE_ROLE_KEY matches that same project.';
  }

  return message;
}

function shouldFallbackToMemory(message: string): boolean {
  return isConnectivityError(message) || isMissingTableError(message);
}

function baseSessionSelect(includeReviewFields: boolean): string {
  return includeReviewFields
    ? 'session_id, answers, asked_keys, transcript, last_question_key, review_notes, review_status, created_at, updated_at'
    : 'session_id, answers, asked_keys, transcript, last_question_key, created_at, updated_at';
}

async function maybeFetchWithMissingReviewColumnsFallback<T>(
  queryWithReviewFields: () => Promise<{ data: T | null; error: { message: string } | null }>,
  queryWithoutReviewFields: () => Promise<{ data: T | null; error: { message: string } | null }>
): Promise<{ data: T | null; usedFallbackProjection: boolean; error: { message: string } | null }> {
  const withReview = await queryWithReviewFields();
  if (!withReview.error) {
    return { data: withReview.data, usedFallbackProjection: false, error: null };
  }

  if (isReviewColumnMissingError(withReview.error.message)) {
    const without = await queryWithoutReviewFields();
    return {
      data: without.data,
      usedFallbackProjection: true,
      error: without.error,
    };
  }

  return { data: withReview.data, usedFallbackProjection: false, error: withReview.error };
}

function asQueryResult<T>(response: unknown): { data: T | null; error: { message: string } | null } {
  const cast = response as { data: T | null; error?: { message?: unknown } | null };

  if (!cast || cast.error == null) {
    return { data: cast?.data ?? null, error: null };
  }

  if (typeof cast.error.message === 'string' && cast.error.message.trim()) {
    return { data: cast.data, error: { message: cast.error.message } };
  }

  const fallback = JSON.stringify(cast.error);
  return {
    data: cast.data,
    error: {
      message:
        typeof fallback === 'string' && fallback.length > 0
          ? fallback
          : 'Supabase request failed.',
    },
  };
}

type SessionRow = {
  session_id?: string;
  answers?: unknown;
  asked_keys?: unknown;
  transcript?: unknown;
  last_question_key?: string | null;
  review_notes?: unknown;
  review_status?: unknown;
  created_at?: string;
  updated_at?: string;
};

function normalizeContent(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function parseLegacyPrefix(content: string): ParsedConversationContent {
  const normalized = normalizeContent(content);
  const channelMatch = normalized.match(CHANNEL_PREFIX_RE);
  const channel = (channelMatch?.[1]?.toLowerCase() as ConversationChannel | undefined) ?? 'unknown';
  const stripped = channelMatch ? normalizeContent(normalized.slice(channelMatch[0].length)) : normalized;
  const canonical = stripped
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { channel, stripped, canonical };
}

function parseConversationContent(
  content: string,
  explicitChannel?: string
): ParsedConversationContent {
  if (explicitChannel) {
    const explicit = explicitChannel.toLowerCase().trim();
    if (explicit) {
      const normalizedChannel =
        explicit === 'web' || explicit === 'voice' || explicit === 'sms' || explicit === 'test'
          ? (explicit as ConversationChannel)
          : 'unknown';
      return {
        channel: normalizedChannel,
        stripped: normalizeContent(content),
        canonical: normalizeContent(content)
          .toLowerCase()
          .replace(/[^a-z0-9 ]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim(),
      };
    }
  }

  return parseLegacyPrefix(content);
}

function normalizeLegacyTranscriptContent(entry: ConversationTurn): ConversationTurn {
  const parsed = parseConversationContent(entry.content, entry.channel);
  if (!entry.channel && !CHANNEL_PREFIX_RE.test(normalizeContent(entry.content))) {
    return entry;
  }

  const next: ConversationTurn = {
    ...entry,
    content: parsed.stripped,
    channel: parsed.channel,
  };
  return next;
}

function parseTimestampMs(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function shouldTreatAsNearDuplicate(previous: ConversationTurn, incoming: ConversationTurn): boolean {
  if (previous.role !== incoming.role) {
    return false;
  }

  const previousParsed = parseConversationContent(previous.content, previous.channel);
  const incomingParsed = parseConversationContent(incoming.content, incoming.channel);
  if (!previousParsed.canonical || !incomingParsed.canonical) {
    return false;
  }
  if (previousParsed.canonical !== incomingParsed.canonical) {
    return false;
  }

  const previousMs = parseTimestampMs(previous.at);
  const incomingMs = parseTimestampMs(incoming.at);
  if (!previousMs || !incomingMs) {
    return true;
  }

  return Math.abs(incomingMs - previousMs) <= DEDUPE_WINDOW_MS;
}

function shouldUpgradeUnknownChannel(previous: ConversationTurn, incoming: ConversationTurn): boolean {
  const previousParsed = parseConversationContent(previous.content, previous.channel);
  const incomingParsed = parseConversationContent(incoming.content, incoming.channel);
  return previousParsed.channel === 'unknown' && incomingParsed.channel !== 'unknown';
}

function setStorageMode(mode: ConversationStorageMode): void {
  storageMode = mode;
}

export function getConversationStorageMode(): ConversationStorageMode {
  return storageMode;
}

function readMemorySession(sessionId: string): ConversationSessionRecord {
  const existing = memorySessions.get(sessionId);
  if (existing) {
    return existing;
  }

  const created = normalizeRow(sessionId, null);
  memorySessions.set(sessionId, created);
  return created;
}

function writeMemorySession(session: ConversationSessionRecord): ConversationSessionRecord {
  const normalized = normalizeRow(session.session_id, session);
  memorySessions.set(normalized.session_id, normalized);
  return normalized;
}

function listMemorySessions(
  limit: number,
  reviewStatus?: ConversationReviewStatus
): ConversationSessionRecord[] {
  const normalizedStatus =
    reviewStatus === 'processed' || reviewStatus === 'ready' || reviewStatus === 'unprocessed'
      ? reviewStatus
      : undefined;
  return Array.from(memorySessions.values())
    .filter((row) => (normalizedStatus ? row.review_status === normalizedStatus : true))
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, limit);
}

function normalizeRow(
  sessionId: string,
  row: Partial<ConversationSessionRecord> | null | undefined
): ConversationSessionRecord {
  const timestamp = nowIso();
  return {
    session_id: row?.session_id ?? sessionId,
    answers: (row?.answers ?? {}) as Record<string, unknown>,
    asked_keys: (row?.asked_keys ?? []) as string[],
    transcript: Array.isArray(row?.transcript)
      ? (row?.transcript as unknown[]).map((entry) => normalizeLegacyTranscriptContent(entry as ConversationTurn))
      : [],
    last_question_key: (row?.last_question_key ?? null) as string | null,
    review_notes: normalizeReviewNotes((row as { review_notes?: unknown })?.review_notes),
    review_status: coerceReviewStatus((row as { review_status?: unknown })?.review_status),
    created_at: (row?.created_at as string) ?? timestamp,
    updated_at: (row?.updated_at as string) ?? timestamp,
  };
}

export async function loadConversationSession(sessionId: string): Promise<ConversationSessionRecord> {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    throw new Error('session_id is required.');
  }

  const supabase = await getSupabaseAdminClient();
  if (!supabase) {
    setStorageMode('memory_fallback');
    return readMemorySession(normalizedSessionId);
  }

  try {
    const { data, usedFallbackProjection, error } = await maybeFetchWithMissingReviewColumnsFallback<SessionRow | null>(
      async () =>
        supabase
          .from(TABLE_NAME)
          .select(baseSessionSelect(true))
          .eq('session_id', normalizedSessionId)
          .maybeSingle(),
      async () =>
        supabase
          .from(TABLE_NAME)
          .select(baseSessionSelect(false))
          .eq('session_id', normalizedSessionId)
          .maybeSingle()
    );

    if (error) {
      if (shouldFallbackToMemory(error.message)) {
        setStorageMode('memory_fallback');
        return readMemorySession(normalizedSessionId);
      }
      throw new Error(mapSupabaseErrorMessage(error.message));
    }

    const normalized = normalizeRow(normalizedSessionId, (data as Partial<ConversationSessionRecord> | null) ?? null);
    writeMemorySession(normalized);
    setStorageMode('database');

    if (usedFallbackProjection) {
      writeMemorySession(normalized);
    }

    return normalized;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Supabase request failed.';
    if (shouldFallbackToMemory(message)) {
      setStorageMode('memory_fallback');
      return readMemorySession(normalizedSessionId);
    }

    throw new Error(mapSupabaseErrorMessage(error instanceof Error ? error.message : 'Supabase request failed.'));
  }
}

export async function listConversationSessions(
  limit = 100,
  reviewStatus?: ConversationReviewStatus
): Promise<ConversationSessionRecord[]> {
  const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.round(limit))) : 100;
  const normalizedStatus =
    reviewStatus === 'processed' || reviewStatus === 'ready' || reviewStatus === 'unprocessed'
      ? reviewStatus
      : undefined;
  const supabase = await getSupabaseAdminClient();
  if (!supabase) {
    setStorageMode('memory_fallback');
    return listMemorySessions(normalizedLimit, normalizedStatus);
  }

  try {
    const { data: rawData, usedFallbackProjection, error } =
      await maybeFetchWithMissingReviewColumnsFallback<Array<Record<string, unknown>> | null>(
        async () => {
          const base = supabase
            .from(TABLE_NAME)
            .select(baseSessionSelect(true))
            .order('updated_at', { ascending: false })
            .limit(normalizedLimit);
          const response = normalizedStatus ? await base.eq('review_status', normalizedStatus) : await base;
          return asQueryResult<Array<Record<string, unknown>>>(response);
        },
        async () =>
          asQueryResult<Array<Record<string, unknown>>>(
            await supabase
              .from(TABLE_NAME)
              .select(baseSessionSelect(false))
              .order('updated_at', { ascending: false })
              .limit(normalizedLimit)
          )
      );

    if (error) {
      if (shouldFallbackToMemory(error.message)) {
        setStorageMode('memory_fallback');
        return listMemorySessions(normalizedLimit, normalizedStatus);
      }
      throw new Error(mapSupabaseErrorMessage(error.message));
    }

    const data = Array.isArray(rawData) ? rawData : [];
    let normalizedRows = data.map((row) =>
      normalizeRow(String((row as { session_id?: string }).session_id ?? ''), row as Partial<ConversationSessionRecord>)
    );
    if (usedFallbackProjection && normalizedStatus) {
      normalizedRows = normalizedRows.filter((row) => row.review_status === normalizedStatus);
    }

    if (!Array.isArray(rawData)) {
      setStorageMode('database');
      return [];
    }

    normalizedRows.forEach((row) => {
      writeMemorySession(row);
    });
    setStorageMode('database');
    return normalizedRows;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Supabase request failed.';
    if (shouldFallbackToMemory(message)) {
      setStorageMode('memory_fallback');
      return listMemorySessions(normalizedLimit, normalizedStatus);
    }

    throw new Error(mapSupabaseErrorMessage(error instanceof Error ? error.message : 'Supabase request failed.'));
  }
}

export async function appendConversationTurn(
  sessionId: string,
  entry: ConversationTurn
): Promise<ConversationSessionRecord> {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    throw new Error('session_id is required.');
  }

  const normalized: ConversationTurn = {
    ...entry,
    content: normalizeContent(entry.content),
  };
  if (normalized.channel) {
    const channel = normalized.channel.toLowerCase().trim();
    normalized.channel = ['web', 'voice', 'sms', 'test'].includes(channel) ? channel : 'unknown';
  }

  if (!normalized.content) {
    return loadConversationSession(normalizedSessionId);
  }

  const session = await loadConversationSession(normalizedSessionId);
  const updatedAt = nowIso();
  const persistSessionTranscript = async (
    sessionToPersist: ConversationSessionRecord,
    transcript: ConversationTurn[]
  ): Promise<ConversationSessionRecord> => {
    const supabase = await getSupabaseAdminClient();
    if (!supabase || getConversationStorageMode() === 'memory_fallback') {
      setStorageMode('memory_fallback');
      return writeMemorySession(sessionToPersist);
    }

    try {
      const { data, error } = await supabase
        .from(TABLE_NAME)
        .update({
          transcript,
          updated_at: sessionToPersist.updated_at,
        })
        .eq('session_id', normalizedSessionId)
        .select('session_id');

      if (!error && Array.isArray(data) && data.length > 0) {
        writeMemorySession({
          ...sessionToPersist,
          transcript,
        });
        setStorageMode('database');
        return writeMemorySession(sessionToPersist);
      }

      if (error) {
        throw new Error(error.message);
      }

      const upsertPayload = {
        session_id: sessionToPersist.session_id,
        transcript,
        updated_at: sessionToPersist.updated_at,
      };

      const { error: upsertError } = await supabase.from(TABLE_NAME).upsert(upsertPayload, { onConflict: 'session_id' });
      if (upsertError) {
        throw new Error(upsertError.message);
      }

      writeMemorySession({
        ...sessionToPersist,
        transcript,
      });
      setStorageMode('database');
      return sessionToPersist;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Supabase request failed.';
      if (shouldFallbackToMemory(message)) {
        setStorageMode('memory_fallback');
        return writeMemorySession(sessionToPersist);
      }
      throw new Error(mapSupabaseErrorMessage(error instanceof Error ? error.message : 'Supabase request failed.'));
    }
  };

  const previous = session.transcript[session.transcript.length - 1];
  if (previous && previous.role === normalized.role && normalizeContent(previous.content) === normalized.content) {
    if (shouldTreatAsNearDuplicate(previous, normalized)) {
      return session;
    }
  }

  if (previous && shouldTreatAsNearDuplicate(previous, normalized)) {
    if (shouldUpgradeUnknownChannel(previous, normalized)) {
      const mergedTranscript = [...session.transcript];
      mergedTranscript[mergedTranscript.length - 1] = {
        ...previous,
        content: normalized.content,
        channel: normalized.channel,
        at: normalized.at || previous.at,
      };
      const mergedSession: ConversationSessionRecord = {
        ...session,
        transcript: mergedTranscript,
        updated_at: updatedAt,
        created_at: session.created_at || updatedAt,
      };
      return persistSessionTranscript(mergedSession, mergedSession.transcript);
    }

    return session;
  }

  const next: ConversationSessionRecord = {
    ...session,
    transcript: [...session.transcript, normalized],
    updated_at: updatedAt,
    created_at: session.created_at || updatedAt,
  };

  return persistSessionTranscript(next, next.transcript);
}

export async function setConversationReviewState(
  sessionId: string,
  notes: string | undefined,
  reviewStatus?: ConversationReviewStatus
): Promise<ConversationSessionRecord> {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    throw new Error('session_id is required.');
  }

  const session = await loadConversationSession(normalizedSessionId);
  const next: ConversationSessionRecord = {
    ...session,
    review_notes: notes === undefined ? session.review_notes : normalizeReviewNotes(notes),
    review_status:
      reviewStatus === undefined
        ? notes === undefined || normalizeReviewNotes(notes) === ''
          ? session.review_status
          : 'ready'
        : coerceReviewStatus(reviewStatus),
    updated_at: nowIso(),
  };

  const supabase = await getSupabaseAdminClient();
  if (!supabase || getConversationStorageMode() === 'memory_fallback') {
    setStorageMode('memory_fallback');
    return writeMemorySession(next);
  }

  try {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .update({
        review_notes: next.review_notes,
        review_status: next.review_status,
        updated_at: next.updated_at,
      })
      .eq('session_id', normalizedSessionId)
      .select('session_id');

    if (error) {
      if (isReviewColumnMissingError(error.message)) {
        writeMemorySession(next);
        setStorageMode('database');
        return next;
      }
      throw new Error(error.message);
    }

    if (data && data.length > 0) {
      writeMemorySession(next);
      setStorageMode('database');
      return next;
    }

    const upsertPayload = {
      session_id: next.session_id,
      review_notes: next.review_notes,
      review_status: next.review_status,
      updated_at: next.updated_at,
    };
    const { error: upsertError } = await supabase.from(TABLE_NAME).upsert(upsertPayload, { onConflict: 'session_id' });
    if (upsertError) {
      throw new Error(upsertError.message);
    }

    writeMemorySession(next);
    setStorageMode('database');
    return next;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Supabase request failed.';
    if (shouldFallbackToMemory(message)) {
      setStorageMode('memory_fallback');
      return writeMemorySession(next);
    }
    throw new Error(mapSupabaseErrorMessage(error instanceof Error ? error.message : 'Supabase request failed.'));
  }
}

export async function deleteConversationSession(sessionId: string): Promise<boolean> {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    throw new Error('session_id is required.');
  }

  memorySessions.delete(normalizedSessionId);
  const supabase = await getSupabaseAdminClient();
  if (!supabase || getConversationStorageMode() === 'memory_fallback') {
    setStorageMode('memory_fallback');
    return true;
  }

  try {
    const { error } = await supabase.from(TABLE_NAME).delete().eq('session_id', normalizedSessionId);
    if (error) {
      if (shouldFallbackToMemory(error.message)) {
        setStorageMode('memory_fallback');
        return true;
      }
      throw error;
    }

    setStorageMode('database');
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Supabase request failed.';
    if (shouldFallbackToMemory(message)) {
      setStorageMode('memory_fallback');
      return true;
    }
    throw new Error(mapSupabaseErrorMessage(message));
  }
}
