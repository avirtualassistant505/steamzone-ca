import {
  AGENT_DEFAULT_MODEL,
  AGENT_DEFAULT_MODEL_LABEL,
  AGENT_DEFAULT_VOICE_MODEL,
  AGENT_VOICE_MODEL_OPTIONS,
} from '../src/estimate/core/agentModelConfig.js';

type ApiRequest = {
  method?: string;
  body?: unknown;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
};

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const {
      getAgentModelConfig,
      getAgentModelOptions,
      getAgentVoiceModelOptions,
      setAgentModelConfig,
    } = await import('../server/agentModelStore.js');

    const buildConfigPayload = () => ({
      available_models: getAgentModelOptions(),
      available_voice_models:
        AGENT_VOICE_MODEL_OPTIONS.length > 0 ? AGENT_VOICE_MODEL_OPTIONS : getAgentVoiceModelOptions(),
      default_model: AGENT_DEFAULT_MODEL,
      default_model_label: AGENT_DEFAULT_MODEL_LABEL,
      default_voice_model: AGENT_DEFAULT_VOICE_MODEL,
    });

    const normalizeModelPayload = (raw: unknown): string | null => {
      const value = typeof raw === 'string' ? raw.trim() : '';
      if (!value) return null;
      return getAgentModelOptions().some((option) => option.value === value) ? value : null;
    };

    const normalizeVoiceModelPayload = (raw: unknown): string | null => {
      const value = typeof raw === 'string' ? raw.trim() : '';
      if (!value) return null;
      return getAgentVoiceModelOptions().some((option) => option.value === value) ? value : null;
    };

    if (req.method === 'GET') {
      const config = await getAgentModelConfig();
      res.status(200).json({
        ...config,
        ...buildConfigPayload(),
        message: `Loaded model "${config.model}" and voice model "${config.voiceModel}" from ${
          config.source === 'db' ? 'database' : 'fallback'
        }.`,
      });
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ message: 'Method not allowed' });
      return;
    }

    const body =
      typeof req.body === 'string'
        ? (() => {
            try {
              return JSON.parse(req.body);
            } catch {
              return null;
            }
          })()
        : req.body;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      res.status(400).json({ message: 'Invalid request body.' });
      return;
    }

    const textModel = normalizeModelPayload((body as { model?: unknown }).model);
    const voiceModel = normalizeVoiceModelPayload((body as { voice_model?: unknown }).voice_model);

    if (!textModel && !voiceModel) {
      res.status(400).json({ message: 'Missing model and/or voice_model value.' });
      return;
    }

    const payload = {
      model: textModel ?? undefined,
      voice_model: voiceModel ?? undefined,
    };

    try {
      const saved = await setAgentModelConfig(payload);
      res.status(200).json({
        ...saved,
        ...buildConfigPayload(),
        message: 'Model settings updated.',
      });
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to save model settings.' });
    }
    return;
  } catch (error) {
    res.status(500).json({
      message:
        error instanceof Error ? `Failed to initialize model endpoint: ${error.message}` : 'Failed to initialize model endpoint.',
    });
  }
}
