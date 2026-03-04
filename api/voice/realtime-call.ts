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

type RealtimeAttempt = {
  id: string;
  sdp: string;
  model: string;
  voice: string;
  language: 'en' | 'es';
  includeQueryModel: boolean;
  useLegacySessionShape: boolean;
  includeTranscription: boolean;
};

const BASE_TOOLS = [
  {
    type: 'function',
    name: 'postagent_estimate_turn',
    description: 'Run one shared estimate-agent turn using the existing Steam Zone postagent logic and shared training data.',
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
] as const;

function normalizeLanguage(value: unknown): 'en' | 'es' {
  return value === 'es' ? 'es' : 'en';
}

function buildRealtimeInstructions(language: 'en' | 'es'): string {
  const languageRules =
    language === 'es'
      ? [
          'Start and continue in Spanish (es-CA).',
          'Only switch to English if the caller explicitly requests English.',
        ]
      : [
          'Start and continue in English (en-CA).',
          'Only switch to Spanish if the caller explicitly requests Spanish.',
        ];

  return [
    'You are Steam Zone AI Voice Receptionist.',
    ...languageRules,
    'Use the postagent_estimate_turn tool for customer-facing business replies so voice stays aligned with the shared estimate/chat knowledge base.',
    'Keep responses concise, natural, and call-like.',
    'Ask exactly one question per turn. Never ask two questions in one reply.',
    'If you need extra time to process, first say: "One moment while I check that for you."',
    'For estimates: collect minimum required details and proceed step-by-step.',
    'If the user asks an informational question, answer it first using the tool result.',
    'Do not invent pricing; only use pricing from tool outputs.',
  ].join('\n');
}

function parseJsonBody(rawBody: unknown): Record<string, unknown> | null {
  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    return null;
  }

  return rawBody as Record<string, unknown>;
}

function readCallPayload(body: unknown): { sdp: string; language: 'en' | 'es' } {
  if (typeof body === 'string') {
    const trimmed = body.trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        return {
          sdp: typeof parsed.sdp === 'string' ? parsed.sdp : '',
          language: normalizeLanguage(parsed.language),
        };
      } catch {
        // Fall through and treat body as raw SDP.
      }
    }
    return {
      sdp: body,
      language: 'en',
    };
  }
  const parsed = parseJsonBody(body);
  if (!parsed) {
    return {
      sdp: '',
      language: 'en',
    };
  }
  const candidate = parsed.sdp;
  return {
    sdp: typeof candidate === 'string' ? candidate : '',
    language: normalizeLanguage(parsed.language),
  };
}

function parseError(rawBody: string): string {
  if (!rawBody) {
    return 'OpenAI returned an empty response.';
  }

  try {
    const parsed = JSON.parse(rawBody.trim()) as { error?: Record<string, unknown> };
    const message = parsed?.error?.message;
    if (typeof message === 'string' && message.trim()) {
      const code = typeof parsed.error?.code === 'string' ? ` (${parsed.error.code})` : '';
      return `OpenAI realtime call failed: ${message.trim()}${code}`;
    }
  } catch {
    // Keep raw response.
  }

  return rawBody.trim();
}

function extractUnknownParameter(message: string): string | null {
  if (!message || !message.toLowerCase().includes('unknown parameter')) {
    return null;
  }
  const match = message.match(/unknown parameter(?: field)?\s*[:'"-]?\s*([a-z0-9_.]+)/i);
  return match?.[1] ? match[1].trim() : '';
}

function normalizeRealtimeModels(raw: string): string[] {
  const lowered = raw.trim().toLowerCase();
  const base = lowered.replace(/^openai\//, '');
  if (!base) {
    return ['gpt-realtime', 'gpt-4o-realtime-preview'];
  }

  if (base === 'gpt-audio-mini' || base === 'gpt-audio') {
    return ['gpt-realtime', 'gpt-4o-realtime-preview'];
  }

  if (base.includes('realtime')) {
    return [base];
  }

  if (base === 'gpt-4o') {
    return ['gpt-4o-realtime-preview', 'gpt-realtime'];
  }

  return ['gpt-realtime', 'gpt-4o-realtime-preview'];
}

function buildSessionConfig(attempt: RealtimeAttempt): Record<string, unknown> {
  if (attempt.useLegacySessionShape) {
    const sessionConfig: Record<string, unknown> = {
      type: 'realtime',
      model: attempt.model,
      instructions: buildRealtimeInstructions(attempt.language),
      modalities: ['text', 'audio'],
      tools: BASE_TOOLS,
      tool_choice: 'auto',
      turn_detection: { type: 'server_vad' },
      voice: attempt.voice,
    };
    if (attempt.includeTranscription) {
      sessionConfig.input_audio_transcription = { model: 'whisper-1' };
    }
    return sessionConfig;
  }

  const audioInput: Record<string, unknown> = {
    turn_detection: { type: 'server_vad' },
  };
  if (attempt.includeTranscription) {
    // Preferred transcription shape for recent realtime sessions.
    audioInput.transcription = { model: 'gpt-4o-mini-transcribe' };
  }

  return {
    type: 'realtime',
    model: attempt.model,
    instructions: buildRealtimeInstructions(attempt.language),
    modalities: ['text', 'audio'],
    tools: BASE_TOOLS,
    tool_choice: 'auto',
    audio: {
      input: audioInput,
      output: { voice: attempt.voice },
    },
  };
}

function buildRequestBody(attempt: RealtimeAttempt): BodyInit {
  const form = new FormData();
  form.set('sdp', attempt.sdp);
  form.set('session', JSON.stringify(buildSessionConfig(attempt)));
  return form;
}

function buildAttempts(sdp: string, voice: string, rawModels: string[], language: 'en' | 'es'): RealtimeAttempt[] {
  const transcriptionModes = [false, true];
  const attempts: RealtimeAttempt[] = [];

  for (const model of rawModels) {
    for (const includeTranscription of transcriptionModes) {
      attempts.push({
        id: `${model}-${includeTranscription ? 'withTranscription' : 'noTranscription'}-modern-query`,
        sdp,
        model,
        voice,
        includeTranscription,
        language,
        includeQueryModel: true,
        useLegacySessionShape: false,
      });
      attempts.push({
        id: `${model}-${includeTranscription ? 'withTranscription' : 'noTranscription'}-legacy-query`,
        sdp,
        model,
        voice,
        includeTranscription,
        language,
        includeQueryModel: true,
        useLegacySessionShape: true,
      });
      attempts.push({
        id: `${model}-${includeTranscription ? 'withTranscription' : 'noTranscription'}-modern-noquery`,
        sdp,
        model,
        voice,
        includeTranscription,
        language,
        includeQueryModel: false,
        useLegacySessionShape: false,
      });
    }
  }

  return attempts;
}

const DEFAULT_VOICE_FALLBACK = 'alloy';

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

  const { sdp, language } = readCallPayload(req.body);
  if (!sdp.trim()) {
    res.status(400).json({ message: 'Missing SDP body.' });
    return;
  }

  const storedModelConfig = await import('../../server/agentModelStore.js')
    .then((mod) => mod.getAgentModelConfig())
    .catch(() => null);
  const configuredVoice = process.env.OPENAI_REALTIME_VOICE?.trim() || DEFAULT_VOICE_FALLBACK;
  const rawModel =
    process.env.OPENAI_REALTIME_MODEL?.trim() ||
    storedModelConfig?.voiceModel?.trim() ||
    'gpt-realtime';
  const voice = configuredVoice || DEFAULT_VOICE_FALLBACK;
  const models = normalizeRealtimeModels(rawModel);
  const uniqueModels = Array.from(new Set(models.filter(Boolean)));

  const attempts = buildAttempts(sdp, voice, uniqueModels, language);
  let lastError = 'OpenAI realtime call failed.';

  try {
    for (const attempt of attempts) {
      const endpoint = attempt.includeQueryModel
        ? `https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(attempt.model)}`
        : 'https://api.openai.com/v1/realtime/calls';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'OpenAI-Beta': 'realtime=v1',
        },
        body: buildRequestBody(attempt),
      });

      const raw = await response.text();
      if (!response.ok) {
        const message = parseError(raw);
        lastError = message || 'OpenAI realtime call failed.';

        const unknown = extractUnknownParameter(message);
        if (unknown) {
          // Continue to next candidate shape; do not retry modified variants for the same payload family.
          continue;
        }

        if (response.status >= 500) {
          break;
        }
        continue;
      }

      if (!raw.trim().startsWith('v=')) {
        lastError = `OpenAI returned an invalid SDP answer (unexpected payload for attempt ${attempt.id}).`;
        continue;
      }

      if (typeof res.setHeader === 'function') {
        res.setHeader('Content-Type', 'application/sdp');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Realtime-Model', attempt.model);
      }

      if (typeof res.send === 'function') {
        res.status(200).send(raw);
      } else {
        res.status(200).json({ sdp: raw });
      }
      return;
    }

    res.status(502).json({ message: lastError });
  } catch (error) {
    res.status(500).json({
      message: error instanceof Error ? error.message : 'Failed to initialize realtime call.',
    });
  }
}
