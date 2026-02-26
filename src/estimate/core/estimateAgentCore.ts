import {
  getFieldOptions,
  getRequiredVisibleFieldsInOrder,
  getSchemaField,
  isAnswered,
  type EstimateFormSchema,
  type SchemaField,
  type SchemaOption,
  type ServiceType,
} from '../../quote/schema.js';

import { searchSteamZoneKnowledgeAsync, type KnowledgeMatch } from './steamzoneKnowledge.js';
import * as estimateAgentRuntime from '../../../server/estimateAgentRuntimeEntry.js';
import { finalizeEstimateSession } from '../../../server/estimateFinalize.js';
import {
  AGENT_DEFAULT_MODEL,
  AGENT_DEFAULT_VOICE_MODEL,
  AGENT_MODEL_OPTIONS,
  AGENT_VOICE_MODEL_OPTIONS,
  type AgentModelOption,
} from './agentModelConfig.js';
import { getAgentModelConfig as getStoredAgentModelConfig } from '../../../server/agentModelStore.js';
import { DEFAULT_AGENT_SYSTEM_PROMPT, getAgentSystemPromptConfig } from '../../../server/agentPromptStore.js';

export type PostagentChannel = 'web' | 'voice' | 'sms' | 'test';

export interface PostagentEstimateRequest {
  session_id?: string;
  input_text: string;
  bootstrap?: boolean;
  channel?: PostagentChannel;
  turn_id?: string;
  state_hint?: {
    session_id?: string;
    answers?: Record<string, unknown>;
    asked_keys?: string[];
    last_question_key?: string | null;
    mode?: 'support' | 'estimate' | 'handoff';
  };
  metadata?: Record<string, unknown>;
}

export interface PostagentEstimateResponse {
  session_id: string;
  assistant_message: string;
  assistant_reasoning?: string[];
  state: {
    answers: Record<string, unknown>;
    asked_keys: string[];
    last_question_key: string | null;
    mode: 'support' | 'estimate' | 'handoff';
    done: boolean;
  };
  quote: unknown | null;
  done: boolean;
  finalize?: {
    done: boolean;
    already_finalized: boolean;
    quote_hash: string | null;
    quote_number: string | null;
    record_id: string | null;
    email_message: string | null;
    email_success: boolean | null;
  };
  next_question?: {
    key: string;
    question_text?: string;
    input_ui_hint?: {
      type: string;
      options?: SchemaOption[];
      min?: number;
      max?: number;
      placeholder?: string;
    };
  };
}

interface ApiResponse {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
}

interface ApiRequest {
  method?: string;
  body?: unknown;
}

interface SessionRecord {
  session_id: string;
  answers: Record<string, unknown>;
  asked_keys: string[];
  transcript?: unknown[];
  last_question_key: string | null;
  mode?: 'support' | 'estimate' | 'handoff';
  processed_turn_ids?: string[];
  created_at?: string;
  updated_at?: string;
}

interface NextHint {
  done: boolean;
  next_field_key?: string;
  question_text?: string;
  input_ui_hint?: {
    type: string;
    options?: SchemaOption[];
    min?: number;
    max?: number;
    placeholder?: string;
  };
}

type NormalizeValidateResult = {
  ok: boolean;
  normalized_value: unknown;
  error_message?: string;
  needs_clarification?: boolean;
  clarification_question?: string;
};

type TranscriptRole = 'user' | 'assistant' | 'tool';

type EstimateAgentRuntimeModule = {
  toolGetSchema: () => Promise<EstimateFormSchema>;
  toolGetState: (sessionId: string) => Promise<{
    session_id: string;
    answers: Record<string, unknown>;
    asked_keys: string[];
    transcript?: unknown[];
    last_question_key: string | null;
    mode?: 'support' | 'estimate' | 'handoff';
    processed_turn_ids?: string[];
    created_at?: string;
    updated_at?: string;
  }>;
  toolNormalizeAndValidate: (
    fieldKey: string,
    userText: string,
    answersSoFar: Record<string, unknown>
  ) => Promise<NormalizeValidateResult>;
  toolSetAnswer: (
    sessionId: string,
    fieldKey: string,
    normalizedValue: unknown
  ) => Promise<{
    session_id: string;
    answers: Record<string, unknown>;
    asked_keys: string[];
    last_question_key: string | null;
    created_at?: string;
    updated_at?: string;
  }>;
  toolNextQuestion: (sessionId: string) => Promise<NextHint>;
  toolComputeQuote: (sessionId: string) => Promise<unknown>;
  appendTranscript: (
    sessionId: string,
    entry: {
      role: TranscriptRole;
      content: string;
      at: string;
      channel?: PostagentChannel;
      reasoning?: string;
      meta?: Record<string, unknown>;
    }
  ) => Promise<{
    session_id: string;
    answers: Record<string, unknown>;
    asked_keys: string[];
    last_question_key: string | null;
    mode?: 'support' | 'estimate' | 'handoff';
    processed_turn_ids?: string[];
    finalized_record_id?: string | null;
    finalized_quote_hash?: string | null;
    finalized_at?: string | null;
    created_at?: string;
    updated_at?: string;
  }>;
  saveSession: (session: {
    session_id: string;
    answers: Record<string, unknown>;
    asked_keys: string[];
    transcript?: unknown[];
    last_question_key: string | null;
    mode?: 'support' | 'estimate' | 'handoff';
    processed_turn_ids?: string[];
    finalized_record_id?: string | null;
    finalized_quote_hash?: string | null;
    finalized_at?: string | null;
    created_at?: string;
    updated_at?: string;
  }) => Promise<{
    session_id: string;
    answers: Record<string, unknown>;
    asked_keys: string[];
    transcript?: unknown[];
    last_question_key: string | null;
    mode?: 'support' | 'estimate' | 'handoff';
    processed_turn_ids?: string[];
    finalized_record_id?: string | null;
    finalized_quote_hash?: string | null;
    finalized_at?: string | null;
    created_at?: string;
    updated_at?: string;
  }>;
  getSession: (sessionId: string) => Promise<{
    session_id: string;
    answers: Record<string, unknown>;
    asked_keys: string[];
    last_question_key: string | null;
    transcript?: unknown[];
    mode?: 'support' | 'estimate' | 'handoff';
    processed_turn_ids?: string[];
    finalized_record_id?: string | null;
    finalized_quote_hash?: string | null;
    finalized_at?: string | null;
    created_at?: string;
    updated_at?: string;
  }>;
  validateRequiredAnswers: (answers: Record<string, unknown>) => string[];
  summaryState: (session: {
    answers: Record<string, unknown>;
    asked_keys: string[];
    last_question_key: string | null;
  }) => {
    answers: Record<string, unknown>;
    asked_keys: string[];
    last_question_key: string | null;
    service_type?: string;
  };
  peekNextQuestion: (sessionId: string) => Promise<NextHint>;
};

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

type AgentProviderConfig = {
  model: string;
  responsesUrl: string;
  apiKey: string;
  provider: 'openrouter' | 'openai';
  headers: Record<string, string>;
};

type OpenAIResponse = {
  id: string;
  output?: Array<ResponseFunctionCall | ResponseMessage | { type: string; [k: string]: unknown }>;
  output_text?: string;
};

type ToolExecutionResult =
  | EstimateFormSchema
  | SessionRecord
  | NextHint
  | NormalizeValidateResult
  | { [key: string]: unknown }
  | unknown;

const MAX_TURNS = 5;
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const OPENROUTER_RESPONSES_URL = 'https://openrouter.ai/api/v1/responses';

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
    name: 'search_faq',
    description: 'Search Steam Zone FAQ/training data for relevant answers.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        user_question: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['user_question'],
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

const TOOL_DEFS_INFO_ONLY = [
  {
    type: 'function',
    name: 'search_faq',
    description: 'Search Steam Zone FAQ/training data for relevant answers.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        user_question: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['user_question'],
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
] as const;

const CORE_PROMPT_PREFIX = DEFAULT_AGENT_SYSTEM_PROMPT;

const DEFAULT_USER_START = 'Hi, how are you? What can I help you with today?';
const DEFAULT_ASSISTANT_BOOTSTRAP_OPENER = 'Hi there, thanks for reaching out to Steam Zone. How can I help today?';
const CORRECTION_CUES = /\b(actually|instead|change|replace|correction|corrections|update|correct|correcting)\b/i;
const DIRECT_ESTIMATE_INTENT_CUES =
  /\b(estimate|estimates|quote|quotes|quotation|quotations|pricing|price|cost|costs|how much)\b/i;
const AGGRESSIVE_BUYING_SIGNAL_CUES =
  /\b(book|booking|booked|schedule|scheduled|appointment|appointments|service|services|cleaning|clean)\b/i;
const AFFIRMATIVE_INTENT_CUES =
  /\b(yes|yeah|yep|yup|sure|okay|ok|please do|do it|that is my desire yes|confirm|confirmed|correct)\b/i;
const NEGATIVE_INTENT_CUES = /\b(no|nope|nah|not now|later|never mind|nevermind|cancel|stop)\b/i;
const WANTS_SERVICES_LIST_CUES =
  /\b(what services|which services|services do you offer|what do you offer|what can you clean)\b/i;
const GENERIC_CONVERSATION_PROMPT_CUES =
  /\b(what is happening|what's happening|whats happening|what.?s up|how.?s it going|how is it going|hello|hi there|hey there)\b/i;
const UNSUPPORTED_ESTIMATE_SERVICE_CUES =
  /\b(grout|tile|tiles|upholstery|sofa|couch|mattress|duct|chimney|pressure wash|power wash)\b/i;
const PENDING_ESTIMATE_CONFIRMATION_KEY = '__pending_estimate_confirmation';
const PENDING_ESTIMATE_CONFIRMATION_AT_KEY = '__pending_estimate_confirmation_at';
const PENDING_ESTIMATE_CONFIRMATION_CONTEXT_KEY = '__pending_estimate_context';

function nowIso(): string {
  return new Date().toISOString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
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

function normalizeProviderModelLabel(rawModel: string): string {
  const value = rawModel.trim();
  if (!value) {
    return AGENT_DEFAULT_MODEL;
  }

  if (value.toLowerCase() === 'glm5') {
    return 'z-ai/glm-5';
  }

  return value;
}

function getModelOptionByValue(model: string): AgentModelOption | undefined {
  const normalized = model.toLowerCase();
  const allOptions = [...AGENT_MODEL_OPTIONS, ...AGENT_VOICE_MODEL_OPTIONS];
  return allOptions.find((option) => option.value.toLowerCase() === normalized);
}

function getModelProviderHint(model: string): 'openrouter' | 'openai' {
  const option = getModelOptionByValue(model);
  if (option?.provider === 'openai' || option?.provider === 'openrouter') {
    return option.provider;
  }

  if (model.startsWith('gpt-') || model.toLowerCase().startsWith('openai/')) {
    return 'openai';
  }

  return 'openrouter';
}

function isAllowedModel(model: string, isVoiceChannel: boolean): boolean {
  const normalized = normalizeProviderModelLabel(model);
  const options = isVoiceChannel ? AGENT_VOICE_MODEL_OPTIONS : AGENT_MODEL_OPTIONS;
  return options.some((option) => option.value.toLowerCase() === normalized.toLowerCase());
}

function openAIFallbackModel(model: string): string {
  const fallback = getModelOptionByValue(model)?.value ?? model;
  if (fallback.startsWith('openai/')) {
    const normalized = fallback.replace('openai/', '').trim();
    const lowered = normalized.toLowerCase();
    // Audio/realtime IDs are not valid for Responses API tool-calling fallback.
    if (lowered.includes('audio') || lowered.includes('realtime')) {
      return 'gpt-5.2';
    }
    return normalized;
  }

  if (/^[a-z0-9._-]+$/i.test(fallback) && !fallback.includes('/')) {
    const lowered = fallback.toLowerCase();
    if (lowered.includes('audio') || lowered.includes('realtime')) {
      return 'gpt-5.2';
    }
    return fallback;
  }

  return 'gpt-5.2';
}

function modelSupportsToolUse(model: string): boolean {
  const lowered = model.trim().toLowerCase();
  if (!lowered) return false;
  if (lowered.includes('audio') || lowered.includes('realtime')) {
    return false;
  }
  return true;
}

function createProviderHeaders(apiKey: string, provider: 'openrouter' | 'openai'): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  if (provider === 'openrouter') {
    const referer =
      process.env.SITE_URL?.trim() ||
      process.env.VERCEL_URL?.trim() ||
      process.env.NEXT_PUBLIC_SITE_URL?.trim();

    if (referer) {
      headers.Referer = referer.startsWith('http') ? referer : `https://${referer}`;
      headers['HTTP-Referer'] = headers.Referer;
    }
    headers['X-Title'] = 'Steam Zone Estimate Agent';
  }

  return headers;
}

async function resolveModelProviderConfig(channel?: PostagentChannel): Promise<AgentProviderConfig> {
  const stored = await getStoredAgentModelConfig();
  const isVoiceChannel = channel === 'voice' || channel === 'test';
  const envModel =
    normalizeProviderModelLabel(
      process.env[`AGENT_${isVoiceChannel ? 'VOICE_' : ''}MODEL_OVERRIDE`]?.trim() ||
        process.env[`ESTIMATE_${isVoiceChannel ? 'VOICE_' : ''}MODEL`]?.trim() ||
        (isVoiceChannel ? stored.voiceModel : stored.model).trim()
    ) || (isVoiceChannel ? AGENT_DEFAULT_VOICE_MODEL : AGENT_DEFAULT_MODEL);

  const requestedModel = normalizeProviderModelLabel(envModel);
  const safeModel = isAllowedModel(requestedModel, isVoiceChannel)
    ? requestedModel
    : isVoiceChannel
      ? AGENT_DEFAULT_VOICE_MODEL
      : AGENT_DEFAULT_MODEL;
  const normalizedStoredTextModel = normalizeProviderModelLabel(stored.model);
  const storedTextModel = isAllowedModel(normalizedStoredTextModel, false) ? normalizedStoredTextModel : AGENT_DEFAULT_MODEL;
  // Tool-calling turns must use a tool-capable text model.
  const toolSafeModel = modelSupportsToolUse(safeModel)
    ? safeModel
    : modelSupportsToolUse(storedTextModel)
      ? storedTextModel
      : AGENT_DEFAULT_MODEL;
  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();
  if (openRouterKey) {
    return {
      provider: getModelProviderHint(toolSafeModel),
      model: toolSafeModel,
      apiKey: openRouterKey,
      responsesUrl: OPENROUTER_RESPONSES_URL,
      headers: createProviderHeaders(openRouterKey, 'openrouter'),
    };
  }

  const openAiKey = process.env.OPENAI_API_KEY?.trim();
  if (!openAiKey) {
    throw new Error(
      'No model API key configured. Set OPENROUTER_API_KEY in env (preferred) or OPENAI_API_KEY for fallback before using this endpoint.'
    );
  }

  return {
    provider: 'openai',
    model: openAIFallbackModel(toolSafeModel),
    apiKey: openAiKey,
    responsesUrl: OPENAI_RESPONSES_URL,
    headers: createProviderHeaders(openAiKey, 'openai'),
  };
}

const INFO_QUESTION_CUES = /\?|\b(what|where|who|when|why|how|do|does|can|could|is|are|tell me|i want to know|would you)\b/i;
type SessionMode = 'support' | 'estimate' | 'handoff';
type PendingEstimateContext = 'direct_intent' | 'aggressive_signal' | null;

function stripInternalAnswerKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stripInternalAnswerKeys(entry));
  }

  const record = asRecord(value);
  if (!record) {
    return value;
  }

  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(record)) {
    if (key.startsWith('__')) {
      continue;
    }
    out[key] = stripInternalAnswerKeys(nested);
  }
  return out;
}

function sanitizedAnswersForClient(answers: Record<string, unknown>): Record<string, unknown> {
  return stripInternalAnswerKeys(answers) as Record<string, unknown>;
}

function getSessionMode(state: SessionRecord): SessionMode {
  if (state.mode === 'estimate' || state.mode === 'handoff') {
    return state.mode;
  }

  const mode = String(state.answers['__session_mode'] ?? '').trim().toLowerCase();
  if (mode === 'estimate' || mode === 'handoff') {
    return mode;
  }
  return 'support';
}

function withSessionMode(
  state: SessionRecord,
  mode: SessionMode
): { answers: Record<string, unknown>; mode: SessionMode } {
  return {
    answers: {
      ...state.answers,
      ['__session_mode']: mode,
    },
    mode,
  };
}

function readPendingEstimateContext(state: SessionRecord): PendingEstimateContext {
  const value = String(state.answers[PENDING_ESTIMATE_CONFIRMATION_CONTEXT_KEY] ?? '')
    .trim()
    .toLowerCase();
  if (value === 'direct_intent' || value === 'aggressive_signal') {
    return value;
  }
  return null;
}

function hasPendingEstimateConfirmation(state: SessionRecord): boolean {
  return state.answers[PENDING_ESTIMATE_CONFIRMATION_KEY] === true;
}

function withPendingEstimateConfirmation(
  state: SessionRecord,
  context: Exclude<PendingEstimateContext, null>
): { answers: Record<string, unknown> } {
  return {
    answers: {
      ...state.answers,
      [PENDING_ESTIMATE_CONFIRMATION_KEY]: true,
      [PENDING_ESTIMATE_CONFIRMATION_AT_KEY]: nowIso(),
      [PENDING_ESTIMATE_CONFIRMATION_CONTEXT_KEY]: context,
    },
  };
}

function clearPendingEstimateConfirmation(
  answers: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...answers,
    [PENDING_ESTIMATE_CONFIRMATION_KEY]: false,
    [PENDING_ESTIMATE_CONFIRMATION_AT_KEY]: null,
    [PENDING_ESTIMATE_CONFIRMATION_CONTEXT_KEY]: null,
  };
}

function readProcessedTurnIds(state: SessionRecord): string[] {
  if (state.processed_turn_ids && state.processed_turn_ids.length > 0) {
    return [...state.processed_turn_ids];
  }

  const raw = state.answers['__processed_turn_ids'];
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry) => String(entry ?? '').trim())
    .filter((entry, index, list) => entry.length > 0 && list.indexOf(entry) === index)
    .slice(-50);
}

function withProcessedTurn(
  state: SessionRecord,
  turnId: string
): { answers: Record<string, unknown>; processed_turn_ids: string[] } {
  const normalized = turnId.trim();
  if (!normalized) {
    return {
      answers: state.answers,
      processed_turn_ids: state.processed_turn_ids ?? [],
    };
  }
  const next = [...readProcessedTurnIds(state), normalized];
  return {
    answers: {
      ...state.answers,
      ['__processed_turn_ids']: next.slice(-50),
    },
    processed_turn_ids: next.slice(-50),
  };
}

function readTurnId(request: PostagentEstimateRequest): string {
  const direct = String(request.turn_id ?? '').trim();
  if (direct) {
    return direct;
  }
  const metadata = asRecord(request.metadata) ?? {};
  return String(metadata.turn_id ?? metadata.turnId ?? metadata.message_id ?? metadata.messageId ?? '').trim();
}

function latestAssistantText(transcript: unknown[] | undefined): string {
  if (!transcript || transcript.length === 0) {
    return '';
  }
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const item = asRecord(transcript[index]);
    if (!item) continue;
    if (item.role === 'assistant') {
      return String(item.content ?? '').trim();
    }
  }
  return '';
}

function buildDuplicateTurnMessage(args: {
  mode: SessionMode;
  done: boolean;
  nextHint: NextHint;
  quote: unknown;
  state: SessionRecord;
}): string {
  if (args.mode === 'estimate') {
    if (args.done && args.quote) {
      return 'I already have that information and your estimate is complete.';
    }

    if (!args.nextHint.done && args.nextHint.question_text) {
      return `I already got that. ${args.nextHint.question_text}`;
    }

    return 'I already have that update. Please tell me the next detail when you are ready.';
  }

  const recentAssistant = latestAssistantText(args.state.transcript);
  return recentAssistant || 'That message was already processed. What would you like to do next?';
}

function isEstimateCancellationIntent(inputText: string): boolean {
  return /\b(cancel|stop|never mind|nevermind|not now|exit estimate)\b/i.test(inputText);
}

function isLikelyInfoQuestion(inputText: string): boolean {
  return INFO_QUESTION_CUES.test(inputText);
}

function hasDirectEstimateIntent(inputText: string): boolean {
  return DIRECT_ESTIMATE_INTENT_CUES.test(inputText);
}

function hasAggressiveBuyingSignal(inputText: string): boolean {
  return AGGRESSIVE_BUYING_SIGNAL_CUES.test(inputText);
}

function hasAffirmativeIntent(inputText: string): boolean {
  return AFFIRMATIVE_INTENT_CUES.test(inputText);
}

function hasNegativeIntent(inputText: string): boolean {
  return NEGATIVE_INTENT_CUES.test(inputText);
}

function asksForServiceCatalog(inputText: string): boolean {
  return WANTS_SERVICES_LIST_CUES.test(inputText);
}

function isGenericConversationPrompt(inputText: string): boolean {
  const normalized = inputText.trim().toLowerCase();
  if (!normalized) return false;
  if (GENERIC_CONVERSATION_PROMPT_CUES.test(normalized)) return true;
  if (normalized.length <= 24 && /\b(what|how|hi|hello|hey)\b/.test(normalized)) return true;
  return false;
}

function mentionsUnsupportedEstimateService(inputText: string): boolean {
  return UNSUPPORTED_ESTIMATE_SERVICE_CUES.test(inputText);
}

function findServiceTypeFromInput(inputText: string): ServiceType | null {
  const normalized = inputText.trim().toLowerCase();
  if (!normalized) return null;

  if (/\b(commercial|storefront|office|business)\b/.test(normalized) && /\bwindow/.test(normalized)) {
    return 'commercialWindow';
  }
  if (/\b(residential|home|house)\b/.test(normalized) && /\bwindow/.test(normalized)) {
    return 'window';
  }
  if (/\bwindow|windows\b/.test(normalized)) {
    return 'window';
  }
  if (/\bcarpet|carpets\b/.test(normalized)) {
    return 'carpet';
  }
  if (/\b(post[\s-]*construction|construction cleanup)\b/.test(normalized)) {
    return 'postConstruction';
  }

  return null;
}

function estimateServiceOptionsText(): string {
  const serviceField = getSchemaField('serviceType');
  const options = serviceField ? getFieldOptions(serviceField, undefined) : [];
  if (options.length === 0) {
    return 'Residential Windows, Commercial Windows, Carpet Cleaning, and Post-Construction';
  }
  if (options.length === 1) {
    return options[0].label;
  }
  if (options.length === 2) {
    return `${options[0].label} and ${options[1].label}`;
  }

  const head = options.slice(0, -1).map((option) => option.label).join(', ');
  return `${head}, and ${options[options.length - 1].label}`;
}

function buildServiceCatalogResponse(): string {
  return `We currently provide instant estimates for ${estimateServiceOptionsText()}. Would you like a quote for one of these?`;
}

function buildEstimateConfirmationQuestion(context: Exclude<PendingEstimateContext, null>): string {
  if (context === 'direct_intent') {
    return 'Perfect. Do you want to start your estimate now?';
  }
  return 'I can help with an estimate. Do you want to start one now?';
}

function buildUnsupportedEstimateServiceMessage(): string {
  return `I can only provide instant estimates for ${estimateServiceOptionsText()}. Which one would you like?`;
}

function normalizeAssistantMessage(text: string): string {
  const withoutWelcome = text.replace(/^hi,\s*how are you\?\s*what can i help you with today\?\s*/i, '').trim();
  const base = withoutWelcome
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/(\d+)\s*to\s*(\d+)/gi, '$1 to $2')
    .replace(/(\d+)to(\d+)/g, '$1 to $2')
    .replace(/\bunder(\d{3,5})/gi, 'under $1')
    .replace(/\bover(\d{3,5})/gi, 'over $1')
    .replace(/\*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  if (base) {
    return base;
  }

  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/\bunder(\d{3,5})/gi, 'under $1')
    .replace(/\bover(\d{3,5})/gi, 'over $1')
    .replace(/\*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function enforceSingleQuestion(text: string): string {
  let foundQuestion = false;
  return text.replace(/\?/g, () => {
    if (!foundQuestion) {
      foundQuestion = true;
      return '?';
    }
    return '.';
  });
}

function hasFollowUpOffer(text: string): boolean {
  return /\b(follow up|get back|team member|callback|call you|text you|email you|best number|best email)\b/i.test(text);
}

function isClearlyOffKnowledgeTrack(text: string): boolean {
  return /\b(i don't have reliable public info|state business registry|local filings|about page|(what|which)\s+city\/area are you looking for)\b/i.test(text);
}

function summarizeRecentTranscript(
  transcript: unknown[] | undefined,
  limit = 6
): string {
  if (!transcript || transcript.length === 0) {
    return '- (no prior transcript)';
  }

  const recent = transcript.slice(-limit);
  return recent
    .map((entry) => {
      const rec = asRecord(entry) ?? {};
      const role = String(rec.role ?? 'user');
      const content = String(rec.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
      return `- ${role}: ${content}`;
    })
    .join('\n');
}

function summarizeKnowledge(matches: KnowledgeMatch[]): string {
  if (matches.length === 0) {
    return 'No high-confidence FAQ match for this user message.';
  }

  return matches
    .slice(0, 3)
    .map(
      (entry, index) =>
        `${index + 1}. Q: ${entry.question}\n   A: ${entry.answer}\n   score=${entry.score.toFixed(3)}`
    )
    .join('\n');
}

function buildInstructionContext(
  channel: PostagentChannel | undefined,
  session: SessionRecord,
  inputText: string,
  faqMatches: KnowledgeMatch[],
  systemPrompt: string,
  estimateFlowActive: boolean
): string {
  const channelText = channel ? `Input channel: ${channel}.` : 'Input channel: web.';
  const channelGuidance =
    channel === 'voice' || channel === 'test'
      ? 'Voice behavior: default to English, ask exactly one question at a time, and if processing is slow, first say "One moment while I check that for you."'
      : 'Message behavior: ask exactly one question at a time.';
  const hasPriorAssistantTurn = Boolean(
    session.transcript?.some((entry) => asRecord(entry)?.role === 'assistant')
  );
  const answersJson = JSON.stringify(session.answers ?? {});
  const askedKeys = (session.asked_keys ?? []).join(', ') || '(none)';

  return [
    systemPrompt || CORE_PROMPT_PREFIX,
    `Estimate mode active: ${estimateFlowActive ? 'yes' : 'no'}.`,
    estimateFlowActive
      ? 'Estimate flow is active. Collect only estimate fields from schema and move through form order with one question at a time.'
      : 'Do not collect estimate fields until user explicitly asks for a quote/estimate. Answer business questions from FAQ only first.',
    channelText,
    channelGuidance,
    'Session Context:',
    `- session_id: ${session.session_id}`,
    `- has_prior_assistant_turn: ${hasPriorAssistantTurn}`,
    `- last_question_key: ${session.last_question_key ?? 'none'}`,
    `- asked_keys: ${askedKeys}`,
    `- answers_so_far_json: ${answersJson}`,
    'Recent Transcript:',
    summarizeRecentTranscript(session.transcript),
    'FAQ Matches For Current User Message:',
    summarizeKnowledge(faqMatches),
    `Current user message: ${inputText}`,
  ].join('\n');
}

function applyResponseGuardrails(
  assistantMessage: string,
  inputText: string,
  faqMatches: KnowledgeMatch[],
  hadPriorAssistantTurn: boolean,
  mode: SessionMode,
  estimateContinuationQuestion?: string
): string {
  let next = normalizeAssistantMessage(assistantMessage);
  const greetingPrefix = /^(?:hi|hello|hey|hi there|hello there)[,! ]+/i;

  if (hadPriorAssistantTurn) {
    next = next.replace(greetingPrefix, '').trim();
  }

  if (!next) {
    if (mode === 'estimate') {
      return estimateContinuationQuestion?.trim() || 'Please share the next estimate detail.';
    }
    return 'Got it. What can I help you with?';
  }

  const topMatch = faqMatches[0];
  const likelyInfoQuestion = isLikelyInfoQuestion(inputText);
  const estimateIntent = hasDirectEstimateIntent(inputText);

  if (
    likelyInfoQuestion &&
    !estimateIntent &&
    topMatch &&
    topMatch.score >= 2 &&
    isClearlyOffKnowledgeTrack(next)
  ) {
    next = `${topMatch.answer}\n\nIf you'd like, I can also help with a quick estimate.`;
  }

  if (
    likelyInfoQuestion &&
    !estimateIntent &&
    faqMatches.length === 0 &&
    isGenericConversationPrompt(inputText)
  ) {
    next = "I'm here and ready to help. What can I help you with today?";
  } else if (
    likelyInfoQuestion &&
    !estimateIntent &&
    faqMatches.length === 0 &&
    !hasFollowUpOffer(next)
  ) {
    next =
      "I want to make sure I give you accurate information, and I don't have that confirmed in our Steam Zone QA yet. I can have a team member follow up by call, text, or email. What is the best contact for you?";
  }

  next = enforceSingleQuestion(next);

  const normalized = next.trim();
  if (normalized) {
    return normalized;
  }
  if (mode === 'estimate') {
    return estimateContinuationQuestion?.trim() || 'Please share the next estimate detail.';
  }
  return 'Got it. What can I help you with?';
}

function readAssistantText(response: OpenAIResponse): string {
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const parts: string[] = [];
  for (const item of response.output ?? []) {
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

function newSessionId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
  } catch {
    // Ignore and fall back.
  }

  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeForMatch(value: string): string {
  return value.trim().toLowerCase();
}

function hasNumericValue(raw: string): boolean {
  return /[-+]?[\d]+(?:[.,]\d+)?/.test(raw);
}

function hasBooleanCue(raw: string): boolean {
  return /\b(yes|yep|yeah|sure|no|nope|nah|affirmative|negative|confirm|correct)\b/i.test(raw);
}

function hasAnyWord(raw: string, words: string[]): boolean {
  return words.some((word) => new RegExp(`\\b${word}\\b`, 'i').test(raw));
}

function hasOptionTextMatch(raw: string, options: SchemaOption[]): string | null {
  const text = raw.toLowerCase();
  for (const option of options) {
    const value = option.value.toLowerCase();
    const label = option.label.toLowerCase();
    if (text.includes(value) || text.includes(label)) {
      return option.value;
    }
  }

  return null;
}

const INTEGER_HINTS: Record<string, string[]> = {
  roomCount: ['room', 'rooms', 'bedroom', 'bedrooms', 'bed', 'sleeping'],
  sizeBracket: ['under', 'thousand', 'sqft', 'square', 'foot', 'feet'],
  slidingQuantity: ['sliding', 'sliding window', 'sliding windows'],
  patioQuantity: ['patio', 'patio doors', 'patio door'],
  skylightQuantity: ['skylight', 'skylights'],
  paneCount: ['pane', 'panes', 'pane count'],
  frontageFeet: ['frontage', 'frontage feet', 'feet', 'foot'],
  glassDoors: ['door', 'glass door', 'glass doors'],
  storefront: ['storefront', 'window'],
  rooms: ['room', 'rooms', 'bedroom', 'bedrooms'],
  stairsSteps: ['step', 'steps', 'stair', 'stairs'],
  hallways: ['hallway', 'hallways', 'corridor', 'corridors'],
  floors: ['floor', 'floors', 'level', 'levels', 'storey', 'storeys', 'stories', 'story'],
};

const STRING_HINTS: Record<string, string[]> = {
  'contact.fullName': ['name', 'full name', 'my name', "i'm", 'i am', 'call me'],
  'contact.phone': ['phone', 'call', 'number', 'cell', 'mobile', 'text'],
  'contact.email': ['email', 'mail', '@"', '@'],
  'contact.address': ['address', 'location', 'located', 'at', 'street'],
  estimateMode: ['estimate mode', 'type', 'by rooms', 'by sqft', 'square foot'],
};

const BOOLEAN_HINTS: Record<string, string[]> = {
  hardToReach: ['hard', 'ladder', 'reach'],
  hardWater: ['hard water', 'mineral', 'spot'],
  constructionDebris: ['construction', 'debris'],
  sunroom: ['sunroom'],
  walkout: ['walkout'],
  multiTenantAccess: ['multi tenant', 'tenant', 'occupied'],
  afterHours: ['after hours', 'after-hours', 'evening'],
  elevatorAccess: ['elevator'],
  furnitureMoving: ['furniture', 'move furniture'],
  petTreatment: ['pet', 'urine'],
  stainProtection: ['stain protection', 'protectant'],
  deodorizer: ['deodorizer', 'odor', 'smell'],
  appliances: ['appliances', 'fridge', 'stove'],
  insideCabinets: ['cabinet', 'drawer'],
  specialDetailing: ['special detailing', 'detailing'],
};

function fieldHasExplicitSignal(field: SchemaField, raw: string, state: SessionRecord): boolean {
  const lowered = raw.toLowerCase();

  if (field.type === 'boolean') {
    if (!hasBooleanCue(raw)) return false;
    if (state.last_question_key === field.key) return true;
    const hints = BOOLEAN_HINTS[field.key] ?? [];
    return hints.some((hint) => lowered.includes(hint));
  }

  if (field.type === 'postalCode') {
    return /[A-Za-z]\\d[A-Za-z]\\s?\\d[A-Za-z]\\d/i.test(raw);
  }

  if (field.type === 'email') {
    return lowered.includes('@');
  }

  if (field.type === 'phone') {
    if (!/\d/.test(raw)) return false;
    if (state.last_question_key === field.key) return true;
    return (STRING_HINTS[field.key] ?? []).some((word) => lowered.includes(word));
  }

  if (field.type === 'select') {
    const serviceType = state.answers?.serviceType;
    const options = getFieldOptions(
      field,
      typeof serviceType === 'string' ? (serviceType as ServiceType) : undefined
    );
    if (hasOptionTextMatch(raw, options)) return true;
    return STRING_HINTS[field.key]?.some((w) => lowered.includes(w)) ?? false;
  }

  if (field.type === 'integer') {
    if (!hasNumericValue(raw)) {
      return false;
    }

    if (field.key === 'storey') {
      return false;
    }

    const hints = INTEGER_HINTS[field.key] ?? INTEGER_HINTS[String(field.key).toLowerCase()];
    if (field.key === 'sizeBracket' || field.key === 'sqftBracket') {
      return false;
    }

    return !!hints && hasAnyWord(raw, hints);
  }

  if (field.type === 'string') {
    return (STRING_HINTS[field.key] ?? []).some((word) => lowered.includes(word));
  }

  return false;
}

function collectCandidateFieldKeys(
  state: SessionRecord,
  schema: EstimateFormSchema,
  nextKey: string | undefined,
  rawInput: string
): string[] {
  const normalizedInput = normalizeForMatch(rawInput);
  const required = getRequiredVisibleFieldsInOrder(state.answers);
  const unresolved = required.filter((field) => !isAnswered(field, state.answers));
  const set = new Set<string>();
  const lowerInput = normalizedInput.toLowerCase();
  const hintsForCorrection = CORRECTION_CUES.test(rawInput);

  const last = state.last_question_key;
  if (last && hintsForCorrection) {
    set.add(last);
  }

  if (nextKey) {
    set.add(nextKey);
  }

  for (const field of unresolved) {
    if (set.has(field.key)) continue;
    const keyHasHint = fieldHasExplicitSignal(field, rawInput, state);
    if (keyHasHint) {
      set.add(field.key);
      if (set.size >= 6) break;
    }
  }

  for (const field of schema.fields.filter((field) => !isAnswered(field, state.answers))) {
    if (set.has(field.key)) continue;
    if (set.size >= 6) break;
    if (field.type === 'string' && field.key === 'contact.fullName' && /\\bname\\b/i.test(lowerInput)) {
      set.add(field.key);
      continue;
    }
  }

  if (set.size === 0 && nextKey) {
    set.add(nextKey);
  }

  return Array.from(set);
}

function isSimpleReplyInput(inputText: string): boolean {
  const trimmed = inputText.trim();
  if (!trimmed) return false;
  if (trimmed.length > 28) return false;
  if (/[,:;\n]/.test(trimmed)) return false;
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  return tokens.length <= 2;
}

function isExplicitMultiAnswerInput(inputText: string): boolean {
  const lowered = inputText.toLowerCase();
  if (/[,\n;]/.test(lowered)) return true;
  if (/\b(and|also|plus)\b/.test(lowered) && /\b(postal|zone|email|phone|name|service|scope|screens|tracks)\b/.test(lowered)) {
    return true;
  }
  return false;
}

function summarizeStateForResponse(state: {
  answers: Record<string, unknown>;
  asked_keys: string[];
  last_question_key: string | null;
  mode?: 'support' | 'estimate' | 'handoff';
}, done: boolean): {
  answers: Record<string, unknown>;
  asked_keys: string[];
  last_question_key: string | null;
  mode: 'support' | 'estimate' | 'handoff';
  done: boolean;
} {
  return {
    answers: sanitizedAnswersForClient(state.answers),
    asked_keys: state.asked_keys,
    last_question_key: state.last_question_key,
    mode: state.mode === 'estimate' || state.mode === 'handoff' ? state.mode : 'support',
    done,
  };
}

let runtimeModule: EstimateAgentRuntimeModule | null = null;

async function getRuntime(): Promise<EstimateAgentRuntimeModule> {
  if (!runtimeModule) {
    runtimeModule = estimateAgentRuntime as unknown as EstimateAgentRuntimeModule;
  }

  return runtimeModule;
}

export async function loadSchema(): Promise<EstimateFormSchema> {
  const runtime = await getRuntime();
  return runtime.toolGetSchema();
}

export async function getState(sessionId: string): Promise<{
  answers: Record<string, unknown>;
  asked_keys: string[];
  last_question_key: string | null;
  session_id: string;
}> {
  const runtime = await getRuntime();
  return runtime.getSession(sessionId);
}

export async function appendSessionTranscript(
  sessionId: string,
  role: TranscriptRole,
  content: string,
  at = nowIso(),
  channel?: PostagentChannel,
  reasoning?: string,
  meta?: Record<string, unknown>
): Promise<void> {
  const runtime = await getRuntime();
  await runtime.appendTranscript(sessionId, { role, content, at, channel, reasoning, meta });
}

export async function appendTranscript(
  sessionId: string,
  role: TranscriptRole,
  content: string,
  at = nowIso(),
  channel?: PostagentChannel,
  reasoning?: string,
  meta?: Record<string, unknown>
): Promise<void> {
  return appendSessionTranscript(sessionId, role, content, at, channel, reasoning, meta);
}

async function callOpenAI(
  modelConfig: AgentProviderConfig,
  payload: Record<string, unknown>
): Promise<OpenAIResponse> {
  const response = await fetch(modelConfig.responsesUrl, {
    method: 'POST',
    headers: {
      ...modelConfig.headers,
    },
    body: JSON.stringify(payload),
  });

  const rawBody = await response.text();
  let data: Record<string, unknown> | null = null;
  try {
    if (rawBody) {
      data = JSON.parse(rawBody) as Record<string, unknown>;
    }
  } catch {
    data = null;
  }

  if (!response.ok) {
    const detail =
      data !== null ? JSON.stringify(data) : rawBody ? rawBody.slice(0, 600) : `${response.status} ${response.statusText}`;
    throw new Error(`Estimate agent model request failed: ${detail}`);
  }

  if (!data) {
    throw new Error('Estimate agent model request returned an empty response.');
  }

  return data as unknown as OpenAIResponse;
}

async function callOpenAIWithFallback(
  modelConfig: AgentProviderConfig,
  payload: Record<string, unknown>
): Promise<OpenAIResponse> {
  try {
    return await callOpenAI(modelConfig, payload);
  } catch (error) {
    if (
      modelConfig.provider !== 'openrouter' ||
      !process.env.OPENAI_API_KEY?.trim()
    ) {
      throw error;
    }

    const fallbackConfig: AgentProviderConfig = {
      provider: 'openai',
      model: openAIFallbackModel(modelConfig.model),
      apiKey: process.env.OPENAI_API_KEY.trim(),
      responsesUrl: OPENAI_RESPONSES_URL,
      headers: createProviderHeaders(process.env.OPENAI_API_KEY.trim(), 'openai'),
    };

    try {
      return await callOpenAI(fallbackConfig, payload);
    } catch (fallbackError) {
      const baseMessage = error instanceof Error ? error.message : 'Model API request failed.';
      const fallbackMessage =
        fallbackError instanceof Error ? fallbackError.message : 'Fallback model request failed.';
      throw new Error(`${baseMessage} | fallback to OpenAI failed: ${fallbackMessage}`);
    }
  }
}

function transcriptLine(inputText: string): string {
  return inputText.trim();
}

async function callTool(
  runtime: EstimateAgentRuntimeModule,
  name: string,
  args: Record<string, unknown>,
  sessionId: string
): Promise<ToolExecutionResult> {
  if (name === 'get_schema') {
    return runtime.toolGetSchema();
  }

  if (name === 'get_state') {
    return runtime.toolGetState(String(args.session_id ?? sessionId));
  }

  if (name === 'search_faq') {
    const userQuestion = String(args.user_question ?? '').trim();
    const limitRaw = Number(args.limit ?? 3);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(5, Math.round(limitRaw))) : 3;
    const matches = await searchSteamZoneKnowledgeAsync(userQuestion, limit);
    return {
      query: userQuestion,
      matches,
    };
  }

  if (name === 'normalize_and_validate') {
    return runtime.toolNormalizeAndValidate(String(args.field_key ?? ''), String(args.user_text ?? ''), asRecord(args.answers_so_far) ?? {});
  }

  if (name === 'set_answer') {
    return runtime.toolSetAnswer(String(args.session_id ?? sessionId), String(args.field_key ?? ''), args.normalized_value);
  }

  if (name === 'next_question') {
    return runtime.toolNextQuestion(String(args.session_id ?? sessionId));
  }

  if (name === 'compute_quote') {
    return runtime.toolComputeQuote(String(args.session_id ?? sessionId));
  }

  throw new Error(`Unsupported tool: ${name}`);
}

function formatFieldLabel(fieldKey: string): string {
  const spaced = String(fieldKey)
    .replace(/[._]/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  return spaced.length ? spaced : fieldKey;
}

function safeDisplayValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value ?? '');
}

function asNumericText(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? `${value}` : value.toFixed(2);
  }
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[$,\s]/g, ''));
    if (Number.isFinite(parsed)) {
      return Number.isInteger(parsed) ? `${parsed}` : parsed.toFixed(2);
    }
  }
  return null;
}

function summarizeToolExecution(name: string, args: Record<string, unknown>, result: unknown): string {
  const typedResult = asRecord(result) ?? {};
  const fieldKey = String(args.field_key ?? '').trim();
  const queryText = String(args.user_question ?? args.query ?? '').trim();

  if (name === 'get_schema') {
    return 'I pulled the current estimate form and validation rules.';
  }

  if (name === 'get_state') {
    const answers = asRecord(typedResult.answers);
    const askedKeys = Array.isArray(typedResult.asked_keys) ? typedResult.asked_keys : [];
    const answerCount = answers ? Object.keys(answers).length : 0;
    return `I checked the active chat state: ${answerCount} answer${answerCount === 1 ? '' : 's'} already captured across ${askedKeys.length} question${askedKeys.length === 1 ? '' : 's'}.`;
  }

  if (name === 'search_faq') {
    const matches = Array.isArray(typedResult.matches) ? typedResult.matches : [];
    return queryText
      ? `I searched the FAQ for “${queryText}” and found ${matches.length} relevant result${matches.length === 1 ? '' : 's'}.`
      : 'I looked up help guidance from the FAQ.';
  }

  if (name === 'normalize_and_validate') {
    const isOk = typedResult.ok === true;
    const needsClarification = typedResult.needs_clarification === true;
    const clarification = String(typedResult.clarification_question ?? '').trim();
    const normalizedValue = typedResult.normalized_value;
    if (isOk) {
      return `I interpreted ${formatFieldLabel(fieldKey)} as ${safeDisplayValue(normalizedValue)} and marked it valid.`;
    }
    if (needsClarification && clarification) {
      return `I need a quick clarification for ${formatFieldLabel(fieldKey)}: ${clarification}`;
    }
    return `I reviewed your value for ${formatFieldLabel(fieldKey)} and it needed a cleaner format.`;
  }

  if (name === 'set_answer') {
    const value = typedResult.normalized_value === undefined ? args.normalized_value : typedResult.normalized_value;
    return fieldKey
      ? `I saved ${formatFieldLabel(fieldKey)} as ${safeDisplayValue(value)}.`
      : 'I updated the conversation answers.';
  }

  if (name === 'next_question') {
    const questionText = String(typedResult.question_text ?? '').trim();
    return questionText
      ? `I selected the next step as: “${questionText}”.`
      : 'I selected the next question in the estimate flow.';
  }

  if (name === 'compute_quote') {
    const quoteId = String(typedResult.quote_id ?? '').trim();
    const total = asNumericText(typedResult.total);
    return total
      ? `I calculated the live estimate${quoteId ? ` (reference ${quoteId})` : ''}, totaling ${total}.`
      : 'I calculated the estimate from all available answers.';
  }

  return `I used tool ${name} to move the conversation forward.`;
}

function buildReasoningText(raw: string[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const text = String(entry ?? '').trim();
    if (!text) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    unique.push(text);
  }

  if (unique.length === 0) {
    return ['I checked the context and prepared a direct response.'];
  }

  return unique;
}

export async function normalizeAndSetAnswersFromInput(
  runtime: EstimateAgentRuntimeModule,
  sessionId: string,
  inputText: string,
  schema: EstimateFormSchema,
  state: SessionRecord,
  nextHint?: NextHint
): Promise<{ applied: Array<{ field_key: string; normalized_value: unknown }>; ambiguity: string[] }> {
  const lower = inputText.toLowerCase();
  const initialCandidates = collectCandidateFieldKeys(
    state,
    schema,
    nextHint?.done ? undefined : nextHint?.next_field_key,
    lower
  );
  const simpleReply = isSimpleReplyInput(inputText);
  const explicitMulti = isExplicitMultiAnswerInput(inputText);
  const strictTargets = [state.last_question_key, nextHint?.next_field_key]
    .map((value) => String(value ?? '').trim())
    .filter((value, index, list) => value.length > 0 && list.indexOf(value) === index);

  const candidates =
    simpleReply && !explicitMulti && strictTargets.length > 0
      ? strictTargets
      : initialCandidates;

  const ambiguity: string[] = [];
  const applied: Array<{ field_key: string; normalized_value: unknown }> = [];
  const maxApplies = simpleReply && !explicitMulti ? 1 : 6;

  let currentState = state;
  for (const fieldKey of candidates) {
    if (applied.length >= maxApplies) {
      break;
    }
    if (!schema.fields.some((field) => field.key === fieldKey)) {
      continue;
    }

    const normalizeResult = await runtime.toolNormalizeAndValidate(fieldKey, inputText, currentState.answers);
    if (!normalizeResult.ok) {
      if (normalizeResult.needs_clarification && normalizeResult.clarification_question) {
        ambiguity.push(normalizeResult.clarification_question);
      }
      continue;
    }

    const updated = await runtime.toolSetAnswer(sessionId, fieldKey, normalizeResult.normalized_value);
    currentState = updated;
    applied.push({ field_key: fieldKey, normalized_value: normalizeResult.normalized_value });
  }

  return { applied, ambiguity };
}

async function maybeComputeQuote(
  runtime: EstimateAgentRuntimeModule,
  sessionId: string,
  done: boolean
): Promise<unknown | null> {
  if (!done) {
    return null;
  }

  return runtime.toolComputeQuote(sessionId);
}

function shouldSearchKnowledge(inputText: string): boolean {
  const text = inputText.trim();
  return text.length > 0 && (isLikelyInfoQuestion(text) || hasDirectEstimateIntent(text) || asksForServiceCatalog(text));
}

function buildAgentRequestPayload(
  modelConfig: AgentProviderConfig,
  input: Array<{ role: 'user'; content: string } | { type: 'function_call_output'; call_id: string; output: string }>,
  instructions: string,
  useInfoOnlyTools: boolean,
  previousResponseId?: string
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model: modelConfig.model,
    instructions,
    input,
    tools: useInfoOnlyTools ? TOOL_DEFS_INFO_ONLY : TOOL_DEFS,
    tool_choice: 'auto',
    temperature: 0.2,
    max_output_tokens: 420,
  };

  if (previousResponseId) {
    payload.previous_response_id = previousResponseId;
  }

  return payload;
}

async function instructionsForContext(
  channel: PostagentChannel | undefined,
  session: SessionRecord,
  inputText: string,
  faqMatches: KnowledgeMatch[],
  systemPrompt: string,
  estimateFlowActive: boolean
): Promise<string> {
  return buildInstructionContext(
    channel,
    session,
    inputText,
    faqMatches,
    systemPrompt,
    estimateFlowActive
  );
}

async function runAgentLoop(
  runtime: EstimateAgentRuntimeModule,
  modelConfig: AgentProviderConfig,
  sessionId: string,
  inputText: string,
  channel: PostagentChannel | undefined,
  estimateFlowActive: boolean
): Promise<{ assistant_message: string; assistant_reasoning: string[]; quote: unknown; next_hint: NextHint; done: boolean }> {
  let sessionContext = await runtime.toolGetState(sessionId);
  const promptConfig = await getAgentSystemPromptConfig();
  const systemPrompt = promptConfig.prompt || CORE_PROMPT_PREFIX;
  const faqMatches = shouldSearchKnowledge(inputText)
    ? await searchSteamZoneKnowledgeAsync(inputText, 3)
    : [];
  const hadPriorAssistantTurn = Boolean(
    sessionContext.transcript?.some((entry) => asRecord(entry)?.role === 'assistant')
  );
  const instructions = await instructionsForContext(
    channel,
    sessionContext,
    inputText,
    faqMatches,
    systemPrompt,
    estimateFlowActive
  );
  const useInfoOnlyTools = !estimateFlowActive;

  let response = await callOpenAIWithFallback(
    modelConfig,
    buildAgentRequestPayload(
      modelConfig,
      [
        {
          role: 'user',
          content: inputText,
        },
      ],
      instructions,
      useInfoOnlyTools
    )
  );

  let assistantMessage = readAssistantText(response);
  let quote: unknown = null;
  const reasoningSteps: string[] = [];
  const normalizedInputPreview = (inputText || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  reasoningSteps.push(
    `I reviewed your latest message: “${normalizedInputPreview || 'a follow-up prompt'}”.`
  );
  reasoningSteps.push(
    `Current context: ${Math.max(0, Object.keys(sessionContext.answers ?? {}).length)} answer(s) already captured, ` +
      `${sessionContext.asked_keys.length} question(s) asked, estimate mode ${estimateFlowActive ? 'active' : 'inactive'}.`
  );

  for (let i = 0; i < MAX_TURNS; i += 1) {
    const calls = getFunctionCalls(response);
    if (calls.length === 0) break;

    const outputs: Array<{ type: 'function_call_output'; call_id: string; output: string }> = [];
    for (const call of calls) {
      const args = parseArgs(call.arguments);
      const result = await callTool(runtime, call.name, args, sessionId);
      reasoningSteps.push(summarizeToolExecution(call.name, args, result));
      if (call.name === 'compute_quote') {
        quote = result;
      }
      outputs.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify(result),
      });
    }

    sessionContext = await runtime.toolGetState(sessionId);

    response = await callOpenAIWithFallback(
      modelConfig,
      buildAgentRequestPayload(modelConfig, outputs, instructions, useInfoOnlyTools, response.id)
    );

    const textOut = readAssistantText(response);
    if (textOut) {
      assistantMessage = textOut;
    }
  }

  if (reasoningSteps.length === 2) {
    reasoningSteps.push('I could answer this step from the current context without additional tool calls.');
  }

  const session = await runtime.getSession(sessionId);
  const done =
    estimateFlowActive &&
    runtime.validateRequiredAnswers(sanitizedAnswersForClient(session.answers)).length === 0;
  const nextHint = !estimateFlowActive || done ? { done: true } : await runtime.peekNextQuestion(sessionId);
  const computedQuote = quote === null ? await maybeComputeQuote(runtime, sessionId, done) : quote;

  if (!assistantMessage) {
    if (done && computedQuote) {
      assistantMessage = 'Your estimate is ready. I included the quote below.';
    } else if (estimateFlowActive) {
      const next = await runtime.toolNextQuestion(sessionId);
      const questionText = next.question_text ?? 'Please provide the next detail.';
      if (!hadPriorAssistantTurn) {
        assistantMessage = `${DEFAULT_USER_START} ${questionText}`.trim();
      } else {
        assistantMessage = questionText;
      }
    } else {
      assistantMessage = DEFAULT_USER_START;
    }
  }

  assistantMessage = applyResponseGuardrails(assistantMessage, inputText, faqMatches, hadPriorAssistantTurn, 'support');
  const assistantReasoning = buildReasoningText(reasoningSteps);

  return {
    assistant_message: assistantMessage,
    assistant_reasoning: assistantReasoning,
    quote: computedQuote,
    next_hint: done ? { done: true } : nextHint,
    done,
  };
}

async function tryDeterministicSupportFastPath(
  runtime: EstimateAgentRuntimeModule,
  sessionId: string,
  inputText: string
): Promise<{ assistant_message: string; assistant_reasoning: string[]; quote: null; next_hint: NextHint; done: false } | null> {
  const normalizedInput = inputText.replace(/\s+/g, ' ').trim();
  if (!normalizedInput) {
    return null;
  }

  const likelyInfoQuestion = isLikelyInfoQuestion(normalizedInput);
  const directEstimateIntent = hasDirectEstimateIntent(normalizedInput);
  const faqMatches = shouldSearchKnowledge(normalizedInput)
    ? await searchSteamZoneKnowledgeAsync(normalizedInput, 3)
    : [];
  const topMatch = faqMatches[0];
  const sessionContext = await runtime.toolGetState(sessionId);
  const hadPriorAssistantTurn = Boolean(
    sessionContext.transcript?.some((entry) => asRecord(entry)?.role === 'assistant')
  );

  if (asksForServiceCatalog(normalizedInput)) {
    return {
      assistant_message: applyResponseGuardrails(
        buildServiceCatalogResponse(),
        normalizedInput,
        faqMatches,
        hadPriorAssistantTurn,
        'support'
      ),
      assistant_reasoning: buildReasoningText([
        `I reviewed your latest message: “${normalizedInput.slice(0, 200)}”.`,
        'I returned the deterministic service list directly from schema to avoid unsupported claims.',
      ]),
      quote: null,
      next_hint: { done: true },
      done: false,
    };
  }

  // Conservative threshold to keep direct FAQ answers fast without increasing hallucination risk.
  if (likelyInfoQuestion && !directEstimateIntent && topMatch && topMatch.score >= 3) {
    const message = applyResponseGuardrails(
      `${topMatch.answer}\n\nIf you'd like, I can also help with a quick estimate.`,
      normalizedInput,
      faqMatches,
      hadPriorAssistantTurn,
      'support'
    );

    return {
      assistant_message: message,
      assistant_reasoning: buildReasoningText([
        `I reviewed your latest message: “${normalizedInput.slice(0, 200)}”.`,
        `I found a high-confidence FAQ match (score ${topMatch.score.toFixed(3)}) and answered directly without a model round-trip.`,
      ]),
      quote: null,
      next_hint: { done: true },
      done: false,
    };
  }

  if (likelyInfoQuestion && !directEstimateIntent && faqMatches.length === 0) {
    const deterministicFallback = isGenericConversationPrompt(normalizedInput)
      ? "I'm here and ready to help. What can I help you with today?"
      : "I want to make sure I give you accurate information, and I don't have that confirmed in our Steam Zone QA yet. I can have a team member follow up by call, text, or email. What is the best contact for you?";

    return {
      assistant_message: applyResponseGuardrails(
        deterministicFallback,
        normalizedInput,
        faqMatches,
        hadPriorAssistantTurn,
        'support'
      ),
      assistant_reasoning: buildReasoningText([
        `I reviewed your latest message: “${normalizedInput.slice(0, 200)}”.`,
        'No reliable FAQ match was found, so I used the deterministic support fallback immediately instead of waiting on a model call.',
      ]),
      quote: null,
      next_hint: { done: true },
      done: false,
    };
  }

  return null;
}

export async function decideNextAssistantTurn(
  request: { session_id: string; input_text: string; channel?: PostagentChannel; turn_id?: string }
): Promise<PostagentEstimateResponse> {
  return runEstimateAgentCore({
    session_id: request.session_id,
    input_text: request.input_text,
    channel: request.channel,
    turn_id: request.turn_id,
  });
}

export async function runEstimateAgentCore(
  request: PostagentEstimateRequest
): Promise<PostagentEstimateResponse> {
  const runtime = await getRuntime();
  const sessionId = request.session_id?.trim() || newSessionId();
  const inputText = String(request.input_text || '').trim();
  const isBootstrap = request.bootstrap === true;
  const channel = request.channel;
  const turnId = readTurnId(request);
  let initialSession = await runtime.getSession(sessionId);
  const stateHint = request.state_hint;
  const hintedSessionId =
    typeof stateHint?.session_id === 'string' && stateHint.session_id.trim().length > 0
      ? stateHint.session_id.trim()
      : '';
  const allowStateHintHydration = !isBootstrap && hintedSessionId.length > 0 && hintedSessionId === sessionId;
  const hintedAnswers = allowStateHintHydration ? asRecord(stateHint?.answers) : null;
  const hintedAskedKeys =
    allowStateHintHydration && Array.isArray(stateHint?.asked_keys)
      ? stateHint.asked_keys
          .map((entry) => String(entry ?? '').trim())
          .filter((entry, index, list) => entry.length > 0 && list.indexOf(entry) === index)
      : [];
  const hintedLastQuestion =
    allowStateHintHydration &&
    typeof stateHint?.last_question_key === 'string' &&
    stateHint.last_question_key.trim().length > 0
      ? stateHint.last_question_key.trim()
      : null;
  const hintedMode =
    allowStateHintHydration &&
    (stateHint?.mode === 'estimate' || stateHint?.mode === 'handoff' || stateHint?.mode === 'support')
      ? stateHint.mode
      : undefined;
  const serverSessionIsEmpty =
    Object.keys(initialSession.answers ?? {}).length === 0 &&
    (initialSession.asked_keys?.length ?? 0) === 0 &&
    (initialSession.transcript?.length ?? 0) === 0;

  if (serverSessionIsEmpty && (hintedAnswers || hintedAskedKeys.length > 0 || hintedLastQuestion || hintedMode)) {
    const hydratedAnswers = {
      ...initialSession.answers,
      ...(hintedAnswers ?? {}),
    };
    if (hintedMode === 'estimate' || hintedMode === 'handoff' || hintedMode === 'support') {
      hydratedAnswers['__session_mode'] = hintedMode;
    }
    initialSession = await runtime.saveSession({
      ...initialSession,
      answers: hydratedAnswers,
      asked_keys: hintedAskedKeys.length > 0 ? hintedAskedKeys : initialSession.asked_keys,
      last_question_key: hintedLastQuestion ?? initialSession.last_question_key,
      mode: hintedMode ?? initialSession.mode,
    });
  }

  if (isBootstrap && !inputText) {
    const priorAssistant = latestAssistantText(initialSession.transcript);
    const openerText = priorAssistant || DEFAULT_ASSISTANT_BOOTSTRAP_OPENER;
    if (!priorAssistant) {
      await runtime.appendTranscript(sessionId, {
        role: 'assistant',
        content: openerText,
        at: nowIso(),
        channel: channel ?? 'web',
        reasoning: 'Bootstrap opener for new session.',
      });
      initialSession = await runtime.getSession(sessionId);
    }

    return {
      session_id: sessionId,
      assistant_message: openerText,
      assistant_reasoning: ['Bootstrap opener emitted as assistant turn.'],
      state: summarizeStateForResponse(
        {
          answers: initialSession.answers,
          asked_keys: initialSession.asked_keys,
          last_question_key: initialSession.last_question_key,
          mode: getSessionMode(initialSession),
        },
        false
      ),
      quote: null,
      done: false,
    };
  }

  let mode = getSessionMode(initialSession);
  const alreadyProcessed = turnId ? readProcessedTurnIds(initialSession).includes(turnId) : false;

  if (alreadyProcessed) {
    const cleanedAnswers = sanitizedAnswersForClient(initialSession.answers);
    const done = mode === 'estimate' && runtime.validateRequiredAnswers(cleanedAnswers).length === 0;
    const nextHint = done ? { done: true } : await runtime.peekNextQuestion(sessionId);
    const quote = done ? await maybeComputeQuote(runtime, sessionId, true) : null;
    const dedupedResponse: PostagentEstimateResponse = {
      session_id: sessionId,
      assistant_message: buildDuplicateTurnMessage({
        mode,
        done,
        nextHint,
        quote,
        state: initialSession,
      }),
      assistant_reasoning: ['Duplicate turn ignored by turn_id idempotency.'],
      state: summarizeStateForResponse(
        {
          answers: initialSession.answers,
          asked_keys: initialSession.asked_keys,
          last_question_key: initialSession.last_question_key,
          mode,
        },
        done
      ),
      quote,
      done,
    };
    if (!nextHint.done && nextHint.next_field_key) {
      dedupedResponse.next_question = {
        key: nextHint.next_field_key,
        question_text: nextHint.question_text,
        input_ui_hint: nextHint.input_ui_hint,
      };
    }
    return dedupedResponse;
  }

  let stagedAnswers = { ...initialSession.answers };
  let modeDecisionChanged = false;
  let forcedSupportMessage: string | null = null;
  const pendingEstimateContext = readPendingEstimateContext(initialSession);
  const pendingEstimateConfirmation = hasPendingEstimateConfirmation(initialSession);
  const directEstimateIntent = hasDirectEstimateIntent(inputText);
  const aggressiveBuyingSignal = hasAggressiveBuyingSignal(inputText);
  const affirmativeIntent = hasAffirmativeIntent(inputText);
  const negativeIntent = hasNegativeIntent(inputText);
  const likelyInfoQuestion = isLikelyInfoQuestion(inputText);
  const serviceMention = findServiceTypeFromInput(inputText);

  if (mode === 'estimate' && isEstimateCancellationIntent(inputText)) {
    mode = 'support';
    stagedAnswers = clearPendingEstimateConfirmation(stagedAnswers);
    modeDecisionChanged = true;
  } else if (mode === 'support') {
    if (pendingEstimateConfirmation) {
      if (negativeIntent) {
        stagedAnswers = clearPendingEstimateConfirmation(stagedAnswers);
        modeDecisionChanged = true;
        forcedSupportMessage = 'No problem. What would you like help with today?';
      } else if (affirmativeIntent || directEstimateIntent || serviceMention) {
        mode = 'estimate';
        stagedAnswers = clearPendingEstimateConfirmation(stagedAnswers);
        modeDecisionChanged = true;
      } else {
        forcedSupportMessage = buildEstimateConfirmationQuestion(pendingEstimateContext ?? 'direct_intent');
      }
    } else if (directEstimateIntent) {
      if (serviceMention) {
        mode = 'estimate';
        stagedAnswers = clearPendingEstimateConfirmation(stagedAnswers);
        modeDecisionChanged = true;
      } else {
        stagedAnswers = {
          ...stagedAnswers,
          ...withPendingEstimateConfirmation(initialSession, 'direct_intent').answers,
        };
        modeDecisionChanged = true;
        forcedSupportMessage = buildEstimateConfirmationQuestion('direct_intent');
      }
    } else if (aggressiveBuyingSignal && !likelyInfoQuestion) {
      stagedAnswers = {
        ...stagedAnswers,
        ...withPendingEstimateConfirmation(initialSession, 'aggressive_signal').answers,
      };
      modeDecisionChanged = true;
      forcedSupportMessage = buildEstimateConfirmationQuestion('aggressive_signal');
    }
  }

  if (modeDecisionChanged) {
    initialSession = await runtime.saveSession({
      ...initialSession,
      answers: stagedAnswers,
      mode,
    });
  }

  const userTranscriptAt = nowIso();
  const userTranscript = transcriptLine(inputText);
  await runtime.appendTranscript(sessionId, {
    role: 'user',
    content: userTranscript,
    at: userTranscriptAt,
    channel,
  });

  let loopResult: {
    assistant_message: string;
    assistant_reasoning: string[];
    quote: unknown | null;
    next_hint: NextHint;
    done: boolean;
  };

  if (mode === 'estimate') {
    const schema = await runtime.toolGetSchema();
    let state = await runtime.toolGetState(sessionId);
    let nextHint = await runtime.peekNextQuestion(sessionId);
    const unresolvedServiceType = nextHint.next_field_key === 'serviceType' && !state.answers.serviceType;
    const detectedServiceType = findServiceTypeFromInput(inputText);

    if (unresolvedServiceType && detectedServiceType) {
      await runtime.toolSetAnswer(sessionId, 'serviceType', detectedServiceType);
      state = await runtime.toolGetState(sessionId);
      nextHint = await runtime.peekNextQuestion(sessionId);
    }

    if (unresolvedServiceType && !detectedServiceType && mentionsUnsupportedEstimateService(inputText)) {
      const deterministicNextHint = await runtime.peekNextQuestion(sessionId);
      loopResult = {
        assistant_message: buildUnsupportedEstimateServiceMessage(),
        assistant_reasoning: buildReasoningText([
          `Estimate mode is active for session ${sessionId}.`,
          'User requested an unsupported estimate service while service type is unresolved.',
          'Kept flow on serviceType and returned deterministic allowed options.',
        ]),
        quote: null,
        next_hint: deterministicNextHint,
        done: false,
      };
    } else {
      const parseResult = await normalizeAndSetAnswersFromInput(runtime, sessionId, inputText, schema, state, nextHint);

      const afterParse = await runtime.getSession(sessionId);
      const missingRequired = runtime.validateRequiredAnswers(sanitizedAnswersForClient(afterParse.answers));
      const done = missingRequired.length === 0;
      const quote = done ? await runtime.toolComputeQuote(sessionId) : null;

      let deterministicMessage = '';
      let deterministicNextHint: NextHint = { done: true };
      if (done && quote) {
        const quoteRecord = asRecord(quote) ?? {};
        const totalText = asNumericText(quoteRecord.total);
        const contact = asRecord(afterParse.answers.contact) ?? {};
        const email = String(contact.email ?? '').trim();
        deterministicMessage = totalText
          ? `Thanks, I have everything for your estimate. The subtotal is ${totalText}.${
              email ? ` I can email the quote to ${email}.` : ''
            }`
          : 'Thanks, I have everything for your estimate. Your quote is ready.';
        deterministicNextHint = { done: true };
      } else if (parseResult.ambiguity.length > 0 && parseResult.applied.length === 0) {
        deterministicMessage = parseResult.ambiguity[0];
        deterministicNextHint = await runtime.peekNextQuestion(sessionId);
      } else {
        deterministicNextHint = await runtime.toolNextQuestion(sessionId);
        deterministicMessage = deterministicNextHint.question_text ?? 'Please share the next estimate detail.';
      }

      loopResult = {
        assistant_message: normalizeAssistantMessage(deterministicMessage),
        assistant_reasoning: buildReasoningText([
          `Estimate mode is active for session ${sessionId}.`,
          `Parsed ${parseResult.applied.length} field update(s) from this turn.`,
          done
            ? 'All required estimate fields are complete; quote computed deterministically.'
            : `Missing required fields remain; next question key is ${deterministicNextHint.next_field_key ?? 'unknown'}.`,
        ]),
        quote,
        next_hint: deterministicNextHint,
        done,
      };
    }
  } else if (forcedSupportMessage) {
    loopResult = {
      assistant_message: forcedSupportMessage,
      assistant_reasoning: buildReasoningText([
        `Support mode active for session ${sessionId}.`,
        pendingEstimateConfirmation
          ? 'Awaiting estimate-confirmation response; used deterministic confirmation handling.'
          : 'Detected buying signal and requested explicit estimate confirmation.',
      ]),
      quote: null,
      next_hint: { done: true },
      done: false,
    };
  } else {
    const deterministicSupportResult = await tryDeterministicSupportFastPath(runtime, sessionId, inputText);
    if (deterministicSupportResult) {
      loopResult = deterministicSupportResult;
    } else {
      const modelConfig = await resolveModelProviderConfig(channel);
      loopResult = await runAgentLoop(runtime, modelConfig, sessionId, inputText, channel, false);
      loopResult.done = false;
      loopResult.quote = null;
      loopResult.next_hint = { done: true };
    }
  }

  const finalStateBeforeMeta = await runtime.getSession(sessionId);
  const meta = withSessionMode(finalStateBeforeMeta, mode);
  let patchedAnswers = loopResult.done && mode === 'estimate'
    ? clearPendingEstimateConfirmation(meta.answers)
    : meta.answers;
  let patchedProcessedIds = finalStateBeforeMeta.processed_turn_ids ?? [];
  if (turnId) {
    const withTurn = withProcessedTurn(finalStateBeforeMeta, turnId);
    patchedAnswers = withTurn.answers;
    patchedProcessedIds = withTurn.processed_turn_ids;
  }

  const finalState =
    JSON.stringify(patchedAnswers) === JSON.stringify(finalStateBeforeMeta.answers) &&
    JSON.stringify(patchedProcessedIds) === JSON.stringify(finalStateBeforeMeta.processed_turn_ids ?? [])
      ? finalStateBeforeMeta
      : await runtime.saveSession({
          ...finalStateBeforeMeta,
          answers: patchedAnswers,
          mode: meta.mode,
          processed_turn_ids: patchedProcessedIds,
        });

  const done = loopResult.done;

  let finalizedAt = false;
  let finalizeError: string | null = null;
  let finalizeData: {
    quote_hash: string;
    quote: unknown;
    record_id: string | null;
    quote_number: string | null;
    email: { message: string; success: boolean; deliveryMode?: 'customer' | 'internal' } | null;
    already_finalized: boolean;
  } | null = null;

  if (mode === 'estimate' && done && process.env.NODE_ENV !== 'test') {
    try {
      const result = await finalizeEstimateSession(sessionId, { sendEmail: true });
      if (result.ok) {
        finalizeData = {
          quote_hash: result.quote_hash,
          quote: result.quote,
          record_id: result.record_id,
          quote_number: result.quote_number,
          email: result.email,
          already_finalized: result.already_finalized,
        };
        finalizedAt = true;
      } else {
        finalizeError = result.message ?? 'Unable to finalize estimate.';
      }
    } catch (error) {
      finalizeError = error instanceof Error ? error.message : 'Unable to finalize estimate.';
    }
  }

  if (done && finalizeData?.quote) {
    loopResult.quote = finalizeData.quote;
  }

  const finalStateSummary = {
    ...summarizeStateForResponse(
      {
        answers: finalState.answers,
        asked_keys: finalState.asked_keys,
        last_question_key: finalState.last_question_key,
        mode: finalState.mode,
      },
      done
    ),
    done,
  };

  const assistantTranscriptAt = nowIso();
  const assistantTranscript = transcriptLine(loopResult.assistant_message);
  await runtime.appendTranscript(sessionId, {
    role: 'assistant',
    content: assistantTranscript,
    at: assistantTranscriptAt,
    channel,
    reasoning: loopResult.assistant_reasoning.join('\n'),
  });

  const response: PostagentEstimateResponse = {
    session_id: sessionId,
    assistant_message: loopResult.assistant_message,
    assistant_reasoning: loopResult.assistant_reasoning,
    state: finalStateSummary,
    quote: loopResult.quote,
    // Legacy support for UI consumers that inspect finalize status separately.
    finalize: finalizedAt
      ? {
          done: true,
          already_finalized: finalizeData?.already_finalized ?? false,
          quote_hash: finalizeData?.quote_hash ?? null,
          quote_number: finalizeData?.quote_number ?? null,
          record_id: finalizeData?.record_id ?? null,
          email_message: finalizeData?.email?.message ?? null,
          email_success: finalizeData?.email?.success ?? null,
        }
      : finalizeError
        ? { done: false, already_finalized: false, quote_hash: null, quote_number: null, record_id: null, email_message: finalizeError, email_success: false }
        : undefined,
    done,
  };

  if (!loopResult.next_hint.done && loopResult.next_hint.next_field_key) {
    response.next_question = {
      key: loopResult.next_hint.next_field_key,
      question_text: loopResult.next_hint.question_text,
      input_ui_hint: loopResult.next_hint.input_ui_hint,
    };
  }

  return response;
}

export async function handlerForEstimateAgentPost(
  req: ApiRequest,
  res: ApiResponse,
  createSessionWhenMissing = false
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  let payload: Record<string, unknown> | null = null;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    payload = asRecord(body);
  } catch {
    res.status(400).json({ message: 'Invalid JSON body.' });
    return;
  }

  if (!payload) {
    res.status(400).json({ message: 'Invalid request body.' });
    return;
  }

  const rawSessionId = String(payload.session_id ?? '').trim();
  const inputText = String(payload.input_text ?? payload.user_message ?? '').trim();
  const rawTurnId = String(payload.turn_id ?? '').trim();
  const bootstrap = payload.bootstrap === true;
  const hasSession = rawSessionId.length > 0;

  if (!createSessionWhenMissing && !hasSession) {
    res.status(400).json({ message: 'session_id is required.' });
    return;
  }

  if (!bootstrap && !inputText) {
    res.status(400).json({ message: 'input_text is required.' });
    return;
  }

  try {
    const response = await runEstimateAgentCore({
      session_id: hasSession ? rawSessionId : undefined,
      input_text: inputText,
      bootstrap,
      channel: (payload?.channel as PostagentChannel | undefined) ?? 'web',
      turn_id: rawTurnId || undefined,
      state_hint: asRecord(payload?.state_hint) as PostagentEstimateRequest['state_hint'],
      metadata: asRecord(payload?.metadata) ?? {},
    });

    res.status(200).json(response);
  } catch (error) {
    res.status(500).json({
      message: error instanceof Error ? error.message : 'Unknown estimate-agent error.',
    });
  }
}
