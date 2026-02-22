import { getConversationStorageMode, listConversationSessions, loadConversationSession } from '../server/conversationLogStore.js';

type ApiRequest = {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
};

type Role = 'user' | 'assistant' | 'tool';

type ConversationTurn = {
  role: Role;
  content: string;
  at: string;
  channel?: string;
  reasoning?: string;
};

type ReviewStatus = 'processed' | 'ready' | 'unprocessed';

type ConversationSummary = {
  session_id: string;
  created_at: string;
  updated_at: string;
  turn_count: number;
  channels: string[];
  preview: string;
  last_question_key: string | null;
  review_status: ReviewStatus;
  review_notes: string;
};

function asText(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0]?.trim() ?? '';
  }
  return value?.trim() ?? '';
}

function detectChannel(entry: { content: string; channel?: string }): { channel: string; stripped: string } {
  if (entry.channel) {
    const trimmed = entry.channel.trim().toLowerCase();
    if (trimmed === 'web' || trimmed === 'voice' || trimmed === 'sms' || trimmed === 'test') {
      return { channel: trimmed, stripped: stripTrailingMetadata(entry.content.trim()) };
    }
  }

  const match = entry.content.match(/^\[(web|voice|sms|test)\]\s*/i);
  if (!match) {
    return { channel: 'unknown', stripped: stripTrailingMetadata(entry.content.trim()) };
  }

  return {
    channel: match[1].toLowerCase(),
    stripped: stripTrailingMetadata(entry.content.slice(match[0].length).trim()),
  };
}

function stripTrailingMetadata(content: string): string {
  const trimmed = content.trim();
  const match = trimmed.match(/^(.*?)(\s+\{.*\})$/s);
  if (!match) return trimmed;

  const text = match[1].trim();
  const maybeMetadata = match[2].trim();
  try {
    JSON.parse(maybeMetadata);
    return text;
  } catch {
    return trimmed;
  }
}

function toConversationTurns(
  transcript: Array<{ role: Role; content: string; at: string; reasoning?: string; channel?: string }>
): ConversationTurn[] {
  return transcript.map((entry) => {
    const parsed = detectChannel({ content: entry.content || '', channel: entry.channel });
    return {
      role: entry.role,
      content: parsed.stripped,
      at: entry.at,
      channel: parsed.channel,
      reasoning: typeof entry.reasoning === 'string' ? entry.reasoning : undefined,
    };
  });
}

function summarizeSession(session: {
  session_id: string;
  created_at: string;
  updated_at: string;
  transcript: Array<{ role: Role; content: string; at: string }>;
  last_question_key: string | null;
  review_status?: ReviewStatus;
  review_notes?: string;
}): ConversationSummary {
  const turns = toConversationTurns(session.transcript || []);
  const channels = Array.from(
    new Set(
      turns
        .map((turn) => turn.channel)
        .filter((channel) => channel && channel !== 'unknown')
    )
  );
  const lastTurn = turns[turns.length - 1];
  const preview = (lastTurn?.content || '').slice(0, 180);

  return {
    session_id: session.session_id,
    created_at: session.created_at,
    updated_at: session.updated_at,
    turn_count: turns.length,
    channels,
    preview,
    last_question_key: session.last_question_key ?? null,
    review_status: session.review_status ?? 'unprocessed',
    review_notes: (session.review_notes ?? '').trim(),
  };
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ message: 'Method not allowed.' });
    return;
  }

  try {
    const sessionId = asText(req.query?.session_id);
    const rawStatus = asText(req.query?.status);
    const limitRaw = Number(asText(req.query?.limit) || '100');
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.round(limitRaw))) : 100;
    const normalizedStatus =
      rawStatus === 'processed' || rawStatus === 'ready' || rawStatus === 'unprocessed' ? rawStatus : undefined;

    if (sessionId) {
      const session = await loadConversationSession(sessionId);
      const turns = toConversationTurns(session.transcript);
      const storageMode = getConversationStorageMode();
      res.status(200).json({
        storage_mode: storageMode,
        session: {
          session_id: session.session_id,
          created_at: session.created_at,
          updated_at: session.updated_at,
          answers: session.answers,
          asked_keys: session.asked_keys,
          last_question_key: session.last_question_key,
          review_status: session.review_status,
          review_notes: session.review_notes,
          transcript: turns,
        },
      });
      return;
    }

    const sessions = await listConversationSessions(limit, normalizedStatus);
    const storageMode = getConversationStorageMode();
    const summaries = sessions
      .filter((session) => session.session_id)
      .map((session) =>
        summarizeSession({
          session_id: session.session_id,
          created_at: session.created_at,
          updated_at: session.updated_at,
          transcript: session.transcript as Array<{ role: Role; content: string; at: string }>,
          last_question_key: session.last_question_key,
          review_status: session.review_status,
          review_notes: session.review_notes,
        })
      );

    res.status(200).json({ sessions: summaries, storage_mode: storageMode });
  } catch (error) {
    res.status(500).json({
      message: error instanceof Error ? error.message : 'Unable to load conversation transcripts.',
    });
  }
}
