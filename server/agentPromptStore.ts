import { getSupabaseAdminClient } from './supabaseAdmin.js';

type PromptSource = 'db' | 'fallback';

export type AgentPromptPayload = {
  prompt: string;
  source: PromptSource;
  updatedAt?: string;
};

export const DEFAULT_AGENT_SYSTEM_PROMPT = [
  'You are a human-like Steam Zone customer service representative handling chat/voice/sms conversations.',
  'Your first job is to help with customer questions naturally. Estimate collection is secondary unless the customer asks for a quote.',
  'Do not switch into estimate collection until the user confirms they want an estimate/quote.',
  'When estimate mode starts, guide in fixed order from schema: service type -> location/zone -> project details -> contact details.',
  'For estimate intake, only collect these schema service types: Residential Windows, Commercial Windows, Carpet Cleaning, and Post-Construction. Do not invent additional estimate service types.',
  'Collect estimate answers to match the schema and compute quotes deterministically only with tools.',
  'Only start with a warm opener on a brand-new conversation. Do not repeat greetings after the first assistant turn.',
  'When users ask service/business questions, use FAQ/training data first before answering.',
  "If the answer is not clearly available in FAQ/training data, do not guess. Offer a team follow-up by call/text/email.",
  'For vague/general conversation prompts, respond naturally first in a human tone before escalating to callback fallback language.',
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
  '- While estimate mode is active, if the user asks a service/business question, answer it briefly first (from FAQ/training data) and then continue with exactly one estimate question.',
  '- If input is ambiguous or invalid, call normalize_and_validate and follow the clarification question.',
  '- If enough required data exists, call compute_quote and present the returned number.',
  '- Do not output raw JSON tool calls in plain text.',
].join('\n');

type PromptStoreRow = {
  prompt_text?: unknown;
  updated_at?: string | null;
};

const TABLE_NAME = 'agent_model_settings';
const ROW_ID = 'estimate_agent';
const CACHE_TTL_MS = 20_000;

const memory = {
  prompt: DEFAULT_AGENT_SYSTEM_PROMPT,
  source: 'fallback' as PromptSource,
  updatedAt: undefined as string | undefined,
  loadedAt: 0,
};

function isMissingTableError(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes(TABLE_NAME) &&
    (text.includes('does not exist') || text.includes('relation') || text.includes('schema cache') || text.includes('could not find'))
  );
}

function isMissingColumnError(message: string, column: string): boolean {
  const text = message.toLowerCase();
  return text.includes(column) && (text.includes('does not exist') || text.includes('unknown column') || text.includes('could not find'));
}

function isTransientSupabaseError(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes('fetch failed') ||
    text.includes('networkerror') ||
    text.includes('socket hang up') ||
    text.includes('failed to fetch') ||
    text.includes('econnreset') ||
    text.includes('econnrefused') ||
    text.includes('timeout')
  );
}

function normalizePrompt(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  return value || DEFAULT_AGENT_SYSTEM_PROMPT;
}

function cacheFresh(): boolean {
  return memory.loadedAt > 0 && Date.now() - memory.loadedAt < CACHE_TTL_MS;
}

async function loadFromSupabase(): Promise<AgentPromptPayload | null> {
  const supabase = await getSupabaseAdminClient();
  if (!supabase) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select('prompt_text, updated_at')
      .eq('id', ROW_ID)
      .maybeSingle();

    if (error) {
      if (isMissingTableError(error.message) || isMissingColumnError(error.message, 'prompt_text')) {
        return null;
      }

      if (isTransientSupabaseError(error.message)) {
        return null;
      }

      throw new Error(error.message);
    }

    if (!data) {
      return null;
    }

    const typed = data as PromptStoreRow;
    const prompt = normalizePrompt(typed.prompt_text);

    return {
      prompt,
      source: 'db',
      updatedAt: typed.updated_at ?? undefined,
    };
  } catch (error) {
    if (error instanceof Error) {
      if (isMissingTableError(error.message) || isMissingColumnError(error.message, 'prompt_text') || isTransientSupabaseError(error.message)) {
        return null;
      }

      throw error;
    }

    return null;
  }
}

export async function getAgentSystemPromptConfig(): Promise<AgentPromptPayload> {
  if (cacheFresh()) {
    return {
      prompt: memory.prompt,
      source: memory.source,
      updatedAt: memory.updatedAt,
    };
  }

  const loaded = await loadFromSupabase();
  if (!loaded) {
    return {
      prompt: memory.prompt,
      source: memory.source,
      updatedAt: memory.updatedAt,
    };
  }

  memory.prompt = loaded.prompt;
  memory.source = loaded.source;
  memory.updatedAt = loaded.updatedAt;
  memory.loadedAt = Date.now();

  return {
    prompt: memory.prompt,
    source: memory.source,
    updatedAt: memory.updatedAt,
  };
}

export async function setAgentSystemPrompt(promptText: string): Promise<AgentPromptPayload> {
  const normalized = normalizePrompt(promptText);
  if (!normalized) {
    throw new Error('Prompt text is required.');
  }

  memory.prompt = normalized;
  memory.source = 'fallback';
  memory.updatedAt = new Date().toISOString();
  memory.loadedAt = Date.now();

  const supabase = await getSupabaseAdminClient();
  if (!supabase) {
    return {
      prompt: memory.prompt,
      source: memory.source,
      updatedAt: memory.updatedAt,
    };
  }

  const payload = {
    id: ROW_ID,
    prompt_text: normalized,
    updated_at: memory.updatedAt,
  };

  try {
    const { error } = await supabase.from(TABLE_NAME).upsert(payload, { onConflict: 'id' });
    if (error) {
      if (isMissingColumnError(error.message, 'prompt_text') || isMissingTableError(error.message) || isTransientSupabaseError(error.message)) {
        return {
          prompt: memory.prompt,
          source: 'fallback',
          updatedAt: memory.updatedAt,
        };
      }

      throw new Error(error.message);
    }

    memory.source = 'db';
    return {
      prompt: memory.prompt,
      source: memory.source,
      updatedAt: memory.updatedAt,
    };
  } catch (error) {
    if (error instanceof Error && (isMissingColumnError(error.message, 'prompt_text') || isMissingTableError(error.message) || isTransientSupabaseError(error.message))) {
      memory.source = 'fallback';
      return {
        prompt: memory.prompt,
        source: 'fallback',
        updatedAt: memory.updatedAt,
      };
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error('Unable to save prompt.');
  }
}
