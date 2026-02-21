import {
  AGENT_DEFAULT_MODEL,
  AGENT_DEFAULT_VOICE_MODEL,
  AGENT_MODEL_OPTIONS,
  AGENT_VOICE_MODEL_OPTIONS,
  type AgentModelOption,
} from '../src/estimate/core/agentModelConfig.js';
import { getSupabaseAdminClient } from './supabaseAdmin.js';

type ModelSource = 'db' | 'fallback';

type ModelStoreRow = {
  model: string;
  voice_model?: string | null;
  updated_at?: string | null;
};

type ModelPayload = {
  model: string;
  voiceModel: string;
  source: ModelSource;
  updatedAt?: string;
};

type AgentModelUpdate = {
  model?: string;
  voice_model?: string;
};

const TABLE_NAME = 'agent_model_settings';
const ROW_ID = 'estimate_agent';
const CACHE_TTL_MS = 20_000;

const memory = {
  model: AGENT_DEFAULT_MODEL,
  voiceModel: AGENT_DEFAULT_VOICE_MODEL,
  source: 'fallback' as ModelSource,
  updatedAt: undefined as string | undefined,
  loadedAt: 0,
};

function normalizeModel(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return AGENT_DEFAULT_MODEL;

  if (value.toLowerCase() === 'glm5') {
    return 'z-ai/glm-5';
  }

  return value;
}

function normalizeVoiceModel(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return AGENT_DEFAULT_VOICE_MODEL;
  return value;
}

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

function modelAllowed(raw: string): boolean {
  const normalized = normalizeModel(raw).toLowerCase();
  return AGENT_MODEL_OPTIONS.some((option) => option.value.toLowerCase() === normalized);
}

function voiceModelAllowed(raw: string): boolean {
  const normalized = normalizeVoiceModel(raw).toLowerCase();
  return AGENT_VOICE_MODEL_OPTIONS.some((option) => option.value.toLowerCase() === normalized);
}

function payloadFromMemory(): ModelPayload {
  return {
    model: memory.model,
    voiceModel: memory.voiceModel,
    source: memory.source,
    updatedAt: memory.updatedAt,
  };
}

function cacheFresh(): boolean {
  return memory.loadedAt > 0 && Date.now() - memory.loadedAt < CACHE_TTL_MS;
}

function parseAgentModelInput(raw: string | AgentModelUpdate): { model: string; voiceModel: string } {
  if (typeof raw === 'string') {
    return {
      model: normalizeModel(raw),
      voiceModel: AGENT_DEFAULT_VOICE_MODEL,
    };
  }

  return {
    model: normalizeModel(raw?.model),
    voiceModel: normalizeVoiceModel(raw?.voice_model),
  };
}

function isModelStoreRow(value: unknown): value is ModelStoreRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const row = value as Record<string, unknown>;
  return typeof row.model === 'string' && row.model.trim().length > 0;
}

async function loadFromSupabase(selectColumns: string): Promise<ModelPayload | null> {
  const supabase = await getSupabaseAdminClient();
  if (!supabase) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select(selectColumns)
      .eq('id', ROW_ID)
      .maybeSingle();

    if (error) {
      if (isMissingTableError(error.message) || isMissingColumnError(error.message, 'voice_model')) {
        return null;
      }

      throw new Error(error.message);
    }

    if (!data) {
      return null;
    }

    if (!isModelStoreRow(data)) {
      return null;
    }

    const row = data;
    const model = normalizeModel(row.model);
    const voiceModel = normalizeVoiceModel(row.voice_model);

    return {
      model: modelAllowed(model) ? model : AGENT_DEFAULT_MODEL,
      voiceModel: voiceModelAllowed(voiceModel) ? voiceModel : AGENT_DEFAULT_VOICE_MODEL,
      source: 'db',
      updatedAt: row.updated_at ?? undefined,
    };
  } catch (error) {
    if (error instanceof Error && (isMissingTableError(error.message) || isMissingColumnError(error.message, 'voice_model'))) {
      return null;
    }

    throw error;
  }
}

async function upsertModelPayload(payload: Pick<ModelPayload, 'model' | 'voiceModel' | 'updatedAt'>, withVoiceModel = true): Promise<void> {
  const supabase = await getSupabaseAdminClient();
  if (!supabase) {
    memory.source = 'fallback';
    return;
  }

  const now = payload.updatedAt;
  const base = {
    id: ROW_ID,
    model: payload.model,
    updated_at: now,
  };

  if (withVoiceModel) {
    const withVoice = {
      ...base,
      voice_model: payload.voiceModel,
    };

    const { error } = await supabase.from(TABLE_NAME).upsert(withVoice, { onConflict: 'id' });
    if (!error) {
      memory.source = 'db';
      return;
    }

    const message = error.message.toLowerCase();
    if (isMissingColumnError(message, 'voice_model') || message.includes('does not exist')) {
      await upsertModelPayload(payload, false);
      return;
    }

    throw new Error(error.message);
  }

  const { error } = await supabase.from(TABLE_NAME).upsert(base, { onConflict: 'id' });
  if (error) {
    if (isMissingTableError(error.message)) {
      memory.source = 'fallback';
      return;
    }

    throw new Error(error.message);
  }

  memory.source = 'db';
}

async function loadAgentModelConfigFromDb(): Promise<ModelPayload | null> {
  const withVoice = await loadFromSupabase('model, voice_model, updated_at');
  if (withVoice) return withVoice;

  const legacy = await loadFromSupabase('model, updated_at');
  if (!legacy) return null;

  return {
    ...legacy,
    voiceModel: AGENT_DEFAULT_VOICE_MODEL,
  };
}

export async function getAgentModelConfig(): Promise<ModelPayload> {
  if (cacheFresh()) {
    return payloadFromMemory();
  }

  const loaded = await loadAgentModelConfigFromDb();
  if (!loaded) {
    memory.model = AGENT_DEFAULT_MODEL;
    memory.voiceModel = AGENT_DEFAULT_VOICE_MODEL;
    memory.source = 'fallback';
    memory.updatedAt = new Date().toISOString();
    memory.loadedAt = Date.now();
    return payloadFromMemory();
  }

  memory.model = loaded.model;
  memory.voiceModel = loaded.voiceModel;
  memory.source = loaded.source;
  memory.updatedAt = loaded.updatedAt;
  memory.loadedAt = Date.now();
  return payloadFromMemory();
}

export async function setAgentModelConfig(modelOrPayload: string | AgentModelUpdate): Promise<ModelPayload> {
  const parsed = parseAgentModelInput(modelOrPayload);

  if (!modelAllowed(parsed.model)) {
    throw new Error('Selected model is not in allowed model options.');
  }

  const safeVoiceModel = voiceModelAllowed(parsed.voiceModel) ? parsed.voiceModel : AGENT_DEFAULT_VOICE_MODEL;

  memory.model = parsed.model;
  memory.voiceModel = safeVoiceModel;
  memory.source = 'fallback';
  memory.updatedAt = new Date().toISOString();
  memory.loadedAt = Date.now();

  await upsertModelPayload({
    model: memory.model,
    voiceModel: safeVoiceModel,
    updatedAt: memory.updatedAt,
  }, true);

  return payloadFromMemory();
}

export function getAgentModelOptions(): AgentModelOption[] {
  return AGENT_MODEL_OPTIONS;
}

export function getAgentVoiceModelOptions(): AgentModelOption[] {
  return AGENT_VOICE_MODEL_OPTIONS;
}
