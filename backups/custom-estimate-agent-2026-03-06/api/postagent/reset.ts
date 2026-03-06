type ApiRequest = {
  method?: string;
  body?: unknown;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
};

type ResetRequestBody = {
  session_id?: unknown;
};

type ResetResponse = {
  session_id: string;
  deleted: boolean;
  storage_mode: 'database' | 'memory_fallback';
  message: string;
};

type EstimateSessionStoreModule = {
  deleteSession: (sessionId: string) => Promise<boolean>;
  getSessionStorageMode: () => 'database' | 'memory_fallback';
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseBody(body: unknown): ResetRequestBody | null {
  if (!body) {
    return null;
  }

  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as ResetRequestBody) : null;
    } catch {
      return null;
    }
  }

  if (typeof body === 'object' && !Array.isArray(body)) {
    return body as ResetRequestBody;
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
    const store = (await import('../../server/estimateAgentSessionStore.js')) as EstimateSessionStoreModule;
    const deleted = await store.deleteSession(sessionId);
    const response: ResetResponse = {
      session_id: sessionId,
      deleted,
      storage_mode: store.getSessionStorageMode(),
      message: deleted ? 'Conversation session reset.' : 'Session was already empty.',
    };

    res.status(200).json(response);
  } catch (error) {
    res.status(500).json({
      session_id: sessionId,
      deleted: false,
      storage_mode: 'memory_fallback',
      message: error instanceof Error ? error.message : 'Unable to reset session.',
    });
  }
}

