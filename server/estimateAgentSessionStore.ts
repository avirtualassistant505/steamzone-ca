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
  version: number;
  created_at: string;
  updated_at: string;
}

const memoryStore = new Map<string, EstimateSessionRecord>();
const TABLE_NAME = 'estimate_sessions';
const MAX_SAVE_RETRIES = 3;
const SESSION_COLUMNS_WITH_VERSION =
  'session_id, answers, asked_keys, transcript, last_question_key, version, created_at, updated_at';
const SESSION_COLUMNS_LEGACY = 'session_id, answers, asked_keys, transcript, last_question_key, created_at, updated_at';
type SupabaseClient = NonNullable<Awaited<ReturnType<typeof getSupabaseAdminClient>>>;

type SessionLoadResult = {
  row: EstimateSessionRecord | null;
  supportsVersion: boolean;
};

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeTranscriptContent(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
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

export function createEmptySession(sessionId: string): EstimateSessionRecord {
  const timestamp = nowIso();
  return {
    session_id: sessionId,
    answers: {},
    asked_keys: [],
    transcript: [],
    last_question_key: null,
    version: 0,
    created_at: timestamp,
    updated_at: timestamp,
  };
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
  const deduped = [...existing];

  for (const entry of incoming) {
    const normalized = normalizeTranscriptContent(entry.content);
    if (!normalized) {
      continue;
    }

    const last = deduped[deduped.length - 1];
    if (last && last.role === entry.role && normalizeTranscriptContent(last.content) === normalized) {
      continue;
    }

    deduped.push({ ...entry, content: normalized });
  }

  return deduped;
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
    transcript: mergeTranscript(base.transcript, patch.transcript),
    last_question_key: patch.last_question_key ?? base.last_question_key,
    version: base.version,
    updated_at: nowIso(),
    created_at: base.created_at || patch.created_at,
  };
}

async function loadSessionRowFromDbWithSupport(
  supabase: SupabaseClient,
  sessionId: string
): Promise<SessionLoadResult> {
  try {
    const versionResult = await supabase
      .from(TABLE_NAME)
      .select(SESSION_COLUMNS_WITH_VERSION)
      .eq('session_id', sessionId)
      .maybeSingle();

    const versionError = (versionResult as { error?: { message?: string } | null }).error;
    const versionErrorMessage = versionError?.message?.trim() ?? '';
    if (versionErrorMessage && isMissingVersionColumnError(versionErrorMessage)) {
      const legacyResult = await supabase
        .from(TABLE_NAME)
        .select(SESSION_COLUMNS_LEGACY)
        .eq('session_id', sessionId)
        .maybeSingle();

      if (legacyResult.error) {
        return { row: null, supportsVersion: false };
      }

      if (!legacyResult.data) {
        return { row: null, supportsVersion: false };
      }

      return { row: toEstimateSessionRecord(legacyResult.data, sessionId), supportsVersion: false };
    }

    if (versionError) {
      if (isMissingTableError(versionErrorMessage) || isTransientError(versionErrorMessage)) {
        return { row: null, supportsVersion: true };
      }

      return { row: null, supportsVersion: true };
    }

    if (!versionResult.data) {
      return { row: null, supportsVersion: true };
    }

    return {
      row: toEstimateSessionRecord(versionResult.data, sessionId),
      supportsVersion: true,
    };
  } catch {
    return { row: null, supportsVersion: true };
  }
}

function saveToMemory(session: EstimateSessionRecord): EstimateSessionRecord {
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
    return loadFromMemory(sessionId);
  }

  try {
    const loaded = await loadSessionRowFromDbWithSupport(supabase, sessionId);
    if (!loaded.row) {
      return loadFromMemory(sessionId);
    }

    return loaded.row;
  } catch {
    return loadFromMemory(sessionId);
  }
}

export async function listSessions(limit = 100): Promise<EstimateSessionRecord[]> {
  const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.round(limit))) : 100;
  const supabase = await getSupabaseAdminClient();
  if (!supabase) {
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
          return Array.from(memoryStore.values())
            .sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))
            .slice(0, normalizedLimit)
            .map((session) => cloneSession(session));
        }

        if (!Array.isArray(fallback.data)) {
          return [];
        }

        return fallback.data.map((row) => ({
          ...toEstimateSessionRecord(row, String((row as { session_id?: string }).session_id ?? '')),
          version: 0,
        }));
      }

      return Array.from(memoryStore.values())
        .sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))
        .slice(0, normalizedLimit)
        .map((session) => cloneSession(session));
    }

    if (!Array.isArray(loaded.data)) {
      return [];
    }

    return loaded.data.map((row) =>
      toEstimateSessionRecord(row, String((row as { session_id?: string }).session_id ?? ''))
    );
  } catch {
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
  };

  const previous = session.transcript[session.transcript.length - 1];
  if (
    previous &&
    previous.role === normalizedEntry.role &&
    normalizeTranscriptContent(previous.content) === normalizedEntry.content
  ) {
    return session;
  }

  const next: EstimateSessionRecord = {
    ...session,
    transcript: [...session.transcript, normalizedEntry],
  };

  return saveSession(next);
}
