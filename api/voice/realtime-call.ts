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

type SessionConfig = Record<string, unknown>;
type TransportMode = 'form' | 'json';

type RealtimeAttempt = {
  config: SessionConfig;
  transport: TransportMode;
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
    return body;
  }

  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const maybe = (body as Record<string, unknown>).sdp;
    if (typeof maybe === 'string') {
      return maybe;
    }
  }

  return '';
}

function buildRealtimeSessionConfigs(model: string, voice: string): SessionConfig[] {
  const baseTools = [
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
  ];

  const modernConfig = {
    model,
    instructions: REALTIME_INSTRUCTIONS,
    modalities: ['text', 'audio'],
    voice,
    input_audio_format: 'pcm16',
    output_audio_format: 'pcm16',
    input_audio_transcription: {
      model: 'whisper-1',
    },
    turn_detection: {
      type: 'server_vad',
    },
    tools: baseTools,
    tool_choice: 'auto',
  };

  return [modernConfig];
}

function isUnknownParameterError(text: string): boolean {
  return text.includes('unknown_parameter') || text.includes('Unknown parameter');
}

function normalizeTransportConfig(
  sdp: string,
  config: SessionConfig,
  transport: TransportMode
): { body: BodyInit; headers: Record<string, string> } {
  const headers: Record<string, string> = {
    Authorization: '',
    'OpenAI-Beta': 'realtime=v1',
  };

  if (transport === 'json') {
    return {
      body: JSON.stringify({
        sdp,
        session: config,
      }),
      headers: { ...headers, 'Content-Type': 'application/json' },
    };
  }

  const form = new FormData();
  form.set('sdp', sdp);
  form.set('session', JSON.stringify(config));
  return {
    body: form,
    headers,
  };
}

const REALTIME_INSTRUCTIONS = [
  'You are Steam Zone AI Voice Receptionist.',
  'Always start in English (en-CA). Only switch languages if the caller explicitly asks you to.',
  'Never auto-switch to Spanish or any other language based on accent or locale.',
  'Use the postagent_estimate_turn tool for customer-facing business replies so voice stays aligned with the shared estimate/chat knowledge base.',
  'Keep responses concise, natural, and call-like.',
  'Ask exactly one question per turn. Never ask two questions in one reply.',
  'If you need extra time to process, first say: "One moment while I check that for you."',
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
  if (!sdp || !sdp.trim()) {
    res.status(400).json({ message: 'Missing SDP body.' });
    return;
  }

  const storedModelConfig = await import('../../server/agentModelStore.js')
    .then((mod) => mod.getAgentModelConfig())
    .catch(() => null);
  const storedVoiceModel = storedModelConfig?.voiceModel?.trim() ?? '';
  const inferredRealtimeModel =
    storedVoiceModel && storedVoiceModel.toLowerCase().includes('realtime')
      ? storedVoiceModel.replace(/^openai\//i, '')
      : '';

  const model =
    process.env.OPENAI_REALTIME_MODEL?.trim() ||
    inferredRealtimeModel ||
    'gpt-realtime';
  const voice = process.env.OPENAI_REALTIME_VOICE?.trim() || 'marin';
  const preferredConfigs = buildRealtimeSessionConfigs(model, voice);
  const attempts: RealtimeAttempt[] = preferredConfigs.flatMap((config) => [
    { config, transport: 'json' },
    { config, transport: 'form' },
  ]);

  const fallbackModel = model === 'gpt-realtime' ? 'gpt-4o-realtime-preview' : model;
  if (fallbackModel !== model) {
    const fallbackConfigs = buildRealtimeSessionConfigs(fallbackModel, voice);
    for (const config of fallbackConfigs) {
      attempts.push({ config, transport: 'form' });
      attempts.push({ config, transport: 'json' });
    }
  }

  try {
    let lastError = 'OpenAI realtime call failed.';
    for (const attempt of attempts) {
      const request = normalizeTransportConfig(sdp, attempt.config, attempt.transport);
      const openAiResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        headers: {
          ...request.headers,
          Authorization: `Bearer ${apiKey}`,
        },
        body: request.body,
      });

      const raw = await openAiResponse.text();
      if (!openAiResponse.ok) {
        const message = normalizeErrorBody(raw);
        if (!message) {
          continue;
        }
        lastError = message;
        if (!isUnknownParameterError(message) && openAiResponse.status >= 500) {
          break;
        }
        continue;
      }

      if (typeof raw !== 'string' || !raw.trim().startsWith('v=')) {
        lastError =
          'OpenAI returned an invalid SDP answer. Retrying with alternate session payload.';
        continue;
      }

      const usedConfig = attempt.config;
      const usedModel = typeof usedConfig.model === 'string' && usedConfig.model.trim() ? usedConfig.model : model;
      const usedVoice =
        typeof usedConfig.voice === 'string' && usedConfig.voice.trim() ? usedConfig.voice : voice;

      if (typeof res.setHeader === 'function') {
        res.setHeader('Content-Type', 'application/sdp');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Realtime-Model', usedModel);
        res.setHeader('X-Realtime-Voice', usedVoice);
        res.setHeader('X-Realtime-Transport', attempt.transport);
      }

      if (typeof res.send === 'function') {
        res.status(200).send(raw);
        return;
      }

      res.status(200).json({ sdp: raw, model: usedModel, voice: usedVoice });
      return;
    }

    res.status(502).json({
      message: lastError || `OpenAI realtime call failed (all payload variants rejected).`,
    });
  } catch (error) {
    res.status(500).json({
      message: error instanceof Error ? error.message : 'Failed to initialize realtime call.',
    });
  }
}
