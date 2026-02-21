import { getAgentModelConfig, getAgentModelOptions, setAgentModelConfig } from '../server/agentModelStore';
import { AGENT_DEFAULT_MODEL, AGENT_DEFAULT_MODEL_LABEL } from '../src/estimate/core/agentModelConfig';

type ApiRequest = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
};

function getBearerToken(req: ApiRequest): string | null {
  const raw = req.headers?.authorization ?? req.headers?.Authorization ?? '';
  const header = typeof raw === 'string' ? raw : '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function getToken(req: ApiRequest): string | null {
  return (
    getBearerToken(req) ??
    (typeof req.headers?.['x-admin-training-token'] === 'string' ? req.headers?.['x-admin-training-token'].trim() : null)
  );
}

function buildConfigPayload() {
  return {
    available_models: getAgentModelOptions(),
    default_model: AGENT_DEFAULT_MODEL,
    default_model_label: AGENT_DEFAULT_MODEL_LABEL,
  };
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method === 'GET') {
    const config = await getAgentModelConfig();
    res.status(200).json({
      ...config,
      ...buildConfigPayload(),
      message: `Loaded model "${config.model}" from ${config.source === 'db' ? 'database' : 'fallback'}.`,
    });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  const expectedToken = process.env.ADMIN_TRAINING_TOKEN || process.env.ADMIN_PRICING_TOKEN;
  if (!expectedToken) {
    res.status(500).json({ message: 'ADMIN_TRAINING_TOKEN is not configured on the server.' });
    return;
  }

  const provided = getToken(req);
  if (provided !== expectedToken) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  const body = typeof req.body === 'string'
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

  const model = normalizeModelPayload(body?.model);
  if (!model) {
    res.status(400).json({ message: 'Missing model value.' });
    return;
  }

  try {
    const saved = await setAgentModelConfig(model);
    res.status(200).json({
      ...saved,
      ...buildConfigPayload(),
      message: 'Model updated.',
    });
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to save model.' });
  }
}

function normalizeModelPayload(raw: unknown): string | null {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) {
    return null;
  }

  const allowed = getAgentModelOptions().some((option) => option.value === value);
  return allowed ? value : null;
}
