type ApiRequest = { method?: string; body?: unknown };
type ApiResponse = { status: (code: number) => ApiResponse; json: (body: unknown) => void };

type LogPayload = {
  session_id?: unknown;
  role?: unknown;
  content?: unknown;
  channel?: unknown;
  metadata?: unknown;
};

function parseBody(body: unknown): LogPayload | null {
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as LogPayload;
      }
      return null;
    } catch {
      return null;
    }
  }

  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return body as LogPayload;
  }

  return null;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed.' });
    return;
  }

  const payload = parseBody(req.body);
  if (!payload) {
    res.status(400).json({ message: 'Invalid JSON body.' });
    return;
  }

  const sessionId = asText(payload.session_id);
  if (!sessionId) {
    res.status(400).json({ message: 'session_id is required.' });
    return;
  }

  const role = asText(payload.role);
  if (role !== 'user' && role !== 'assistant' && role !== 'tool') {
    res.status(400).json({ message: 'role must be one of: user, assistant, tool.' });
    return;
  }

  const content = asText(payload.content);
  if (!content) {
    res.status(400).json({ message: 'content is required.' });
    return;
  }

  const channel = asText(payload.channel);

  try {
    const { appendConversationTurn, getConversationStorageMode } = await import('../../server/conversationLogStore.js');
    const normalizedChannel = channel ? channel.toLowerCase() : '';
    await appendConversationTurn(sessionId, {
      role,
      content,
      at: new Date().toISOString(),
      channel: normalizedChannel,
    });

    res.status(200).json({
      ok: true,
      storage_mode: getConversationStorageMode(),
    });
  } catch (error) {
    res.status(500).json({
      message: error instanceof Error ? error.message : 'Failed to persist conversation log.',
    });
  }
}
