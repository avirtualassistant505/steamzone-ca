type EstimateSessionRecord = {
  session_id: string;
  answers: Record<string, unknown>;
  asked_keys: string[];
  transcript: {
    role: ConversationRole;
    content: string;
    at: string;
    channel?: string;
    reasoning?: string;
    meta?: Record<string, unknown>;
  }[];
  last_question_key: string | null;
  review_notes: string;
  review_status: 'unprocessed' | 'ready' | 'processed';
  mode?: 'support' | 'estimate' | 'handoff';
  processed_turn_ids?: string[];
  finalized_record_id?: string | null;
  finalized_quote_hash?: string | null;
  finalized_at?: string | null;
  version?: number;
  created_at: string;
  updated_at: string;
};

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

const DEFAULT_REVIEW_STATUS: ConversationReviewStatus = 'unprocessed';
const CHANNEL_PREFIX_RE = /^\[(web|voice|sms|test)\]\s*/i;

type ConversationChannel = 'web' | 'voice' | 'sms' | 'test' | 'unknown';
type ParsedConversationContent = {
  channel: ConversationChannel;
  stripped: string;
  canonical: string;
};

type EstimateStoreModule = {
  getSession: (sessionId: string) => Promise<EstimateSessionRecord>;
  listSessions: (limit?: number) => Promise<EstimateSessionRecord[]>;
  appendTranscript: (
    sessionId: string,
    entry: {
      role: ConversationRole;
      content: string;
      at: string;
      channel?: string;
      reasoning?: string;
      meta?: Record<string, unknown>;
    }
  ) => Promise<EstimateSessionRecord>;
  saveSession: (session: EstimateSessionRecord) => Promise<EstimateSessionRecord>;
  getSessionStorageMode: () => ConversationStorageMode;
  deleteSession: (sessionId: string) => Promise<boolean>;
};

let cachedEstimateStoreModule: Promise<EstimateStoreModule> | null = null;
let storageMode: ConversationStorageMode = 'memory_fallback';

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

function normalizeContent(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function asText(value: string | undefined): string {
  return value?.trim() ?? '';
}

function normalizeConversationChannel(value: unknown): ConversationChannel {
  const channel = asText(String(value)).toLowerCase();
  return (channel === 'web' || channel === 'voice' || channel === 'sms' || channel === 'test')
    ? (channel as ConversationChannel)
    : 'unknown';
}

function parseConversationContent(content: string, explicitChannel?: string): ParsedConversationContent {
  if (explicitChannel) {
    const channel = normalizeConversationChannel(explicitChannel);
    const normalizedContent = normalizeContent(content);
    return {
      channel,
      stripped: normalizedContent,
      canonical: normalizedContent
        .toLowerCase()
        .replace(/[^a-z0-9 ]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    };
  }

  const normalized = normalizeContent(content);
  const match = normalized.match(CHANNEL_PREFIX_RE);
  if (!match) {
    return {
      channel: 'unknown',
      stripped: normalized,
      canonical: normalized
        .toLowerCase()
        .replace(/[^a-z0-9 ]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    };
  }

  const channelText = match[1]?.toLowerCase() ?? '';
  const stripped = normalizeContent(normalized.slice(match[0].length));
  return {
    channel: normalizeConversationChannel(channelText),
    stripped,
    canonical: stripped
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  };
}

function normalizeLegacyTranscriptContent(entry: {
  role: ConversationRole;
  content: string;
  at: string;
  channel?: string;
  source?: string;
  reasoning?: string;
}): ConversationTurn {
  const parsed = parseConversationContent(entry.content, entry.channel);
  if (!entry.channel && !CHANNEL_PREFIX_RE.test(normalizeContent(entry.content))) {
    return {
      role: entry.role,
      content: normalizeContent(entry.content),
      at: entry.at,
      channel: entry.channel,
      source: entry.source,
      reasoning: entry.reasoning,
    };
  }

  return {
    role: entry.role,
    content: parsed.stripped,
    at: entry.at,
    channel: parsed.channel === 'unknown' ? undefined : parsed.channel,
    source: entry.source,
    reasoning: entry.reasoning,
  };
}

async function estimateSessionStore(): Promise<EstimateStoreModule> {
  if (!cachedEstimateStoreModule) {
    cachedEstimateStoreModule = import('./estimateAgentSessionStore.js').then((mod) => {
      return {
        getSession: mod.getSession,
        listSessions: mod.listSessions,
        appendTranscript: mod.appendTranscript,
        saveSession: mod.saveSession,
        getSessionStorageMode: mod.getSessionStorageMode,
        deleteSession: mod.deleteSession,
      };
    });
  }

  return cachedEstimateStoreModule;
}

function syncStorageMode(nextMode: ConversationStorageMode): void {
  storageMode = nextMode;
}

function toConversationSessionRecord(estimateSession: EstimateSessionRecord): ConversationSessionRecord {
  const sessionTimestamp = nowIso();
  const rawTranscript = Array.isArray((estimateSession as { transcript?: unknown }).transcript)
    ? ((estimateSession as { transcript?: unknown }).transcript as Array<{
        role: ConversationRole;
        content: string;
        at: string;
        channel?: string;
        source?: string;
        reasoning?: string;
      }>)
    : [];

  const cleanedTranscript = rawTranscript
    .map((entry) => normalizeLegacyTranscriptContent(entry))
    .filter((entry) => entry.content.trim().length > 0);

  return {
    session_id: (estimateSession as { session_id?: string }).session_id ?? '',
    answers: ((estimateSession as { answers?: unknown }).answers as Record<string, unknown>) ?? {},
    asked_keys: ((estimateSession as { asked_keys?: unknown }).asked_keys as string[]) ?? [],
    transcript: cleanedTranscript,
    last_question_key: (estimateSession as { last_question_key?: string | null }).last_question_key ?? null,
    review_notes: normalizeReviewNotes((estimateSession as { review_notes?: unknown }).review_notes),
    review_status: coerceReviewStatus((estimateSession as { review_status?: unknown }).review_status),
    created_at: ((estimateSession as { created_at?: string }).created_at ?? sessionTimestamp) || sessionTimestamp,
    updated_at: ((estimateSession as { updated_at?: string }).updated_at ?? sessionTimestamp) || sessionTimestamp,
  };
}

export function getConversationStorageMode(): ConversationStorageMode {
  return storageMode;
}

export async function loadConversationSession(sessionId: string): Promise<ConversationSessionRecord> {
  const normalizedSessionId = asText(sessionId);
  if (!normalizedSessionId) {
    throw new Error('session_id is required.');
  }

  const store = await estimateSessionStore();
  syncStorageMode(store.getSessionStorageMode());
  const session = await store.getSession(normalizedSessionId);
  return toConversationSessionRecord(session);
}

export async function listConversationSessions(
  limit = 100,
  reviewStatus?: ConversationReviewStatus
): Promise<ConversationSessionRecord[]> {
  const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.round(limit))) : 100;
  const store = await estimateSessionStore();
  syncStorageMode(store.getSessionStorageMode());
  const sessions = await store.listSessions(normalizedLimit);
  const normalizedStatus =
    reviewStatus === 'processed' || reviewStatus === 'ready' || reviewStatus === 'unprocessed'
      ? reviewStatus
      : undefined;

  const mapped = sessions
    .map((session) => toConversationSessionRecord(session))
    .filter((session) => (normalizedStatus ? session.review_status === normalizedStatus : true));

  return mapped
    .sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime())
    .slice(0, normalizedLimit);
}

export async function appendConversationTurn(
  sessionId: string,
  entry: ConversationTurn
): Promise<ConversationSessionRecord> {
  const normalizedSessionId = asText(sessionId);
  if (!normalizedSessionId) {
    throw new Error('session_id is required.');
  }

  const parsed = parseConversationContent(entry.content, entry.channel);
  const content = parsed.stripped;
  if (!content) {
    return loadConversationSession(normalizedSessionId);
  }

  const store = await estimateSessionStore();
  await store.appendTranscript(normalizedSessionId, {
    role: entry.role,
    content,
    at: asText(entry.at) || nowIso(),
    channel: parsed.channel === 'unknown' ? undefined : parsed.channel,
    reasoning: asText(entry.reasoning),
  });

  syncStorageMode(store.getSessionStorageMode());
  const session = await store.getSession(normalizedSessionId);
  return toConversationSessionRecord(session);
}

export async function setConversationReviewState(
  sessionId: string,
  notes: string | undefined,
  reviewStatus?: ConversationReviewStatus
): Promise<ConversationSessionRecord> {
  const normalizedSessionId = asText(sessionId);
  if (!normalizedSessionId) {
    throw new Error('session_id is required.');
  }

  const store = await estimateSessionStore();
  const current = await store.getSession(normalizedSessionId);
  const normalizedNotes = notes === undefined ? normalizeReviewNotes((current as { review_notes?: unknown }).review_notes) : notes;
  const normalizedStatus =
    coerceReviewStatus(
      reviewStatus === undefined
        ? (notes === undefined || normalizeReviewNotes(notes) === ''
            ? ((current as { review_status?: unknown }).review_status ?? DEFAULT_REVIEW_STATUS)
            : 'ready')
        : reviewStatus
    );

  const next: EstimateSessionRecord = {
    ...(current as EstimateSessionRecord),
    review_notes: normalizedNotes,
    review_status: normalizedStatus,
    updated_at: nowIso(),
  };

  const patched = await store.saveSession(next);
  syncStorageMode(store.getSessionStorageMode());
  return toConversationSessionRecord(patched);
}

export async function deleteConversationSession(sessionId: string): Promise<boolean> {
  const normalizedSessionId = asText(sessionId);
  if (!normalizedSessionId) {
    throw new Error('session_id is required.');
  }

  const store = await estimateSessionStore();
  const deleted = await store.deleteSession(normalizedSessionId);
  syncStorageMode(store.getSessionStorageMode());
  return deleted;
}
