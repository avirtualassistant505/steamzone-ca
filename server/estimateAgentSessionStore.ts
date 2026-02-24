import { getSupabaseAdminClient } from './supabaseAdmin.js';

export interface TranscriptEntry {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  at: string;
  channel?: string;
  reasoning?: string;
  meta?: Record<string, unknown>;
}

export interface EstimateSessionRecord {
  session_id: string;
  answers: Record<string, unknown>;
  asked_keys: string[];
  transcript: TranscriptEntry[];
  last_question_key: string | null;
  review_notes: string;
  review_status: 'unprocessed' | 'ready' | 'processed';
  mode: 'support' | 'estimate' | 'handoff';
  processed_turn_ids: string[];
  finalized_record_id: string | null;
  finalized_quote_hash: string | null;
  finalized_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

const memoryStore = new Map<string, EstimateSessionRecord>();
const TABLE_NAME = 'estimate_sessions';
const MAX_SAVE_RETRIES = 3;
const SESSION_COLUMNS_WITH_VERSION =
  'session_id, answers, asked_keys, transcript, last_question_key, mode, processed_turn_ids, finalized_record_id, finalized_quote_hash, finalized_at, version, created_at, updated_at';
const SESSION_COLUMNS_WITH_VERSION_REVIEW =
  'session_id, answers, asked_keys, transcript, last_question_key, mode, processed_turn_ids, finalized_record_id, finalized_quote_hash, finalized_at, review_notes, review_status, version, created_at, updated_at';
const SESSION_COLUMNS_WITH_VERSION_NO_REVIEW =
  'session_id, answers, asked_keys, transcript, last_question_key, mode, processed_turn_ids, finalized_record_id, finalized_quote_hash, finalized_at, created_at, updated_at';
const SESSION_COLUMNS_NO_VERSION_REVIEW =
  'session_id, answers, asked_keys, transcript, last_question_key, mode, processed_turn_ids, finalized_record_id, finalized_quote_hash, finalized_at, review_notes, review_status, created_at, updated_at';
const SESSION_COLUMNS_LEGACY = 'session_id, answers, asked_keys, transcript, last_question_key, created_at, updated_at';
const SESSION_COLUMNS_LEGACY_NO_REVIEW = SESSION_COLUMNS_LEGACY;

type SessionStorageMode = 'database' | 'memory_fallback';
let storageMode: SessionStorageMode = 'memory_fallback';
const DEFAULT_REVIEW_STATUS: 'unprocessed' | 'ready' | 'processed' = 'unprocessed';

type SupabaseClient = NonNullable<Awaited<ReturnType<typeof getSupabaseAdminClient>>>;

type SessionLoadResult = {
  row: EstimateSessionRecord | null;
  supportsVersion: boolean;
  querySupportsReview: boolean;
};

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeTranscriptContent(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeTranscriptForDedupe(value: string): string {
  return normalizeTranscriptContent(value)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cloneSession(session: EstimateSessionRecord): EstimateSessionRecord {
  return {
    ...session,
    answers: structuredClone(session.answers),
    asked_keys: [...session.asked_keys],
    transcript: structuredClone(session.transcript),
  };
}

function coerceVersion(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function coerceReviewStatus(value: unknown): 'unprocessed' | 'ready' | 'processed' {
  if (value === 'ready') return 'ready';
  if (value === 'processed') return 'processed';
  return DEFAULT_REVIEW_STATUS;
}

function normalizeReviewNotes(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringField(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  return null;
}

function normalizeMode(value: unknown): 'support' | 'estimate' | 'handoff' {
  const mode = String(value ?? '').trim().toLowerCase();
  return mode === 'estimate' || mode === 'handoff' ? mode : 'support';
}

function normalizeProcessedTurnIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique: string[] = [];
  for (const item of value) {
    const text = normalizeStringField(item);
    if (!text) continue;
    if (!unique.includes(text)) {
      unique.push(text);
    }
  }
  return unique.slice(-50);
}

export function createEmptySession(sessionId: string): EstimateSessionRecord {
  const timestamp = nowIso();
  return {
    session_id: sessionId,
    answers: {},
    asked_keys: [],
    transcript: [],
    last_question_key: null,
    review_notes: '',
    review_status: DEFAULT_REVIEW_STATUS,
    mode: 'support',
    processed_turn_ids: [],
    finalized_record_id: null,
    finalized_quote_hash: null,
    finalized_at: null,
    version: 0,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function setStorageMode(mode: SessionStorageMode): void {
  storageMode = mode;
}

export function getSessionStorageMode(): SessionStorageMode {
  return storageMode;
}

function isMissingTableError(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes('estimate_sessions') &&
    (text.includes('does not exist') || text.includes('relation') || text.includes('schema cache') || text.includes('could not find'))
  );
}

function isMissingVersionColumnError(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes('version') &&
    (text.includes('does not exist') || text.includes('unknown column') || text.includes('could not find'))
  );
}

function isMissingReviewColumnError(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes('column') &&
    (text.includes('review_notes') || text.includes('review_status')) &&
    (
      text.includes('does not exist') ||
      text.includes("doesn't exist") ||
      text.includes('unknown column') ||
      text.includes('could not find')
    )
  );
}

function isDuplicateError(message: string): boolean {
  const text = message.toLowerCase();
  return text.includes('duplicate key') || text.includes('duplicate') || text.includes('unique constraint');
}

function isTransientError(message: string): boolean {
  const text = message.toLowerCase();
  return text.includes('fetch failed') || text.includes('networkerror') || text.includes('timeout');
}

function isConflictOrNotFound(message: string): boolean {
  const text = message.toLowerCase();
  return text.includes('not found') || text.includes('no rows') || text.includes('constraint') || text.includes('duplicate key');
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : 'Unknown persistence error.';
}

function toEstimateSessionRecord(row: unknown, fallbackSessionId: string): EstimateSessionRecord {
  const typed = (row ?? {}) as Partial<EstimateSessionRecord>;
  return {
    session_id: typed.session_id ?? fallbackSessionId,
    answers: (typed.answers ?? {}) as Record<string, unknown>,
    asked_keys: (typed.asked_keys ?? []) as string[],
    transcript: (typed.transcript ?? []) as TranscriptEntry[],
    last_question_key: (typed.last_question_key ?? null) as string | null,
    review_notes: normalizeReviewNotes((typed as { review_notes?: unknown }).review_notes),
    review_status: coerceReviewStatus((typed as { review_status?: unknown }).review_status),
    mode: normalizeMode((typed as { mode?: unknown }).mode),
    processed_turn_ids: normalizeProcessedTurnIds((typed as { processed_turn_ids?: unknown }).processed_turn_ids),
    finalized_record_id: normalizeStringField((typed as { finalized_record_id?: unknown }).finalized_record_id),
    finalized_quote_hash: normalizeStringField((typed as { finalized_quote_hash?: unknown }).finalized_quote_hash),
    finalized_at: normalizeStringField((typed as { finalized_at?: unknown }).finalized_at),
    version: coerceVersion(typed.version),
    created_at: (typed.created_at as string) ?? nowIso(),
    updated_at: (typed.updated_at as string) ?? nowIso(),
  };
}

function loadFromMemory(sessionId: string): EstimateSessionRecord {
  const existing = memoryStore.get(sessionId);
  if (existing) {
    return cloneSession(existing);
  }

  const created = createEmptySession(sessionId);
  memoryStore.set(sessionId, cloneSession(created));
  return created;
}

function mergeTranscript(existing: TranscriptEntry[], incoming: TranscriptEntry[]): TranscriptEntry[] {
  const merged: TranscriptEntry[] = [];
  const rows = [...existing, ...incoming].map((entry) => ({
    ...entry,
    normalizedContent: normalizeTranscriptContent(entry.content),
    normalizedAt: Date.parse(entry.at) || 0,
  }));

  rows.sort((left, right) => {
    if (left.normalizedAt !== right.normalizedAt) {
      return left.normalizedAt - right.normalizedAt;
    }

    if (left.role !== right.role) {
      return left.role.localeCompare(right.role);
    }

    return normalizeTranscriptContent(left.content).localeCompare(normalizeTranscriptContent(right.content));
  });

  for (const entry of rows) {
    const normalized = entry.normalizedContent;
    if (!normalized) continue;
    const canonical = normalizeTranscriptForDedupe(normalized);

    const duplicate = merged.findIndex((current) => {
      if (current.role !== entry.role) return false;
      if (normalizeTranscriptForDedupe(current.content) !== canonical) return false;
      const currentAt = Date.parse(current.at) || 0;
      return Math.abs(currentAt - entry.normalizedAt) <= 5000;
    });

    if (duplicate >= 0) {
      const existingEntry = merged[duplicate];
      const existingChannel = existingEntry.channel ?? 'unknown';
      const incomingChannel = entry.channel ?? 'unknown';

      if (incomingChannel !== 'unknown' && existingChannel === 'unknown') {
        existingEntry.channel = incomingChannel;
        existingEntry.content = entry.content;
        existingEntry.at = entry.at;
        existingEntry.reasoning = entry.reasoning ?? existingEntry.reasoning;
        existingEntry.meta = entry.meta ?? existingEntry.meta;
      } else {
        // Preserve earliest known-anchored content while still merging metadata.
        existingEntry.reasoning = existingEntry.reasoning || entry.reasoning;
        existingEntry.meta = existingEntry.meta || entry.meta;
      }
      continue;
    }

    merged.push({
      role: entry.role,
      content: normalized,
      at: entry.at,
      channel: entry.channel,
      reasoning: entry.reasoning,
      meta: entry.meta,
    });
  }

  return merged;
}

function mergeSessionRows(base: EstimateSessionRecord, patch: EstimateSessionRecord): EstimateSessionRecord {
  const mergedAskedKeys = [...base.asked_keys, ...patch.asked_keys];
  const askedKeys: string[] = [];

  for (const key of mergedAskedKeys) {
    if (!askedKeys.includes(key)) {
      askedKeys.push(key);
    }
  }

  return {
    ...base,
    answers: {
      ...base.answers,
      ...patch.answers,
    },
    asked_keys: askedKeys,
    mode: patch.mode || base.mode,
    processed_turn_ids: [...new Set([...base.processed_turn_ids, ...patch.processed_turn_ids])].slice(-50),
    finalized_record_id:
      patch.finalized_record_id === null ? null : patch.finalized_record_id || base.finalized_record_id || null,
    finalized_quote_hash:
      patch.finalized_quote_hash === null ? null : patch.finalized_quote_hash || base.finalized_quote_hash || null,
    finalized_at: patch.finalized_at === null ? null : patch.finalized_at || base.finalized_at || null,
    transcript: mergeTranscript(base.transcript, patch.transcript),
    last_question_key: patch.last_question_key ?? base.last_question_key,
    review_notes: patch.review_notes ?? base.review_notes,
    review_status: patch.review_status || base.review_status,
    version: base.version,
    updated_at: nowIso(),
    created_at: base.created_at || patch.created_at,
  };
}

function isMissingReviewColumn(message: string): boolean {
  return isMissingReviewColumnError(message);
}

function isMissingVersionColumn(message: string): boolean {
  return isMissingVersionColumnError(message);
}

function isMissingTableOrTransient(message: string): boolean {
  return isMissingTableError(message) || isTransientError(message);
}

function asQueryErrorMessage(error: unknown): string | null {
  if (!error) return null;
  const message = extractErrorMessage(error);
  return message || null;
}

function queryFallbackOrder(supportsReview: boolean, supportsVersion: boolean): Array<{ columns: string; supportsReview: boolean; supportsVersion: boolean }> {
  if (supportsReview && supportsVersion) {
    return [
      {
        columns: SESSION_COLUMNS_WITH_VERSION_REVIEW,
        supportsReview: true,
        supportsVersion: true,
      },
      {
        columns: SESSION_COLUMNS_WITH_VERSION_NO_REVIEW,
        supportsReview: false,
        supportsVersion: true,
      },
      {
        columns: SESSION_COLUMNS_NO_VERSION_REVIEW,
        supportsReview: true,
        supportsVersion: false,
      },
      {
        columns: SESSION_COLUMNS_LEGACY_NO_REVIEW,
        supportsReview: false,
        supportsVersion: false,
      },
    ];
  }

  if (supportsVersion) {
    return [
      {
        columns: SESSION_COLUMNS_WITH_VERSION_NO_REVIEW,
        supportsReview: false,
        supportsVersion: true,
      },
      {
        columns: SESSION_COLUMNS_LEGACY_NO_REVIEW,
        supportsReview: false,
        supportsVersion: false,
      },
    ];
  }

  return [
    {
      columns: SESSION_COLUMNS_NO_VERSION_REVIEW,
      supportsReview: true,
      supportsVersion: false,
    },
    {
      columns: SESSION_COLUMNS_LEGACY_NO_REVIEW,
      supportsReview: false,
      supportsVersion: false,
    },
  ];
}

async function loadSessionRowFromDbWithSupport(
  supabase: SupabaseClient,
  sessionId: string
): Promise<SessionLoadResult> {
  const attempts = queryFallbackOrder(true, true);

  for (const attempt of attempts) {
    try {
      const result = await supabase
        .from(TABLE_NAME)
        .select(attempt.columns)
        .eq('session_id', sessionId)
        .maybeSingle();

      const errorMessage = asQueryErrorMessage((result as { error?: unknown }).error);
      if (!errorMessage) {
        if (result.data === null) {
          return {
            row: null,
            supportsVersion: attempt.supportsVersion,
            querySupportsReview: attempt.supportsReview,
          };
        }

        return {
          row: toEstimateSessionRecord(result.data, sessionId),
          supportsVersion: attempt.supportsVersion,
          querySupportsReview: attempt.supportsReview,
        };
      }

      const normalizedMessage = errorMessage.trim().toLowerCase();
      if (isMissingReviewColumn(normalizedMessage) && attempt.supportsReview) {
        continue;
      }

      if (isMissingVersionColumn(normalizedMessage) && attempt.supportsVersion) {
        continue;
      }

      if (isMissingTableOrTransient(normalizedMessage)) {
        return {
          row: null,
          supportsVersion: attempt.supportsVersion,
          querySupportsReview: attempt.supportsReview,
        };
      }

      return {
        row: null,
        supportsVersion: attempt.supportsVersion,
        querySupportsReview: attempt.supportsReview,
      };
    } catch {
      return {
        row: null,
        supportsVersion: attempt.supportsVersion,
        querySupportsReview: attempt.supportsReview,
      };
    }
  }

  return { row: null, supportsVersion: true, querySupportsReview: true };
}

function saveToMemory(session: EstimateSessionRecord): EstimateSessionRecord {
  setStorageMode('memory_fallback');
  const normalized: EstimateSessionRecord = {
    ...cloneSession(session),
    updated_at: nowIso(),
  };

  if (!normalized.created_at) {
    normalized.created_at = normalized.updated_at;
  }

  memoryStore.set(normalized.session_id, cloneSession(normalized));
  return normalized;
}

export async function getSession(sessionId: string): Promise<EstimateSessionRecord> {
  const supabase = await getSupabaseAdminClient();
  if (!supabase) {
    setStorageMode('memory_fallback');
    return loadFromMemory(sessionId);
  }

  try {
    const loaded = await loadSessionRowFromDbWithSupport(supabase, sessionId);
    if (!loaded.row) {
      setStorageMode('database');
      return loadFromMemory(sessionId);
    }

    setStorageMode('database');
    return loaded.row;
  } catch {
    setStorageMode('memory_fallback');
    return loadFromMemory(sessionId);
  }
}

export async function listSessions(limit = 100): Promise<EstimateSessionRecord[]> {
  const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.round(limit))) : 100;
  const supabase = await getSupabaseAdminClient();
  if (!supabase) {
    setStorageMode('memory_fallback');
    return Array.from(memoryStore.values())
      .sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))
      .slice(0, normalizedLimit)
      .map((session) => cloneSession(session));
  }

  try {
    const loaded = await supabase
      .from(TABLE_NAME)
      .select(SESSION_COLUMNS_WITH_VERSION)
      .order('updated_at', { ascending: false })
      .limit(normalizedLimit);

    if (loaded.error) {
      if (isMissingVersionColumnError(loaded.error.message)) {
        const fallback = await supabase
          .from(TABLE_NAME)
          .select(SESSION_COLUMNS_LEGACY)
          .order('updated_at', { ascending: false })
          .limit(normalizedLimit);

        if (fallback.error) {
          setStorageMode('memory_fallback');
          return Array.from(memoryStore.values())
            .sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))
            .slice(0, normalizedLimit)
            .map((session) => cloneSession(session));
        }

        if (!Array.isArray(fallback.data)) {
          setStorageMode('memory_fallback');
          return [];
        }

        setStorageMode('database');
        return fallback.data.map((row) => ({
          ...toEstimateSessionRecord(row, String((row as { session_id?: string }).session_id ?? '')),
          version: 0,
        }));
      }

      setStorageMode('memory_fallback');
      return Array.from(memoryStore.values())
        .sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))
        .slice(0, normalizedLimit)
        .map((session) => cloneSession(session));
    }

    if (!Array.isArray(loaded.data)) {
      setStorageMode('memory_fallback');
      return [];
    }

    setStorageMode('database');
    return loaded.data.map((row) =>
      toEstimateSessionRecord(row, String((row as { session_id?: string }).session_id ?? ''))
    );
  } catch {
    setStorageMode('memory_fallback');
    return Array.from(memoryStore.values())
      .sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))
      .slice(0, normalizedLimit)
      .map((session) => cloneSession(session));
  }
}

function buildDbPayload(
  session: EstimateSessionRecord,
  includeVersion: boolean,
  version: number
): Record<string, unknown> {
  const payload = {
    session_id: session.session_id,
    answers: session.answers,
    asked_keys: session.asked_keys,
    transcript: session.transcript,
    last_question_key: session.last_question_key,
    mode: session.mode,
    processed_turn_ids: session.processed_turn_ids,
    finalized_record_id: session.finalized_record_id,
    finalized_quote_hash: session.finalized_quote_hash,
    finalized_at: session.finalized_at,
    review_notes: session.review_notes,
    review_status: session.review_status,
    created_at: session.created_at,
    updated_at: session.updated_at,
  } as Record<string, unknown>;

  if (includeVersion) {
    payload.version = version;
  }

  return payload;
}

export async function saveSession(session: EstimateSessionRecord): Promise<EstimateSessionRecord> {
  const normalized = {
    ...cloneSession(session),
    updated_at: nowIso(),
    version: coerceVersion(session.version),
  };

  if (!normalized.created_at) {
    normalized.created_at = normalized.updated_at;
  }

  const supabase = await getSupabaseAdminClient();
  if (!supabase) {
    return saveToMemory(normalized);
  }

  let current = normalized;

  for (let attempt = 0; attempt < MAX_SAVE_RETRIES; attempt += 1) {
    const loaded = await loadSessionRowFromDbWithSupport(supabase, current.session_id);

    if (!loaded.row) {
      const nextVersion = loaded.supportsVersion ? Math.max(1, coerceVersion(current.version)) : current.version;
      const payload = buildDbPayload(current, loaded.supportsVersion, loaded.supportsVersion ? nextVersion : coerceVersion(current.version));

      try {
        const { error } = await supabase
          .from(TABLE_NAME)
          .upsert(payload, { onConflict: 'session_id' });

        if (!error) {
          setStorageMode('database');
          return {
            ...current,
            version: loaded.supportsVersion ? nextVersion : 0,
            updated_at: current.updated_at,
          };
        }

        if (isMissingTableError(error.message) || isTransientError(error.message)) {
          return saveToMemory(current);
        }

        if (isDuplicateError(error.message)) {
          continue;
        }

        throw new Error(error.message);
      } catch (error) {
        const message = extractErrorMessage(error);
        if (isTransientError(message) || isMissingTableError(message)) {
          return saveToMemory(current);
        }

        if (isMissingVersionColumnError(message) && loaded.supportsVersion) {
          current = {
            ...current,
            version: 0,
          };
          continue;
        }

        if (attempt + 1 >= MAX_SAVE_RETRIES) {
          return saveToMemory(current);
        }
      }

      continue;
    }

    const latest = loaded.row;

    if (!loaded.supportsVersion) {
      const merged = mergeSessionRows(latest, current);
      const payload = buildDbPayload(merged, false, merged.version);

      try {
        const { error } = await supabase.from(TABLE_NAME).upsert(payload, { onConflict: 'session_id' });
        if (!error) {
          setStorageMode('database');
          return {
            ...merged,
            updated_at: merged.updated_at,
            version: 0,
          };
        }

        if (isMissingTableError(error.message) || isTransientError(error.message) || isMissingVersionColumnError(error.message)) {
          return saveToMemory(current);
        }

        if (attempt + 1 >= MAX_SAVE_RETRIES) {
          return saveToMemory(current);
        }

        // Stale read in legacy mode, retry with fresh data.
        continue;
      } catch (error) {
        const message = extractErrorMessage(error);
        if (isTransientError(message) || isMissingTableError(message)) {
          return saveToMemory(current);
        }

        if (attempt + 1 >= MAX_SAVE_RETRIES) {
          return saveToMemory(current);
        }
      }

      continue;
    }

    const merged = mergeSessionRows(latest, current);
    const expectedVersion = latest.version;
    const nextVersion = expectedVersion + 1;

    try {
      const payload = buildDbPayload(merged, true, nextVersion);

      const { data, error } = await supabase
        .from(TABLE_NAME)
        .update(payload)
        .eq('session_id', merged.session_id)
        .eq('version', expectedVersion)
        .select('session_id, version');

      if (!error && Array.isArray(data) && data.length > 0) {
        setStorageMode('database');
        return {
          ...merged,
          version: nextVersion,
          updated_at: merged.updated_at,
        };
      }

      if (error) {
        if (isMissingVersionColumnError(error.message) || isMissingTableError(error.message) || isTransientError(error.message)) {
          current = {
            ...current,
            version: 0,
          };
          continue;
        }

        if (!isConflictOrNotFound(error.message) && attempt + 1 >= MAX_SAVE_RETRIES) {
          return saveToMemory(current);
        }
      }

      if (!error && (!Array.isArray(data) || data.length === 0) && attempt + 1 < MAX_SAVE_RETRIES) {
        // CAS conflict from another concurrent write.
        continue;
      }

      if (attempt + 1 >= MAX_SAVE_RETRIES) {
        return saveToMemory(current);
      }
    } catch (error) {
      const message = extractErrorMessage(error);
      if (isMissingVersionColumnError(message) || isMissingTableError(message) || isTransientError(message)) {
        return saveToMemory(current);
      }

      if (attempt + 1 >= MAX_SAVE_RETRIES) {
        return saveToMemory(current);
      }
    }

    if (attempt + 1 >= MAX_SAVE_RETRIES) {
      return saveToMemory(current);
    }
  }

  return saveToMemory(current);
}

export async function appendTranscript(
  sessionId: string,
  entry: TranscriptEntry
): Promise<EstimateSessionRecord> {
  const session = await getSession(sessionId);
  const normalizedEntry: TranscriptEntry = {
    ...entry,
    content: normalizeTranscriptContent(entry.content),
    channel: entry.channel,
    reasoning: entry.reasoning,
  };
  const mergedTranscript = mergeTranscript(session.transcript, [normalizedEntry]);

  const next: EstimateSessionRecord = {
    ...session,
    transcript: mergedTranscript,
  };

  return saveSession(next);
}

export async function deleteSession(sessionId: string): Promise<boolean> {
  const normalized = sessionId.trim();
  if (!normalized) {
    throw new Error('session_id is required.');
  }

  memoryStore.delete(normalized);

  const supabase = await getSupabaseAdminClient();
  if (!supabase) {
    setStorageMode('memory_fallback');
    return true;
  }

  try {
    const { error } = await supabase.from(TABLE_NAME).delete().eq('session_id', normalized);
    if (error) {
      if (isMissingTableOrTransient(error.message) || isTransientError(error.message)) {
        setStorageMode('memory_fallback');
        return true;
      }

      throw new Error(error.message);
    }

    setStorageMode('database');
    return true;
  } catch (error) {
    const message = extractErrorMessage(error);
    if (isMissingTableOrTransient(message) || isTransientError(message)) {
      setStorageMode('memory_fallback');
      return true;
    }

    throw new Error(message);
  }
}
