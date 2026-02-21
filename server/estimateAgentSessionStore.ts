import { getSupabaseAdminClient } from './supabaseAdmin.js';

export interface TranscriptEntry {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  at: string;
}

export interface EstimateSessionRecord {
  session_id: string;
  answers: Record<string, unknown>;
  asked_keys: string[];
  transcript: TranscriptEntry[];
  last_question_key: string | null;
  created_at: string;
  updated_at: string;
}

const memoryStore = new Map<string, EstimateSessionRecord>();

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

export function createEmptySession(sessionId: string): EstimateSessionRecord {
  const timestamp = nowIso();
  return {
    session_id: sessionId,
    answers: {},
    asked_keys: [],
    transcript: [],
    last_question_key: null,
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

function loadFromMemory(sessionId: string): EstimateSessionRecord {
  const existing = memoryStore.get(sessionId);
  if (existing) {
    return cloneSession(existing);
  }

  const created = createEmptySession(sessionId);
  memoryStore.set(sessionId, cloneSession(created));
  return created;
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
    const { data, error } = await supabase
      .from('estimate_sessions')
      .select('session_id, answers, asked_keys, transcript, last_question_key, created_at, updated_at')
      .eq('session_id', sessionId)
      .maybeSingle();

    if (error) {
      if (isMissingTableError(error.message)) {
        return loadFromMemory(sessionId);
      }
      return loadFromMemory(sessionId);
    }

    if (!data) {
      return loadFromMemory(sessionId);
    }

    const row = data as Partial<EstimateSessionRecord>;
    return {
      session_id: row.session_id ?? sessionId,
      answers: (row.answers ?? {}) as Record<string, unknown>,
      asked_keys: (row.asked_keys ?? []) as string[],
      transcript: (row.transcript ?? []) as TranscriptEntry[],
      last_question_key: (row.last_question_key ?? null) as string | null,
      created_at: (row.created_at as string) ?? nowIso(),
      updated_at: (row.updated_at as string) ?? nowIso(),
    };
  } catch {
    return loadFromMemory(sessionId);
  }
}

export async function saveSession(session: EstimateSessionRecord): Promise<EstimateSessionRecord> {
  const normalized = {
    ...cloneSession(session),
    updated_at: nowIso(),
  };

  const supabase = await getSupabaseAdminClient();
  if (!supabase) {
    return saveToMemory(normalized);
  }

  try {
    const { error } = await supabase.from('estimate_sessions').upsert(
      {
        session_id: normalized.session_id,
        answers: normalized.answers,
        asked_keys: normalized.asked_keys,
        transcript: normalized.transcript,
        last_question_key: normalized.last_question_key,
        created_at: normalized.created_at,
        updated_at: normalized.updated_at,
      },
      { onConflict: 'session_id' }
    );

    if (error) {
      if (isMissingTableError(error.message)) {
        return saveToMemory(normalized);
      }
      return saveToMemory(normalized);
    }

    return normalized;
  } catch {
    return saveToMemory(normalized);
  }
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
