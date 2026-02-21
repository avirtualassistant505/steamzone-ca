import { getSupabaseAdminClient } from './supabaseAdmin.js';

export type ConversationRole = 'user' | 'assistant' | 'tool';
export type ConversationStorageMode = 'database' | 'memory_fallback';
export type ConversationReviewStatus = 'unprocessed' | 'ready' | 'processed';

export interface ConversationTurn {
  role: ConversationRole;
  content: string;
  at: string;
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
    transcript: (row?.transcript ?? []) as ConversationTurn[],
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

  if (!normalized.content) {
    return loadConversationSession(normalizedSessionId);
  }

  const session = await loadConversationSession(normalizedSessionId);
  const previous = session.transcript[session.transcript.length - 1];
  if (
    previous &&
    previous.role === normalized.role &&
    normalizeContent(previous.content) === normalized.content
  ) {
    return session;
  }

  const updatedAt = nowIso();
  const next: ConversationSessionRecord = {
    ...session,
    transcript: [...session.transcript, normalized],
    updated_at: updatedAt,
    created_at: session.created_at || updatedAt,
  };

  const supabase = await getSupabaseAdminClient();
  if (!supabase || getConversationStorageMode() === 'memory_fallback') {
    setStorageMode('memory_fallback');
    return writeMemorySession(next);
  }

  try {
    const payload = {
      session_id: next.session_id,
      answers: next.answers,
      asked_keys: next.asked_keys,
      transcript: next.transcript,
      last_question_key: next.last_question_key,
      review_notes: next.review_notes,
      review_status: next.review_status,
      created_at: next.created_at,
      updated_at: next.updated_at,
    };
    const minimalPayload = {
      session_id: next.session_id,
      answers: next.answers,
      asked_keys: next.asked_keys,
      transcript: next.transcript,
      last_question_key: next.last_question_key,
      created_at: next.created_at,
      updated_at: next.updated_at,
    };

    const { error } = await supabase.from(TABLE_NAME).upsert(payload, { onConflict: 'session_id' });
    if (error && isReviewColumnMissingError(error.message)) {
      const retry = await supabase.from(TABLE_NAME).upsert(minimalPayload, { onConflict: 'session_id' });
      if (retry.error) {
        throw retry.error;
      }
    } else if (error) {
      throw error;
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
    const payload = {
      session_id: next.session_id,
      answers: next.answers,
      asked_keys: next.asked_keys,
      transcript: next.transcript,
      last_question_key: next.last_question_key,
      review_notes: next.review_notes,
      review_status: next.review_status,
      created_at: next.created_at,
      updated_at: next.updated_at,
    };
    const minimalPayload = {
      session_id: next.session_id,
      answers: next.answers,
      asked_keys: next.asked_keys,
      transcript: next.transcript,
      last_question_key: next.last_question_key,
      created_at: next.created_at,
      updated_at: next.updated_at,
    };

    const { error } = await supabase.from(TABLE_NAME).upsert(payload, { onConflict: 'session_id' });
    if (error && isReviewColumnMissingError(error.message)) {
      const retry = await supabase.from(TABLE_NAME).upsert(minimalPayload, { onConflict: 'session_id' });
      if (retry.error) {
        throw retry.error;
      }
    } else if (error) {
      throw error;
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
