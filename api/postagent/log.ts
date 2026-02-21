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

function withChannelAndMetadata(
  content: string,
  channel: string,
  metadata: unknown
): string {
  const prefix = channel ? `[${channel}] ` : '';
  const base = `${prefix}${content}`.trim();
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return base;
  }

  const serialized = JSON.stringify(metadata);
  return serialized ? `${base} ${serialized}` : base;
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
  const line = withChannelAndMetadata(content, channel, payload.metadata);

  try {
    const { getSupabaseAdminClient } = await import('../../server/supabaseAdmin.js');
    const supabase = await getSupabaseAdminClient();
    const storage_mode = supabase ? 'database' : 'memory_fallback';

    const core = await import('../../src/estimate/core/estimateAgentCore.js');
    await core.appendTranscript(sessionId, role, line);

    let persisted = true;
    try {
      const { getSession } = await import('../../server/estimateAgentSessionStore.js');
      const state = await getSession(sessionId);
      persisted = Array.isArray(state.transcript) && state.transcript.some((entry) => {
        const rec = entry as { role?: string; content?: string };
        return rec.role === role && typeof rec.content === 'string' && rec.content.includes(content);
      });
    } catch {
      persisted = true;
    }

    res.status(200).json({
      ok: persisted,
      storage_mode,
      message: persisted
        ? undefined
        : 'Log write accepted but could not confirm persisted transcript entry.',
    });
  } catch (error) {
    res.status(500).json({
      message: error instanceof Error ? error.message : 'Failed to persist conversation log.',
    });
  }
}
