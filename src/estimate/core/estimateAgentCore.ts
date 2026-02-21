import {
  getFieldOptions,
  getRequiredVisibleFieldsInOrder,
  isAnswered,
  type EstimateFormSchema,
  type SchemaField,
  type SchemaOption,
  type ServiceType,
} from '../../quote/schema.js';

import { searchSteamZoneKnowledgeAsync, type KnowledgeMatch } from './steamzoneKnowledge.js';
import * as estimateAgentRuntime from '../../../server/estimateAgentRuntimeEntry.js';
import {
  AGENT_DEFAULT_MODEL,
  AGENT_DEFAULT_VOICE_MODEL,
  AGENT_MODEL_OPTIONS,
  AGENT_VOICE_MODEL_OPTIONS,
  type AgentModelOption,
} from './agentModelConfig.js';
import { getAgentModelConfig as getStoredAgentModelConfig } from '../../../server/agentModelStore.js';

export type PostagentChannel = 'web' | 'voice' | 'sms' | 'test';

export interface PostagentEstimateRequest {
  session_id?: string;
  input_text: string;
  channel?: PostagentChannel;
  metadata?: Record<string, unknown>;
}

export interface PostagentEstimateResponse {
  session_id: string;
  assistant_message: string;
  state: {
    answers: Record<string, unknown>;
    asked_keys: string[];
    last_question_key: string | null;
    done: boolean;
  };
  quote: unknown | null;
  done: boolean;
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
    entry: { role: TranscriptRole; content: string; at: string }
  ) => Promise<{
    session_id: string;
    answers: Record<string, unknown>;
    asked_keys: string[];
    last_question_key: string | null;
    created_at?: string;
    updated_at?: string;
  }>;
  getSession: (sessionId: string) => Promise<{
    session_id: string;
    answers: Record<string, unknown>;
    asked_keys: string[];
    last_question_key: string | null;
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

const MAX_TURNS = 8;
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

const CORE_PROMPT_PREFIX = [
  'You are a human-like Steam Zone customer service representative handling chat/voice/sms conversations.',
  'Your first job is to help with customer questions naturally. Estimate collection is secondary unless the customer asks for a quote.',
  'Collect estimate answers to match the schema and compute quotes deterministically only with tools.',
  'Only start with a warm opener on a brand-new conversation. Do not repeat greetings after the first assistant turn.',
  'When users ask service/business questions, use FAQ/training data first before answering.',
  'If the answer is not clearly available in FAQ/training data, do not guess. Offer a team follow-up by call/text/email.',
  'Rules:',
  '- Use tool calling for state, FAQ search, normalization, validation, next question, and quote.',
  '- Sound like a real Steam Zone rep: concise, friendly, direct.',
  '- Default to English unless the customer explicitly asks for another language.',
  '- Never invent quote values or pricing. Only use compute_quote output.',
  '- Never invent business facts that are not in FAQ/training data.',
  '- Ask exactly one question per message. Never ask two questions in the same turn.',
  '- If a response will take a few seconds, first send a short hold line like "One moment while I check that for you."',
  '- Respect user intent: answer their question first, then offer estimate help if relevant.',
  '- If input contains multiple independent answers, call normalize_and_validate for each one.',
  '- If a user correction is made (e.g., "actually 12"), update the previously answered field.',
  '- If input is ambiguous or invalid, call normalize_and_validate and follow the clarification question.',
  '- If enough required data exists, call compute_quote and present the returned number.',
  '- Do not output raw JSON tool calls in plain text.',
].join('\n');

const DEFAULT_USER_START = 'Hi, how are you? What can I help you with today?';

const CORRECTION_CUES = /\b(actually|instead|change|replace|correction|corrections|update|correct|correcting)\b/i;

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
    return fallback.replace('openai/', '');
  }

  if (/^[a-z0-9._-]+$/i.test(fallback) && !fallback.includes('/')) {
    return fallback;
  }

  return 'gpt-5.2';
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
  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();
  if (openRouterKey) {
    return {
      provider: getModelProviderHint(safeModel),
      model: safeModel,
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
    model: openAIFallbackModel(safeModel),
    apiKey: openAiKey,
    responsesUrl: OPENAI_RESPONSES_URL,
    headers: createProviderHeaders(openAiKey, 'openai'),
  };
}

const ESTIMATE_INTENT_CUES = /\b(estimate|quote|pricing|price|cost|book|booking|schedule|appointment)\b/i;
const INFO_QUESTION_CUES = /\?|\b(what|where|who|when|why|how|do|does|can|could|is|are|tell me|i want to know|would you)\b/i;

function isLikelyInfoQuestion(inputText: string): boolean {
  return INFO_QUESTION_CUES.test(inputText);
}

function hasEstimateIntent(inputText: string): boolean {
  return ESTIMATE_INTENT_CUES.test(inputText);
}

function normalizeAssistantMessage(text: string): string {
  return text
    .replace(/^hi,\s*how are you\?\s*what can i help you with today\?\s*/i, '')
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
  faqMatches: KnowledgeMatch[]
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
    CORE_PROMPT_PREFIX,
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
  hadPriorAssistantTurn: boolean
): string {
  let next = normalizeAssistantMessage(assistantMessage);

  if (!next) return next;

  const topMatch = faqMatches[0];
  const likelyInfoQuestion = isLikelyInfoQuestion(inputText);
  const estimateIntent = hasEstimateIntent(inputText);

  if (
    hadPriorAssistantTurn &&
    /^hi[,! ]/i.test(next) &&
    likelyInfoQuestion
  ) {
    next = next.replace(/^hi[,! ]\s*/i, '').trim();
  }

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
    !hasFollowUpOffer(next)
  ) {
    next =
      "I want to make sure I give you accurate information, and I don't have that confirmed in our Steam Zone QA yet. I can have a team member follow up by call, text, or email. What is the best contact for you?";
  }

  next = enforceSingleQuestion(next);

  return next;
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

function fieldHasExplicitSignal(field: SchemaField, raw: string, state: SessionRecord): boolean {
  const lowered = raw.toLowerCase();

  if (field.type === 'boolean') {
    return hasBooleanCue(raw);
  }

  if (field.type === 'postalCode') {
    return /[A-Za-z]\\d[A-Za-z]\\s?\\d[A-Za-z]\\d/i.test(raw);
  }

  if (field.type === 'email') {
    return lowered.includes('@');
  }

  if (field.type === 'phone') {
    return /\d/.test(raw);
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

function summarizeStateForResponse(state: {
  answers: Record<string, unknown>;
  asked_keys: string[];
  last_question_key: string | null;
}, done: boolean) {
  return {
    answers: state.answers,
    asked_keys: state.asked_keys,
    last_question_key: state.last_question_key,
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
  at = nowIso()
): Promise<void> {
  const runtime = await getRuntime();
  await runtime.appendTranscript(sessionId, { role, content, at });
}

export async function appendTranscript(
  sessionId: string,
  role: TranscriptRole,
  content: string,
  at = nowIso()
): Promise<void> {
  return appendSessionTranscript(sessionId, role, content, at);
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

function transcriptLine(inputText: string, channel?: PostagentChannel, metadata?: Record<string, unknown>): string {
  const prefix = channel ? `[${channel}] ` : '';
  if (!metadata || Object.keys(metadata).length === 0) {
    return `${prefix}${inputText}`;
  }

  return `${prefix}${inputText} ${JSON.stringify(metadata)}`;
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

export async function normalizeAndSetAnswersFromInput(
  runtime: EstimateAgentRuntimeModule,
  sessionId: string,
  inputText: string,
  schema: EstimateFormSchema,
  state: SessionRecord,
  nextHint?: NextHint
): Promise<{ applied: Array<{ field_key: string; normalized_value: unknown }>; ambiguity: string[] }> {
  const lower = inputText.toLowerCase();
  const candidates = collectCandidateFieldKeys(state, schema, nextHint?.done ? undefined : nextHint?.next_field_key, lower);

  const ambiguity: string[] = [];
  const applied: Array<{ field_key: string; normalized_value: unknown }> = [];

  let currentState = state;
  for (const fieldKey of candidates) {
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

function instructionsForContext(
  channel: PostagentChannel | undefined,
  session: SessionRecord,
  inputText: string,
  faqMatches: KnowledgeMatch[]
): string {
  return buildInstructionContext(channel, session, inputText, faqMatches);
}

async function runAgentLoop(
  runtime: EstimateAgentRuntimeModule,
  modelConfig: AgentProviderConfig,
  sessionId: string,
  inputText: string,
  channel?: PostagentChannel
): Promise<{ assistant_message: string; quote: unknown; next_hint: NextHint; done: boolean }> {
  let sessionContext = await runtime.toolGetState(sessionId);
  const faqMatches = await searchSteamZoneKnowledgeAsync(inputText, 3);
  const hadPriorAssistantTurn = Boolean(
    sessionContext.transcript?.some((entry) => asRecord(entry)?.role === 'assistant')
  );

  let response = await callOpenAIWithFallback(modelConfig, {
    model: modelConfig.model,
    instructions: instructionsForContext(channel, sessionContext, inputText, faqMatches),
    input: [
      {
        role: 'user',
        content: inputText,
      },
    ],
    tools: TOOL_DEFS,
    tool_choice: 'auto',
  });

  let assistantMessage = readAssistantText(response);
  let quote: unknown = null;

  for (let i = 0; i < MAX_TURNS; i += 1) {
    const calls = getFunctionCalls(response);
    if (calls.length === 0) break;

    const outputs: Array<{ type: 'function_call_output'; call_id: string; output: string }> = [];
    for (const call of calls) {
      const args = parseArgs(call.arguments);
      const result = await callTool(runtime, call.name, args, sessionId);
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

      response = await callOpenAIWithFallback(modelConfig, {
        model: modelConfig.model,
        instructions: instructionsForContext(channel, sessionContext, inputText, faqMatches),
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

  const session = await runtime.getSession(sessionId);
  const done = runtime.validateRequiredAnswers(session.answers).length === 0;
  const nextHint = done ? { done: true } : await runtime.peekNextQuestion(sessionId);
  const computedQuote = quote === null ? await maybeComputeQuote(runtime, sessionId, done) : quote;

  if (!assistantMessage) {
    if (done && computedQuote) {
      assistantMessage = 'Your estimate is ready. I included the quote below.';
    } else {
      const next = await runtime.toolNextQuestion(sessionId);
      const questionText = next.question_text ?? 'Please provide the next detail.';
      if (!hadPriorAssistantTurn) {
        assistantMessage = `${DEFAULT_USER_START} ${questionText}`.trim();
      } else {
        assistantMessage = questionText;
      }
    }
  }

  assistantMessage = applyResponseGuardrails(assistantMessage, inputText, faqMatches, hadPriorAssistantTurn);

  return {
    assistant_message: assistantMessage,
    quote: computedQuote,
    next_hint: done ? { done: true } : nextHint,
    done,
  };
}

export async function decideNextAssistantTurn(
  request: { session_id: string; input_text: string; channel?: PostagentChannel }
): Promise<PostagentEstimateResponse> {
  const modelConfig = await resolveModelProviderConfig(request.channel);

  const runtime = await getRuntime();
  const sessionId = request.session_id.trim();
  const inputText = String(request.input_text || '').trim() || DEFAULT_USER_START;

  const loopResult = await runAgentLoop(runtime, modelConfig, sessionId, inputText, request.channel);
  const finalState = await runtime.getSession(sessionId);
  const done = loopResult.done;

  const response: PostagentEstimateResponse = {
    session_id: sessionId,
    assistant_message: loopResult.assistant_message,
    state: summarizeStateForResponse(
      {
        answers: finalState.answers,
        asked_keys: finalState.asked_keys,
        last_question_key: finalState.last_question_key,
      },
      done
    ),
    quote: loopResult.quote,
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

export async function runEstimateAgentCore(
  request: PostagentEstimateRequest
): Promise<PostagentEstimateResponse> {
  const modelConfig = await resolveModelProviderConfig(request.channel);

  const runtime = await getRuntime();
  const sessionId = request.session_id?.trim() || newSessionId();
  const inputText = String(request.input_text || '').trim() || DEFAULT_USER_START;
  const channel = request.channel;

  await runtime.appendTranscript(sessionId, {
    role: 'user',
    content: transcriptLine(inputText, channel, request.metadata),
    at: nowIso(),
  });

  const schema = await runtime.toolGetSchema();
  const state = await runtime.toolGetState(sessionId);
  const nextHint = await runtime.peekNextQuestion(sessionId);
  await normalizeAndSetAnswersFromInput(runtime, sessionId, inputText, schema, state, nextHint);

  const loopResult = await runAgentLoop(runtime, modelConfig, sessionId, inputText, channel);
  const finalState = await runtime.getSession(sessionId);
  const done = loopResult.done;

  const finalStateSummary = {
    ...summarizeStateForResponse(
      {
        answers: finalState.answers,
        asked_keys: finalState.asked_keys,
        last_question_key: finalState.last_question_key,
      },
      done
    ),
    done,
  };

  await runtime.appendTranscript(sessionId, {
    role: 'assistant',
    content: loopResult.assistant_message,
    at: nowIso(),
  });

  const response: PostagentEstimateResponse = {
    session_id: sessionId,
    assistant_message: loopResult.assistant_message,
    state: finalStateSummary,
    quote: loopResult.quote,
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
  const hasSession = rawSessionId.length > 0;

  if (!createSessionWhenMissing && !hasSession) {
    res.status(400).json({ message: 'session_id is required.' });
    return;
  }

  try {
    const response = await runEstimateAgentCore({
      session_id: hasSession ? rawSessionId : undefined,
      input_text: inputText,
      channel: (payload?.channel as PostagentChannel | undefined) ?? 'web',
      metadata: asRecord(payload?.metadata) ?? {},
    });

    res.status(200).json(response);
  } catch (error) {
    res.status(500).json({
      message: error instanceof Error ? error.message : 'Unknown estimate-agent error.',
    });
  }
}
