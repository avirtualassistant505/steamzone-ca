type ApiRequest = {
  method?: string;
  body?: unknown;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
  setHeader?: (name: string, value: string) => void;
  send?: (body: unknown) => void;
};

function normalizeErrorBody(rawBody: string): string {
  if (!rawBody) {
    return 'OpenAI returned an empty response.';
  }

  const trimmed = rawBody.trim();
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const error = parsed?.error;
    if (error && typeof error === 'object') {
      const maybeMessage = (error as Record<string, unknown>).message;
      if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
        const code = typeof (error as Record<string, unknown>).code === 'string' ? (error as Record<string, unknown>).code : '';
        return `OpenAI realtime call failed: ${maybeMessage}${code ? ` (${code})` : ''}`;
      }
    }
  } catch {
    // Keep the raw text.
  }

  return trimmed;
}

function readSdpBody(body: unknown): string {
  if (typeof body === 'string') {
    return body.trim();
  }

  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const maybe = (body as Record<string, unknown>).sdp;
    if (typeof maybe === 'string') {
      return maybe.trim();
    }
  }

  return '';
}

const REALTIME_INSTRUCTIONS = [
  'You are Steam Zone AI Voice Receptionist.',
  'Use the postagent_estimate_turn tool for customer-facing business replies so voice stays aligned with the shared estimate/chat knowledge base.',
  'Keep responses concise, natural, and call-like.',
  'For estimates: collect minimum required details and proceed step-by-step.',
  'If the user asks an informational question, answer it first using the tool result.',
  'Do not invent pricing; only use pricing from tool outputs.',
].join('\n');

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed.' });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    res.status(500).json({
      message: 'OPENAI_API_KEY is missing. Configure it in project environment variables.',
    });
    return;
  }

  const sdp = readSdpBody(req.body);
  if (!sdp) {
    res.status(400).json({ message: 'Missing SDP body.' });
    return;
  }

  const model = process.env.OPENAI_REALTIME_MODEL?.trim() || 'gpt-realtime';
  const voice = process.env.OPENAI_REALTIME_VOICE?.trim() || 'marin';

  const sessionConfig = {
    type: 'realtime',
    model,
    instructions: REALTIME_INSTRUCTIONS,
    audio: {
      input: {
        turn_detection: {
          type: 'server_vad',
        },
      },
      output: {
        voice,
      },
    },
    tools: [
      {
        type: 'function',
        name: 'postagent_estimate_turn',
        description:
          'Run one shared estimate-agent turn using the existing Steam Zone postagent logic and shared training data.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            session_id: { type: 'string' },
            user_text: { type: 'string' },
          },
          required: ['session_id', 'user_text'],
        },
      },
    ],
    tool_choice: 'auto',
  };

  try {
    const form = new FormData();
    const sessionBlob = new Blob([JSON.stringify(sessionConfig)], {
      type: 'application/json',
    });
    const sdpBlob = new Blob([sdp], {
      type: 'application/sdp',
    });

    form.set('sdp', sdpBlob);
    form.set('session', sessionBlob);

    const openAiResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'OpenAI-Beta': 'realtime=v1',
      },
      body: form,
    });

    const raw = await openAiResponse.text();
    if (!openAiResponse.ok) {
      res.status(502).json({
        message: `${normalizeErrorBody(raw) || `OpenAI realtime call failed (${openAiResponse.status}).`}`,
      });
      return;
    }

    if (typeof raw !== 'string' || !raw.trim().startsWith('v=')) {
      res.status(502).json({
        message:
          'OpenAI realtime call did not return a valid SDP answer. Check the realtime model and payload format.',
      });
      return;
    }

    if (typeof res.setHeader === 'function') {
      res.setHeader('Content-Type', 'application/sdp');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Realtime-Model', model);
      res.setHeader('X-Realtime-Voice', voice);
    }

    if (typeof res.send === 'function') {
      res.status(200).send(raw);
      return;
    }

    res.status(200).json({ sdp: raw, model, voice });
  } catch (error) {
    res.status(500).json({
      message: error instanceof Error ? error.message : 'Failed to initialize realtime call.',
    });
  }
}
