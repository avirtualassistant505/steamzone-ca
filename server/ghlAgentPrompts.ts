const GHL_BASE_URL_DEFAULT = 'https://services.leadconnectorhq.com';
const GHL_DEFAULT_API_VERSION = '2021-07-28';
const GHL_CONVERSATION_API_VERSION = '2021-04-15';
const DEFAULT_CHAT_AGENT_ID = 'pzGuMYdZeEpJjKcZ8K1P';
const DEFAULT_VOICE_AGENT_ID = '6987a47137411f2a349c4abf';
const DEFAULT_VOICE_AGENT_NAME = 'Steam Zone Voice Receptionist';

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  version?: string;
};

type GhlContext = {
  token: string;
  locationId: string;
  baseUrl: string;
  defaultVersion: string;
};

type ConversationAgentRecord = {
  id?: string;
  name?: string;
  locationId?: string;
  mode?: string;
  channels?: string[];
  sleepEnabled?: boolean;
  sleepTime?: number;
  sleepTimeUnit?: string;
  actions?: Array<{ id?: string; type?: string }>;
  isPrimary?: boolean;
  autoPilotMaxMessages?: number;
  goal?: string;
  personality?: string;
  instructions?: string;
  knowledgeBaseIds?: string[];
};

type VoiceAgentRecord = {
  id?: string;
  locationId?: string;
  agentName?: string;
  businessName?: string;
  welcomeMessage?: string;
  agentPrompt?: string;
  timezone?: string;
  prompts?: unknown;
  actions?: Array<{ id?: string; actionType?: string; type?: string }>;
};

export type GhlChatAgentPromptConfig = {
  agentId: string;
  name: string;
  locationId?: string;
  goal: string;
  personality: string;
  instructions: string;
  knowledgeBaseIds: string[];
  actionTypes: string[];
};

export type GhlVoiceAgentPromptConfig = {
  agentId: string;
  locationId?: string;
  agentName: string;
  businessName: string;
  welcomeMessage: string;
  agentPrompt: string;
  timezone: string;
};

export type GhlAgentPromptBundle = {
  locationId: string;
  chatAgent: GhlChatAgentPromptConfig;
  voiceAgent: GhlVoiceAgentPromptConfig;
};

function env(name: string): string | null {
  const value = process.env[name];
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function getContext(): GhlContext {
  const token = env('GHL_PRIVATE_INTEGRATION_TOKEN') ?? env('GHL_ACCESS_TOKEN');
  const locationId = env('GHL_LOCATION_ID') ?? 'Aag4ejfEf7EHEqPlsQ2R';
  if (!token) {
    throw new Error('Missing GHL token. Set GHL_PRIVATE_INTEGRATION_TOKEN or GHL_ACCESS_TOKEN.');
  }
  if (!locationId) {
    throw new Error('Missing GHL_LOCATION_ID.');
  }
  return {
    token,
    locationId,
    baseUrl: (env('GHL_BASE_URL') ?? GHL_BASE_URL_DEFAULT).replace(/\/+$/, ''),
    defaultVersion: env('GHL_API_VERSION') ?? GHL_DEFAULT_API_VERSION,
  };
}

async function requestGhl<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const context = getContext();
  const url = new URL(`${context.baseUrl}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${context.token}`,
      Version: options.version ?? context.defaultVersion,
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => '');

  if (!response.ok) {
    const message = asRecord(payload)?.message;
    const detail = typeof message === 'string' && message.trim() ? message.trim() : response.statusText || 'GHL request failed';
    throw new Error(`${detail} (HTTP ${response.status})`);
  }

  return payload as T;
}

function normalizeConversationAgent(payload: unknown): GhlChatAgentPromptConfig {
  const record = (asRecord(payload) ?? {}) as ConversationAgentRecord;
  const actionTypes = Array.isArray(record.actions)
    ? record.actions
        .map((entry) => (typeof entry?.type === 'string' ? entry.type.trim() : ''))
        .filter(Boolean)
    : [];

  return {
    agentId: String(record.id ?? '').trim(),
    name: String(record.name ?? '').trim(),
    locationId: typeof record.locationId === 'string' ? record.locationId : undefined,
    goal: String(record.goal ?? '').trim(),
    personality: String(record.personality ?? '').trim(),
    instructions: String(record.instructions ?? '').trim(),
    knowledgeBaseIds: Array.isArray(record.knowledgeBaseIds)
      ? record.knowledgeBaseIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [],
    actionTypes,
  };
}

function normalizeVoiceAgent(payload: unknown): GhlVoiceAgentPromptConfig {
  const record = (asRecord(payload) ?? {}) as VoiceAgentRecord;
  return {
    agentId: String(record.id ?? '').trim(),
    locationId: typeof record.locationId === 'string' ? record.locationId : undefined,
    agentName: String(record.agentName ?? '').trim(),
    businessName: String(record.businessName ?? '').trim(),
    welcomeMessage: String(record.welcomeMessage ?? '').trim(),
    agentPrompt: String(record.agentPrompt ?? '').trim(),
    timezone: String(record.timezone ?? '').trim(),
  };
}

async function getConversationAgent(agentId: string): Promise<ConversationAgentRecord> {
  return requestGhl<ConversationAgentRecord>(`/conversation-ai/agents/${encodeURIComponent(agentId)}`, {
    version: GHL_CONVERSATION_API_VERSION,
  });
}

async function updateConversationAgent(agentId: string, body: Record<string, unknown>): Promise<ConversationAgentRecord> {
  return requestGhl<ConversationAgentRecord>(`/conversation-ai/agents/${encodeURIComponent(agentId)}`, {
    method: 'PUT',
    body,
    version: GHL_CONVERSATION_API_VERSION,
  });
}

async function listVoiceAgents(locationId: string): Promise<VoiceAgentRecord[]> {
  const payload = await requestGhl<{ agents?: unknown[] }>('/voice-ai/agents', {
    query: { locationId, page: 1, pageSize: 50 },
    version: GHL_CONVERSATION_API_VERSION,
  });
  return Array.isArray(payload?.agents) ? (payload.agents as VoiceAgentRecord[]) : [];
}

async function getVoiceAgent(agentId: string, locationId: string): Promise<VoiceAgentRecord> {
  return requestGhl<VoiceAgentRecord>(`/voice-ai/agents/${encodeURIComponent(agentId)}`, {
    query: { locationId },
    version: GHL_CONVERSATION_API_VERSION,
  });
}

async function patchVoiceAgent(agentId: string, locationId: string, body: Record<string, unknown>): Promise<VoiceAgentRecord> {
  return requestGhl<VoiceAgentRecord>(`/voice-ai/agents/${encodeURIComponent(agentId)}`, {
    method: 'PATCH',
    query: { locationId },
    body,
    version: GHL_CONVERSATION_API_VERSION,
  });
}

function buildConversationUpdateBody(current: ConversationAgentRecord, patch: Partial<Pick<GhlChatAgentPromptConfig, 'goal' | 'personality' | 'instructions'>>): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: current.name,
    mode: current.mode,
    channels: current.channels,
    sleepEnabled: current.sleepEnabled,
    actions: current.actions,
    isPrimary: current.isPrimary,
    autoPilotMaxMessages: current.autoPilotMaxMessages,
    goal: patch.goal ?? current.goal ?? '',
    personality: patch.personality ?? current.personality ?? '',
    instructions: patch.instructions ?? current.instructions ?? '',
    knowledgeBaseIds: current.knowledgeBaseIds ?? [],
  };
  if (current.sleepEnabled) {
    body.sleepTime = current.sleepTime;
    body.sleepTimeUnit = current.sleepTimeUnit;
  }
  return body;
}

async function resolveVoiceAgentId(locationId: string): Promise<string> {
  const direct = env('GHL_VOICE_AI_AGENT_ID');
  if (direct) return direct;

  const desiredName = normalizeKey(env('GHL_VOICE_AI_AGENT_NAME') ?? DEFAULT_VOICE_AGENT_NAME);
  const agents = await listVoiceAgents(locationId);
  const matched =
    agents.find((entry) => normalizeKey(String(entry.agentName ?? '')) === desiredName) ??
    agents.find((entry) => normalizeKey(String(entry.businessName ?? '')) === normalizeKey('Steam Zone')) ??
    agents[0] ??
    null;

  return String(matched?.id ?? DEFAULT_VOICE_AGENT_ID).trim();
}

export function getGhlAgentPromptContext(): { locationId: string; chatAgentId: string } {
  const context = getContext();
  return {
    locationId: context.locationId,
    chatAgentId: env('GHL_CONV_AI_AGENT_ID') ?? DEFAULT_CHAT_AGENT_ID,
  };
}

export async function getGhlAgentPrompts(): Promise<GhlAgentPromptBundle> {
  const { locationId } = getContext();
  const chatAgentId = env('GHL_CONV_AI_AGENT_ID') ?? DEFAULT_CHAT_AGENT_ID;
  const voiceAgentId = await resolveVoiceAgentId(locationId);
  const [chatRaw, voiceRaw] = await Promise.all([
    getConversationAgent(chatAgentId),
    getVoiceAgent(voiceAgentId, locationId),
  ]);

  return {
    locationId,
    chatAgent: normalizeConversationAgent(chatRaw),
    voiceAgent: normalizeVoiceAgent(voiceRaw),
  };
}

export async function updateGhlAgentPrompts(bundle: {
  chatAgent: Pick<GhlChatAgentPromptConfig, 'goal' | 'personality' | 'instructions'>;
  voiceAgent: Pick<GhlVoiceAgentPromptConfig, 'welcomeMessage' | 'agentPrompt'>;
}): Promise<GhlAgentPromptBundle> {
  const { locationId } = getContext();
  const chatAgentId = env('GHL_CONV_AI_AGENT_ID') ?? DEFAULT_CHAT_AGENT_ID;
  const voiceAgentId = await resolveVoiceAgentId(locationId);

  const currentChat = await getConversationAgent(chatAgentId);
  await updateConversationAgent(
    chatAgentId,
    buildConversationUpdateBody(currentChat, {
      goal: bundle.chatAgent.goal.trim(),
      personality: bundle.chatAgent.personality.trim(),
      instructions: bundle.chatAgent.instructions.trim(),
    })
  );

  await patchVoiceAgent(voiceAgentId, locationId, {
    welcomeMessage: bundle.voiceAgent.welcomeMessage.trim(),
    agentPrompt: bundle.voiceAgent.agentPrompt.trim(),
  });

  return getGhlAgentPrompts();
}
