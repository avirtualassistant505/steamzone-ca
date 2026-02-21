type ApiRequest = {
  method?: string;
  body?: unknown;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
  send?: (body: unknown) => void;
};

function parseBody(body: unknown): Record<string, unknown> | null {
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return body as Record<string, unknown>;
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

  const inputText = asText(payload.text).slice(0, 2000);
  if (!inputText) {
    res.status(400).json({ message: 'text is required.' });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    res.status(500).json({
      message: 'OPENAI_API_KEY is missing. Configure it in Vercel project env vars to enable natural voice output.',
    });
    return;
  }

  const model = process.env.OPENAI_VOICE_TTS_MODEL?.trim() || 'gpt-4o-mini-tts';
  const voice = process.env.OPENAI_VOICE_TTS_VOICE?.trim() || 'alloy';
  const format = process.env.OPENAI_VOICE_TTS_FORMAT?.trim() || 'mp3';

  try {
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        voice,
        input: inputText,
        format,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      res.status(502).json({
        message: detail || `Voice generation failed (HTTP ${response.status}).`,
      });
      return;
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    res.status(200);
    res.setHeader('Content-Type', format === 'wav' ? 'audio/wav' : 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Voice-Provider', 'openai');
    res.setHeader('X-Voice-Model', model);

    if (typeof res.send === 'function') {
      res.send(audioBuffer);
      return;
    }

    res.json({
      audio_base64: audioBuffer.toString('base64'),
      mime_type: format === 'wav' ? 'audio/wav' : 'audio/mpeg',
      model,
    });
  } catch (error) {
    res.status(500).json({
      message:
        error instanceof Error ? error.message : 'Unknown voice synthesis error.',
    });
  }
}
