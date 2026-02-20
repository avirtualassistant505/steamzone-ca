import {
  peekNextQuestion,
  summaryState,
  toolComputeQuote,
  toolGetSchema,
  toolGetState,
  toolNextQuestion,
  toolNormalizeAndValidate,
  toolSetAnswer,
} from '../../server/estimateAgentTools';
import { appendTranscript, getSession } from '../../server/estimateAgentSessionStore';
import { validateRequiredAnswers } from '../../src/quote/normalization';

type ApiRequest = { method?: string; body?: unknown };
type ApiResponse = { status: (code: number) => ApiResponse; json: (body: unknown) => void };

type ResponseFunctionCall = {
  type: 'function_call';
  name: string;
  arguments?: string;
  call_id: string;
};

type ResponseMessage = {
  type: 'message';
  content?: Array<{ type: string; text?: string }>;
};

type OpenAIResponse = {
  id: string;
  output?: Array<ResponseFunctionCall | ResponseMessage | { type: string; [k: string]: unknown }>;
  output_text?: string;
};

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const MODEL = 'gpt-5.2';

const AGENT_INSTRUCTIONS = [
  'You are Steam Zone\'s estimate intake assistant for a sandbox route called /estimate-bot-lab.',
  'Goal: collect answers for the estimate schema accurately, one question at a time, then compute quote via tool.',
  'Rules:',
  '- You MUST use tool calling for state, validation, schema, next question, and quote.',
  '- Never hallucinate pricing. Use compute_quote tool only when enough required answers exist.',
  '- Be concise and friendly. Ask one question per message.',
  '- Handle corrections naturally: if user updates prior answer, use set_answer and continue.',
  '- If input is ambiguous or invalid, call normalize_and_validate and ask the clarification question it returns.',
  '- If user asks for "same as last time", ask for explicit value (no prior-history assumptions).',
  '- After each accepted answer, call next_question. If done, call compute_quote and present the result.',
  '- Do not output raw JSON tool calls in plain text.',
].join('\n');

const TOOL_DEFS = [
  {
    type: 'function',
    name: 'get_schema',
    description: 'Return the estimate form schema.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
  {
    type: 'function',
    name: 'get_state',
    description: 'Return current session state.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        session_id: { type: 'string' },
      },
      required: ['session_id'],
    },
  },
  {
    type: 'function',
    name: 'normalize_and_validate',
    description: 'Normalize and validate a user answer for a specific field.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        field_key: { type: 'string' },
        user_text: { type: 'string' },
        answers_so_far: { type: 'object' },
      },
      required: ['field_key', 'user_text', 'answers_so_far'],
    },
  },
  {
    type: 'function',
    name: 'set_answer',
    description: 'Persist a normalized answer in session state.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        session_id: { type: 'string' },
        field_key: { type: 'string' },
        normalized_value: {},
      },
      required: ['session_id', 'field_key', 'normalized_value'],
    },
  },
  {
    type: 'function',
    name: 'next_question',
    description: 'Get the next required question based on schema + current state.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        session_id: { type: 'string' },
      },
      required: ['session_id'],
    },
  },
  {
    type: 'function',
    name: 'compute_quote',
    description: 'Compute deterministic quote from completed session answers.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        session_id: { type: 'string' },
      },
      required: ['session_id'],
    },
  },
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return asRecord(parsed) ?? {};
  } catch {
    return {};
  }
}

function readAssistantText(response: OpenAIResponse): string {
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const output = response.output ?? [];
  const parts: string[] = [];
  for (const item of output) {
    if (item.type !== 'message') continue;
    const message = item as ResponseMessage;
    for (const chunk of message.content ?? []) {
      if (chunk.type === 'output_text' && chunk.text) {
        parts.push(chunk.text);
      }
    }
  }

  return parts.join('\n').trim();
}

function getFunctionCalls(response: OpenAIResponse): ResponseFunctionCall[] {
  return (response.output ?? []).filter((item) => item.type === 'function_call') as ResponseFunctionCall[];
}

async function callOpenAI(apiKey: string, payload: Record<string, unknown>): Promise<OpenAIResponse> {
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const detail = data ? JSON.stringify(data) : `${response.status} ${response.statusText}`;
    throw new Error(`OpenAI Responses API request failed: ${detail}`);
  }

  return data as unknown as OpenAIResponse;
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  sessionId: string
): Promise<unknown> {
  if (name === 'get_schema') {
    return toolGetSchema();
  }

  if (name === 'get_state') {
    return toolGetState(String(args.session_id ?? sessionId));
  }

  if (name === 'normalize_and_validate') {
    return toolNormalizeAndValidate(
      String(args.field_key ?? ''),
      String(args.user_text ?? ''),
      (asRecord(args.answers_so_far) ?? {})
    );
  }

  if (name === 'set_answer') {
    return toolSetAnswer(
      String(args.session_id ?? sessionId),
      String(args.field_key ?? ''),
      args.normalized_value
    );
  }

  if (name === 'next_question') {
    return toolNextQuestion(String(args.session_id ?? sessionId));
  }

  if (name === 'compute_quote') {
    return toolComputeQuote(String(args.session_id ?? sessionId));
  }

  throw new Error(`Unsupported tool: ${name}`);
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    res.status(500).json({
      message: 'OPENAI_API_KEY is missing on the server. Set process.env.OPENAI_API_KEY before using /api/estimate-agent/chat.',
    });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const payload = asRecord(body);
    const sessionId = String(payload?.session_id ?? '').trim();
    const userMessageRaw = String(payload?.user_message ?? '').trim();

    if (!sessionId) {
      res.status(400).json({ message: 'session_id is required.' });
      return;
    }

    const userMessage = userMessageRaw || 'Start the estimate intake flow.';
    await appendTranscript(sessionId, { role: 'user', content: userMessage, at: new Date().toISOString() });

    let response = await callOpenAI(apiKey, {
      model: MODEL,
      instructions: AGENT_INSTRUCTIONS,
      input: [
        {
          role: 'user',
          content: userMessage,
        },
      ],
      tools: TOOL_DEFS,
      tool_choice: 'auto',
    });

    let assistantMessage = readAssistantText(response);
    let quote: unknown;

    for (let i = 0; i < 8; i += 1) {
      const calls = getFunctionCalls(response);
      if (calls.length === 0) {
        break;
      }

      const outputs: Array<{ type: 'function_call_output'; call_id: string; output: string }> = [];

      for (const call of calls) {
        const args = parseArgs(call.arguments);
        const result = await executeTool(call.name, args, sessionId);

        if (call.name === 'compute_quote') {
          quote = result;
        }

        outputs.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: JSON.stringify(result),
        });
      }

      response = await callOpenAI(apiKey, {
        model: MODEL,
        instructions: AGENT_INSTRUCTIONS,
        previous_response_id: response.id,
        input: outputs,
        tools: TOOL_DEFS,
        tool_choice: 'auto',
      });

      const textOut = readAssistantText(response);
      if (textOut) {
        assistantMessage = textOut;
      }
    }

    const session = await getSession(sessionId);
    const done = validateRequiredAnswers(session.answers).length === 0;
    const nextHint = done ? { done: true } : await peekNextQuestion(sessionId);

    if (!assistantMessage) {
      if (quote && done) {
        assistantMessage = 'Your estimate is ready. I included the full quote details below.';
      } else {
        const next = await toolNextQuestion(sessionId);
        assistantMessage = next.question_text ?? 'Please provide the next estimate detail.';
      }
    }

    await appendTranscript(sessionId, { role: 'assistant', content: assistantMessage, at: new Date().toISOString() });

    res.status(200).json({
      assistant_message: assistantMessage,
      state: summaryState(await getSession(sessionId)),
      quote,
      done,
      next_question: nextHint.done
        ? undefined
        : {
            key: nextHint.next_field_key,
            question_text: nextHint.question_text,
            input_ui_hint: nextHint.input_ui_hint,
          },
    });
  } catch (error) {
    res.status(500).json({
      message: error instanceof Error ? error.message : 'Unknown estimate-agent error.',
    });
  }
}
