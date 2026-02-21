import { getSupabaseAdminClient } from './supabaseAdmin.js';

export type ConversationRole = 'user' | 'assistant' | 'tool';

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

function normalizeContent(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

async function getRequiredSupabase() {
  const supabase = await getSupabaseAdminClient();
  if (!supabase) {
    throw new Error(
      'Conversation logging requires database mode. Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY in environment.'
    );
  }
  return supabase;
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

  const supabase = await getRequiredSupabase();
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('session_id, answers, asked_keys, transcript, last_question_key, created_at, updated_at')
    .eq('session_id', normalizedSessionId)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error.message)) {
      throw new Error(
        'Conversation logging table is missing. Create `estimate_sessions` in Supabase before using logs.'
      );
    }
    throw new Error(error.message);
  }

  return normalizeRow(normalizedSessionId, (data as Partial<ConversationSessionRecord> | null) ?? null);
}

export async function listConversationSessions(limit = 100): Promise<ConversationSessionRecord[]> {
  const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.round(limit))) : 100;
  const supabase = await getRequiredSupabase();

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('session_id, answers, asked_keys, transcript, last_question_key, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(normalizedLimit);

  if (error) {
    if (isMissingTableError(error.message)) {
      throw new Error(
        'Conversation logging table is missing. Create `estimate_sessions` in Supabase before using logs.'
      );
    }
    throw new Error(error.message);
  }

  if (!Array.isArray(data)) {
    return [];
  }

  return data.map((row) => normalizeRow(String((row as { session_id?: string }).session_id ?? ''), row as Partial<ConversationSessionRecord>));
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

  const supabase = await getRequiredSupabase();
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
    if (isMissingTableError(error.message)) {
      throw new Error(
        'Conversation logging table is missing. Create `estimate_sessions` in Supabase before using logs.'
      );
    }
    throw new Error(error.message);
  }

  return next;
}

