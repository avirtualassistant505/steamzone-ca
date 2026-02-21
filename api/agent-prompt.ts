import type { AgentPromptPayload } from '../server/agentPromptStore.js';
import {
  DEFAULT_AGENT_SYSTEM_PROMPT,
  getAgentSystemPromptConfig,
  setAgentSystemPrompt,
} from '../server/agentPromptStore.js';

type ApiRequest = {
  method?: string;
  body?: unknown;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
};

type PromptResponse = AgentPromptPayload & {
  message?: string;
  defaultPrompt?: string;
};

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    if (req.method === 'GET') {
      const payload = await getAgentSystemPromptConfig();
      res.status(200).json({
        ...payload,
        defaultPrompt: DEFAULT_AGENT_SYSTEM_PROMPT,
        message: `Loaded agent prompt from ${payload.source}.`,
      } satisfies PromptResponse);
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

    const rawPrompt = (body as { prompt?: unknown }).prompt;
    if (typeof rawPrompt !== 'string') {
      res.status(400).json({ message: 'Missing prompt string.' });
      return;
    }

    const payload = await setAgentSystemPrompt(rawPrompt);
    res.status(200).json({
      ...payload,
      defaultPrompt: DEFAULT_AGENT_SYSTEM_PROMPT,
      message: `Agent prompt updated in ${payload.source === 'db' ? 'database' : 'fallback mode'}.`,
    } satisfies PromptResponse);
    return;
  } catch (error) {
    res.status(500).json({
      message: error instanceof Error ? error.message : 'Unable to load or save agent prompt.',
      defaultPrompt: DEFAULT_AGENT_SYSTEM_PROMPT,
    });
  }
}
