import { getSessionStorageMode } from '../server/estimateAgentSessionStore.js';
import { getConversationStorageMode, listConversationSessions } from '../server/conversationLogStore.js';
import { getTrainingDataCacheState, loadActiveTrainingItems } from '../server/trainingDataStore.js';

type ApiRequest = { method?: string };
type ApiResponse = { status: (code: number) => ApiResponse; json: (body: unknown) => void };

type GhlHealthPayload = {
  ok: boolean;
  mode: 'none' | 'webhook' | 'api';
  hasToken: boolean;
  hasLocationId: boolean;
  expectedLocationName: string | null;
  actualLocationName: string | null;
  expectedNameMatches: boolean | null;
  locationId: string | null;
  baseUrl: string;
  version: string;
  locationWebsite: string | null;
  businessWebsite: string | null;
  ghl: {
    status?: number;
    ok: boolean;
    error?: string;
  };
  training: {
    source: 'db' | 'fallback';
    itemCount: number;
    updatedAt?: string;
    cacheLoadedAt: string | null;
    fallbackFilePath?: string;
  };
  storage: {
    sessions: 'database' | 'memory_fallback';
    conversations: 'database' | 'memory_fallback';
    recentConversationCount: number;
  };
  forms?: {
    total: number;
    genericNameCount: number;
    legacyForm: {
      id: string;
      present: boolean;
      name?: string;
      recentSubmissionCount: number;
    };
    serviceFormIdsPresent: string[];
    forms: Array<{ id: string; name: string }>;
  };
  chatAgent?: {
    id: string;
    knowledgeBaseIds: string[];
    knowledgeBaseCount: number;
    actionTypes: string[];
  };
  customFields?: {
    total: number;
    unexpectedFields: string[];
  };
};

const ghlBaseUrlDefault = 'https://services.leadconnectorhq.com';
const ghlApiVersionDefault = '2021-07-28';
const GHL_CONVERSATION_API_VERSION = '2021-04-15';
const LEGACY_FORM_ID = 'QbZdWQw7h4X7jkW8BEJ3';
const ACTIVE_FORM_IDS = ['NdaccmBU8EAZiNgvGLld', 'ncAHWlSdycnTE4UqlTHo', 'Vhw1yGTzvEJOqyjPzzNK', 'ymWd01vSPDLK3Hx7LS8Y'];
const DEFAULT_CHAT_AGENT_ID = 'pzGuMYdZeEpJjKcZ8K1P';
const EXPECTED_CUSTOM_FIELDS = new Set([
  'service_type',
  'storey',
  'travel_zone',
  'quote_number',
  'consent_to_contact',
  'marketing_opt_in',
  'estimate_low',
  'estimate_high',
  'duration_low_hours',
  'duration_high_hours',
  'confidence',
  'booking_mode',
  'red_flags',
  'estimate_notes',
  'wizard_answers_json',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
]);

function env(name: string): string | null {
  const raw = process.env[name];
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed ? trimmed : null;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function extractLocationName(payload: unknown): string | null {
  const p = asRecord(payload);
  if (!p) return null;
  const location = asRecord(p['location']);
  const fromLocation = location && typeof location['name'] === 'string' ? (location['name'] as string) : null;
  const fromRoot = typeof p['name'] === 'string' ? (p['name'] as string) : null;
  const data = asRecord(p['data']);
  const fromData = data && typeof data['name'] === 'string' ? (data['name'] as string) : null;
  return fromLocation ?? fromRoot ?? fromData ?? null;
}

function extractLocationWebsite(payload: unknown): { locationWebsite: string | null; businessWebsite: string | null } {
  const p = asRecord(payload);
  if (!p) {
    return { locationWebsite: null, businessWebsite: null };
  }
  const location = asRecord(p['location']);
  const business = location ? asRecord(location['business']) : asRecord(p['business']);
  const locationWebsite =
    (location && typeof location['website'] === 'string' ? (location['website'] as string) : null) ??
    (typeof p['website'] === 'string' ? (p['website'] as string) : null);
  const businessWebsite = business && typeof business['website'] === 'string' ? (business['website'] as string) : null;
  return { locationWebsite, businessWebsite };
}

function pickVersionForPath(pathname: string): string {
  if (pathname.startsWith('/voice-ai') || pathname.startsWith('/conversation-ai')) {
    return GHL_CONVERSATION_API_VERSION;
  }
  return ghlApiVersionDefault;
}

async function requestGhl(
  baseUrl: string,
  token: string,
  path: string,
  query: Record<string, string | number | undefined> = {}
): Promise<{ status: number; ok: boolean; payload: unknown }> {
  const url = new URL(`${baseUrl}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      Version: pickVersionForPath(path),
    },
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => '');
  return { status: response.status, ok: response.ok, payload };
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, message: 'Method not allowed' });
    return;
  }

  const token = env('GHL_PRIVATE_INTEGRATION_TOKEN') ?? env('GHL_ACCESS_TOKEN');
  const locationId = env('GHL_LOCATION_ID');
  const expectedLocationName = env('GHL_EXPECT_LOCATION_NAME');
  const inboundWebhookUrl = env('GHL_INBOUND_WEBHOOK_URL');
  const baseUrl = (env('GHL_BASE_URL') ?? ghlBaseUrlDefault).replace(/\/+$/, '');
  const version = env('GHL_API_VERSION') ?? ghlApiVersionDefault;
  const chatAgentId = env('GHL_CONV_AI_AGENT_ID') ?? DEFAULT_CHAT_AGENT_ID;

  const trainingLoaded = await loadActiveTrainingItems();
  const trainingCache = getTrainingDataCacheState();
  const recentConversations = await listConversationSessions(25).catch(() => []);

  const responseBase: Omit<GhlHealthPayload, 'ghl'> & { ghl: GhlHealthPayload['ghl'] } = {
    ok: true,
    mode: inboundWebhookUrl ? 'webhook' : 'none',
    hasToken: Boolean(token),
    hasLocationId: Boolean(locationId),
    expectedLocationName: expectedLocationName ?? null,
    actualLocationName: null,
    expectedNameMatches: null,
    locationId: locationId ?? null,
    baseUrl,
    version,
    locationWebsite: null,
    businessWebsite: null,
    ghl: { ok: false },
    training: {
      source: trainingLoaded.source,
      itemCount: trainingLoaded.items.length,
      updatedAt: trainingLoaded.updatedAt,
      cacheLoadedAt: trainingCache.loadedAt,
      fallbackFilePath: trainingCache.fallbackFilePath,
    },
    storage: {
      sessions: getSessionStorageMode(),
      conversations: getConversationStorageMode(),
      recentConversationCount: recentConversations.length,
    },
  };

  if (!token || !locationId) {
    res.status(200).json(responseBase);
    return;
  }

  try {
    const [locationResponse, formsResponse, submissionsResponse, chatAgentResponse, customFieldsResponse] = await Promise.all([
      requestGhl(baseUrl, token, `/locations/${locationId}`),
      requestGhl(baseUrl, token, '/forms/', { locationId, limit: 100 }),
      requestGhl(baseUrl, token, '/forms/submissions', { locationId, limit: 50 }),
      requestGhl(baseUrl, token, `/conversation-ai/agents/${chatAgentId}`),
      requestGhl(baseUrl, token, `/locations/${locationId}/customFields`, { model: 'contact' }),
    ]);

    const actualLocationName = extractLocationName(locationResponse.payload);
    const websites = extractLocationWebsite(locationResponse.payload);
    const nameMatches =
      expectedLocationName && actualLocationName
        ? normalizeKey(expectedLocationName) === normalizeKey(actualLocationName)
        : null;

    const formsPayload = asRecord(formsResponse.payload);
    const formsList = Array.isArray(formsPayload?.['forms']) ? (formsPayload?.['forms'] as Array<Record<string, unknown>>) : [];
    const forms = formsList
      .map((item) => ({
        id: typeof item.id === 'string' ? item.id : '',
        name: typeof item.name === 'string' ? item.name : '',
      }))
      .filter((item) => item.id);

    const submissionsPayload = asRecord(submissionsResponse.payload);
    const submissions = Array.isArray(submissionsPayload?.['submissions'])
      ? (submissionsPayload?.['submissions'] as Array<Record<string, unknown>>)
      : [];
    const legacySubmissionCount = submissions.filter((item) => item.formId === LEGACY_FORM_ID).length;

    const chatAgentPayload = asRecord(chatAgentResponse.payload);
    const knowledgeBaseIds = Array.isArray(chatAgentPayload?.['knowledgeBaseIds'])
      ? (chatAgentPayload?.['knowledgeBaseIds'] as string[]).filter((item) => typeof item === 'string')
      : [];
    const chatActions = Array.isArray(chatAgentPayload?.['actions'])
      ? (chatAgentPayload?.['actions'] as Array<Record<string, unknown>>)
      : [];
    const actionTypes = chatActions
      .map((action) => (typeof action.type === 'string' ? action.type : ''))
      .filter(Boolean);

    const customFieldsPayload = asRecord(customFieldsResponse.payload);
    const customFields = Array.isArray(customFieldsPayload?.['customFields'])
      ? (customFieldsPayload?.['customFields'] as Array<Record<string, unknown>>)
      : [];
    const unexpectedFields = customFields
      .map((field) => (typeof field.name === 'string' ? field.name : ''))
      .filter(Boolean)
      .filter((name) => !EXPECTED_CUSTOM_FIELDS.has(name))
      .sort((left, right) => left.localeCompare(right));

    const payload: GhlHealthPayload = {
      ...responseBase,
      mode: 'api',
      actualLocationName,
      expectedNameMatches: nameMatches,
      locationWebsite: websites.locationWebsite,
      businessWebsite: websites.businessWebsite,
      ghl: {
        status: locationResponse.status,
        ok:
          locationResponse.ok &&
          formsResponse.ok &&
          submissionsResponse.ok &&
          chatAgentResponse.ok &&
          customFieldsResponse.ok,
      },
      forms: {
        total: forms.length,
        genericNameCount: forms.filter((item) => /^Form\s+\d+$/i.test(item.name)).length,
        legacyForm: {
          id: LEGACY_FORM_ID,
          present: forms.some((item) => item.id === LEGACY_FORM_ID),
          name: forms.find((item) => item.id === LEGACY_FORM_ID)?.name,
          recentSubmissionCount: legacySubmissionCount,
        },
        serviceFormIdsPresent: ACTIVE_FORM_IDS.filter((id) => forms.some((item) => item.id === id)),
        forms,
      },
      chatAgent: {
        id: chatAgentId,
        knowledgeBaseIds,
        knowledgeBaseCount: knowledgeBaseIds.length,
        actionTypes,
      },
      customFields: {
        total: customFields.length,
        unexpectedFields,
      },
    };

    res.status(200).json(payload);
  } catch (error) {
    res.status(200).json({
      ...responseBase,
      mode: 'api',
      ghl: {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    } satisfies GhlHealthPayload);
  }
}
