import { AGENT_DEFAULT_MODEL, AGENT_MODEL_OPTIONS, type AgentModelOption } from '../src/estimate/core/agentModelConfig';
import { getSupabaseAdminClient } from './supabaseAdmin';

type ModelSource = 'db' | 'fallback';

type ModelStoreRow = {
  model: string;
  updated_at?: string | null;
};

type ModelPayload = {
  model: string;
  source: ModelSource;
  updatedAt?: string;
};

const TABLE_NAME = 'agent_model_settings';
const ROW_ID = 'estimate_agent';
const CACHE_TTL_MS = 20_000;

const memory: {
  model: string;
  source: ModelSource;
  updatedAt?: string;
  loadedAt: number;
} = {
  model: AGENT_DEFAULT_MODEL,
  source: 'fallback',
  loadedAt: 0,
};

function normalizeModel(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) {
    return AGENT_DEFAULT_MODEL;
  }

  if (value.toLowerCase() === 'glm5') {
    return 'z-ai/glm-5';
  }

  return value;
}

function isMissingTableError(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes(TABLE_NAME) &&
    (text.includes('does not exist') ||
      text.includes('relation') ||
      text.includes('could not find') ||
      text.includes('schema cache'))
  );
}

function modelAllowed(raw: string): boolean {
  const normalized = normalizeModel(raw).toLowerCase();
  return AGENT_MODEL_OPTIONS.some((option) => option.value.toLowerCase() === normalized);
}

function fallbackPayload(): ModelPayload {
  return {
    model: memory.model,
    source: memory.source,
    updatedAt: memory.updatedAt,
  };
}

function cacheFresh(): boolean {
  return memory.loadedAt > 0 && Date.now() - memory.loadedAt < CACHE_TTL_MS;
}

async function loadFromSupabase(): Promise<ModelPayload | null> {
  const supabase = await getSupabaseAdminClient();
  if (!supabase) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select('model, updated_at')
      .eq('id', ROW_ID)
      .maybeSingle();

    if (error) {
      if (isMissingTableError(error.message)) {
        return null;
      }

      throw new Error(error.message);
    }

    if (!data) {
      return null;
    }

    const model = normalizeModel((data as ModelStoreRow).model);
    return {
      model: modelAllowed(model) ? model : AGENT_DEFAULT_MODEL,
      source: 'db',
      updatedAt: (data as ModelStoreRow).updated_at ?? undefined,
    };
  } catch (error) {
    if (error instanceof Error && isMissingTableError(error.message)) {
      return null;
    }
    throw error;
  }
}

export async function getAgentModelConfig(): Promise<ModelPayload> {
  if (cacheFresh()) {
    return fallbackPayload();
  }

  const loaded = await loadFromSupabase();
  if (!loaded) {
    memory.source = 'fallback';
    memory.model = AGENT_DEFAULT_MODEL;
    memory.updatedAt = new Date().toISOString();
    memory.loadedAt = Date.now();
    return fallbackPayload();
  }

  memory.model = loaded.model;
  memory.source = loaded.source;
  memory.updatedAt = loaded.updatedAt;
  memory.loadedAt = Date.now();
  return fallbackPayload();
}

export async function setAgentModelConfig(model: string): Promise<ModelPayload> {
  const normalized = normalizeModel(model);
  if (!modelAllowed(normalized)) {
    throw new Error('Selected model is not in allowed model options.');
  }

  memory.model = normalized;
  memory.source = 'fallback';
  memory.updatedAt = new Date().toISOString();
  memory.loadedAt = Date.now();

  const supabase = await getSupabaseAdminClient();
  if (!supabase) {
    return fallbackPayload();
  }

  const now = memory.updatedAt;
  try {
    const { error } = await supabase.from(TABLE_NAME).upsert(
      {
        id: ROW_ID,
        model: memory.model,
        updated_at: now,
      },
      { onConflict: 'id' }
    );

    if (error) {
      if (isMissingTableError(error.message)) {
        return fallbackPayload();
      }

      throw new Error(error.message);
    }

    memory.source = 'db';
    return fallbackPayload();
  } catch (error) {
    if (error instanceof Error && isMissingTableError(error.message)) {
      memory.source = 'fallback';
      return fallbackPayload();
    }

    throw error;
  }
}

export function getAgentModelOptions(): AgentModelOption[] {
  return AGENT_MODEL_OPTIONS;
}
