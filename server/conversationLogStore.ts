import { getSupabaseAdminClient } from './supabaseAdmin.js';

export type ConversationRole = 'user' | 'assistant' | 'tool';
export type ConversationStorageMode = 'database' | 'memory_fallback';

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
  created_at: string;
  updated_at: string;
}

const TABLE_NAME = 'estimate_sessions';
const memorySessions = new Map<string, ConversationSessionRecord>();
let storageMode: ConversationStorageMode = 'memory_fallback';

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

function listMemorySessions(limit: number): ConversationSessionRecord[] {
  return Array.from(memorySessions.values())
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
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select('session_id, answers, asked_keys, transcript, last_question_key, created_at, updated_at')
      .eq('session_id', normalizedSessionId)
      .maybeSingle();

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

export async function listConversationSessions(limit = 100): Promise<ConversationSessionRecord[]> {
  const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.round(limit))) : 100;
  const supabase = await getSupabaseAdminClient();
  if (!supabase) {
    setStorageMode('memory_fallback');
    return listMemorySessions(normalizedLimit);
  }

  try {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select('session_id, answers, asked_keys, transcript, last_question_key, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(normalizedLimit);

    if (error) {
      if (shouldFallbackToMemory(error.message)) {
        setStorageMode('memory_fallback');
        return listMemorySessions(normalizedLimit);
      }
      throw new Error(mapSupabaseErrorMessage(error.message));
    }

    if (!Array.isArray(data)) {
      setStorageMode('database');
      return [];
    }

    const rows = data.map((row) =>
      normalizeRow(String((row as { session_id?: string }).session_id ?? ''), row as Partial<ConversationSessionRecord>)
    );
    rows.forEach((row) => {
      writeMemorySession(row);
    });
    setStorageMode('database');
    return rows;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Supabase request failed.';
    if (shouldFallbackToMemory(message)) {
      setStorageMode('memory_fallback');
      return listMemorySessions(normalizedLimit);
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
    const { error } = await supabase.from(TABLE_NAME).upsert(
      {
        session_id: next.session_id,
        answers: next.answers,
        asked_keys: next.asked_keys,
        transcript: next.transcript,
        last_question_key: next.last_question_key,
        created_at: next.created_at,
        updated_at: next.updated_at,
      },
      { onConflict: 'session_id' }
    );

    if (error) {
      if (shouldFallbackToMemory(error.message)) {
        setStorageMode('memory_fallback');
        return writeMemorySession(next);
      }
      throw new Error(mapSupabaseErrorMessage(error.message));
    }

    writeMemorySession(next);
    setStorageMode('database');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Supabase request failed.';
    if (shouldFallbackToMemory(message)) {
      setStorageMode('memory_fallback');
      return writeMemorySession(next);
    }
    throw new Error(mapSupabaseErrorMessage(error instanceof Error ? error.message : 'Supabase request failed.'));
  }

  return next;
}
