import { listConversationSessions, loadConversationSession } from '../server/conversationLogStore.js';

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
  channel: string;
};

type ConversationSummary = {
  session_id: string;
  created_at: string;
  updated_at: string;
  turn_count: number;
  channels: string[];
  preview: string;
  last_question_key: string | null;
};

function asText(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0]?.trim() ?? '';
  }
  return value?.trim() ?? '';
}

function detectChannel(content: string): { channel: string; stripped: string } {
  const match = content.match(/^\[(web|voice|sms|test)\]\s*/i);
  if (!match) {
    return { channel: 'unknown', stripped: content.trim() };
  }

  return {
    channel: match[1].toLowerCase(),
    stripped: content.slice(match[0].length).trim(),
  };
}

function toConversationTurns(
  transcript: Array<{ role: Role; content: string; at: string }>
): ConversationTurn[] {
  return transcript.map((entry) => {
    const parsed = detectChannel(entry.content || '');
    return {
      role: entry.role,
      content: parsed.stripped,
      at: entry.at,
      channel: parsed.channel,
    };
  });
}

function summarizeSession(session: {
  session_id: string;
  created_at: string;
  updated_at: string;
  transcript: Array<{ role: Role; content: string; at: string }>;
  last_question_key: string | null;
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
  };
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ message: 'Method not allowed.' });
    return;
  }

  try {
    const sessionId = asText(req.query?.session_id);
    const limitRaw = Number(asText(req.query?.limit) || '100');
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.round(limitRaw))) : 100;

    if (sessionId) {
      const session = await loadConversationSession(sessionId);
      const turns = toConversationTurns(session.transcript);
      res.status(200).json({
        storage_mode: 'database',
        session: {
          session_id: session.session_id,
          created_at: session.created_at,
          updated_at: session.updated_at,
          answers: session.answers,
          asked_keys: session.asked_keys,
          last_question_key: session.last_question_key,
          transcript: turns,
        },
      });
      return;
    }

    const sessions = await listConversationSessions(limit);
    const summaries = sessions
      .filter((session) => session.session_id)
      .map((session) =>
        summarizeSession({
          session_id: session.session_id,
          created_at: session.created_at,
          updated_at: session.updated_at,
          transcript: session.transcript as Array<{ role: Role; content: string; at: string }>,
          last_question_key: session.last_question_key,
        })
      );

    res.status(200).json({ sessions: summaries, storage_mode: 'database' });
  } catch (error) {
    res.status(500).json({
      message: error instanceof Error ? error.message : 'Unable to load conversation transcripts.',
    });
  }
}
