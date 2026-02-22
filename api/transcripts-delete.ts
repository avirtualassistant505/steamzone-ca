type ApiRequest = {
  method?: string;
  body?: unknown;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
};

type DeletePayload = {
  session_id?: unknown;
};

type DeleteResponse = {
  session_id: string;
  deleted: boolean;
  storage_mode: 'database' | 'memory_fallback';
  message?: string;
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseBody(body: unknown): DeletePayload | null {
  if (!body) return null;

  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as DeletePayload) : null;
    } catch {
      return null;
    }
  }

  if (typeof body === 'object' && !Array.isArray(body)) {
    return body as DeletePayload;
  }

  return null;
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

  try {
    const { deleteConversationSession, getConversationStorageMode } = await import('../server/conversationLogStore.js');
    const deleted = await deleteConversationSession(sessionId);

    const response: DeleteResponse = {
      session_id: sessionId,
      deleted,
      storage_mode: getConversationStorageMode(),
      message: deleted ? 'Conversation deleted.' : 'Conversation not found.',
    };

    res.status(200).json(response);
  } catch (error) {
    res.status(500).json({
      session_id: sessionId,
      deleted: false,
      storage_mode: 'memory_fallback',
      message: error instanceof Error ? error.message : 'Unable to delete conversation.',
    });
  }
}
