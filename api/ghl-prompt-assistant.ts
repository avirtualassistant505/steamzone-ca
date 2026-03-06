type ApiRequest = {
  method?: string;
  body?: unknown;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
};

type PromptAssistantPayload = {
  assistant_message: string;
  drafted_value: string;
  model: string;
  source: 'llm' | 'fallback';
};

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const OPENROUTER_RESPONSES_URL = 'https://openrouter.ai/api/v1/responses';
const PROMPT_ASSISTANT_DEFAULT_MODEL = 'openai/gpt-5.2-chat';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseBody(body: unknown): Record<string, unknown> | null {
  if (typeof body === 'string') {
    try {
      return asRecord(JSON.parse(body));
    } catch {
      return null;
    }
  }
  return asRecord(body);
}

function normalizeOpenAIModelForDirect(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) return 'gpt-5.2';
  if (trimmed.startsWith('openai/')) return trimmed.replace('openai/', '').trim() || 'gpt-5.2';
  if (trimmed.includes('/')) return 'gpt-5.2';
  return trimmed;
}

function parseAssistantJson(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function fallbackResponse(currentValue: string, request: string): PromptAssistantPayload {
  return {
    assistant_message: request
      ? 'Prompt draft assistant is unavailable right now. Edit manually or try again once an AI provider key is configured.'
      : 'Enter a change request to draft an updated prompt.',
    drafted_value: currentValue,
    model: PROMPT_ASSISTANT_DEFAULT_MODEL,
    source: 'fallback',
  };
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  const body = parseBody(req.body);
  if (!body) {
    res.status(400).json({ message: 'Invalid JSON body.' });
    return;
  }

  const promptType = String(body.promptType ?? '').trim();
  const fieldLabel = String(body.fieldLabel ?? '').trim();
  const currentValue = String(body.currentValue ?? '').trim();
  const request = String(body.request ?? '').trim();

  if (!promptType || !fieldLabel) {
    res.status(400).json({ message: 'promptType and fieldLabel are required.' });
    return;
  }
  if (!currentValue) {
    res.status(400).json({ message: 'currentValue is required.' });
    return;
  }
  if (!request) {
    res.status(400).json({ message: 'request is required.' });
    return;
  }

  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();
  const openAiKey = process.env.OPENAI_API_KEY?.trim();
  if (!openRouterKey && !openAiKey) {
    res.status(200).json(fallbackResponse(currentValue, request));
    return;
  }

  const provider = openRouterKey ? 'openrouter' : 'openai';
  const apiKey = openRouterKey || openAiKey || '';
  const endpoint = provider === 'openrouter' ? OPENROUTER_RESPONSES_URL : OPENAI_RESPONSES_URL;
  const requestedModel = provider === 'openrouter' ? PROMPT_ASSISTANT_DEFAULT_MODEL : normalizeOpenAIModelForDirect(PROMPT_ASSISTANT_DEFAULT_MODEL);

  const systemInstructions = [
    'You edit live operational prompt fields for Steam Zone GoHighLevel agents.',
    'Return ONLY valid JSON with keys assistant_message and drafted_value.',
    'assistant_message must be one short sentence explaining the change.',
    'drafted_value must be the full revised field text.',
    'Preserve URLs, enumerated options, canonical field names, serviceType values, and any explicit compliance rules unless the admin request explicitly changes them.',
    'Do not add markdown fences.',
  ].join('\n');

  const input = {
    prompt_type: promptType,
    field_label: fieldLabel,
    admin_request: request,
    current_value: currentValue,
  };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  if (provider === 'openrouter') {
    const referer = process.env.SITE_URL?.trim() || process.env.VERCEL_URL?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim();
    if (referer) {
      const resolved = referer.startsWith('http') ? referer : `https://${referer}`;
      headers.Referer = resolved;
      headers['HTTP-Referer'] = resolved;
    }
    headers['X-Title'] = 'Steam Zone GHL Prompt Assistant';
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: requestedModel,
        instructions: systemInstructions,
        input: [{ role: 'user', content: JSON.stringify(input) }],
        temperature: 0.2,
        max_output_tokens: 900,
      }),
    });

    const raw = await response.text();
    if (!response.ok) {
      res.status(200).json(fallbackResponse(currentValue, request));
      return;
    }

    let modelText = '';
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (typeof parsed.output_text === 'string') {
        modelText = parsed.output_text.trim();
      }
      if (!modelText && Array.isArray(parsed.output)) {
        for (const outputItem of parsed.output as Array<Record<string, unknown>>) {
          if (String(outputItem.type ?? '') !== 'message') continue;
          const content = Array.isArray(outputItem.content) ? outputItem.content : [];
          for (const chunk of content as Array<Record<string, unknown>>) {
            if (String(chunk.type ?? '') === 'output_text' && typeof chunk.text === 'string') {
              modelText += `${chunk.text}\n`;
            }
          }
        }
      }
      modelText = modelText.trim();
    } catch {
      modelText = '';
    }

    const parsedAssistant = parseAssistantJson(modelText);
    const assistantMessage = String(parsedAssistant?.assistant_message ?? '').trim();
    const draftedValue = String(parsedAssistant?.drafted_value ?? '').trim();
    if (!assistantMessage || !draftedValue) {
      res.status(200).json(fallbackResponse(currentValue, request));
      return;
    }

    res.status(200).json({
      assistant_message: assistantMessage,
      drafted_value: draftedValue,
      model: requestedModel,
      source: 'llm',
    } satisfies PromptAssistantPayload);
  } catch {
    res.status(200).json(fallbackResponse(currentValue, request));
  }
}
