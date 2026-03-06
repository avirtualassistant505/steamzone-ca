const GHL_BASE_URL_DEFAULT = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION_DEFAULT = '2021-07-28';

export type GhlKnowledgeBase = {
  id: string;
  name: string;
  locationId?: string;
};

export type GhlKnowledgeFaq = {
  id: string;
  knowledgeBaseId: string;
  locationId?: string;
  question: string;
  answer: string;
  createdAt?: string;
  updatedAt?: string;
  deleted?: boolean;
};

type GhlContext = {
  token: string;
  locationId: string;
  baseUrl: string;
  version: string;
};

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
};

function env(name: string): string | null {
  const value = process.env[name];
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function getContext(): GhlContext {
  const token = env('GHL_PRIVATE_INTEGRATION_TOKEN') ?? env('GHL_ACCESS_TOKEN');
  const locationId = env('GHL_LOCATION_ID');
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
    version: env('GHL_API_VERSION') ?? GHL_API_VERSION_DEFAULT,
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
      Version: context.version,
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

function normalizeKnowledgeBase(item: unknown): GhlKnowledgeBase | null {
  const record = asRecord(item);
  if (!record) return null;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (!id || !name) return null;
  return {
    id,
    name,
    locationId: typeof record.locationId === 'string' ? record.locationId : undefined,
  };
}

function normalizeFaq(item: unknown): GhlKnowledgeFaq | null {
  const record = asRecord(item);
  if (!record) return null;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const knowledgeBaseId = typeof record.knowledgeBaseId === 'string' ? record.knowledgeBaseId.trim() : '';
  const question = typeof record.question === 'string' ? record.question.trim() : '';
  const answer = typeof record.answer === 'string' ? record.answer.trim() : '';
  if (!id || !knowledgeBaseId || !question || !answer) return null;
  return {
    id,
    knowledgeBaseId,
    question,
    answer,
    locationId: typeof record.locationId === 'string' ? record.locationId : undefined,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : undefined,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : undefined,
    deleted: Boolean(record.deleted),
  };
}

export function getGhlKnowledgeBaseContext(): { locationId: string } {
  const context = getContext();
  return { locationId: context.locationId };
}

export async function listKnowledgeBases(): Promise<GhlKnowledgeBase[]> {
  const { locationId } = getContext();
  const payload = await requestGhl<{ knowledgeBases?: unknown[]; data?: { knowledgeBases?: unknown[] } }>('/knowledge-bases/', {
    query: { locationId },
  });
  const outerKnowledgeBases = Array.isArray(payload?.knowledgeBases) ? payload.knowledgeBases : [];
  const nestedKnowledgeBases = Array.isArray(payload?.data?.knowledgeBases) ? payload.data.knowledgeBases : [];
  const knowledgeBases = outerKnowledgeBases.length > 0 ? outerKnowledgeBases : nestedKnowledgeBases;
  return knowledgeBases
    .map((item) => normalizeKnowledgeBase(item))
    .filter((item): item is GhlKnowledgeBase => item !== null)
    .filter((item) => !/^archived\b/i.test(item.name))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function listKnowledgeFaqs(knowledgeBaseId: string): Promise<GhlKnowledgeFaq[]> {
  const normalizedKnowledgeBaseId = knowledgeBaseId.trim();
  if (!normalizedKnowledgeBaseId) {
    throw new Error('Missing knowledgeBaseId.');
  }
  const { locationId } = getContext();
  const out: GhlKnowledgeFaq[] = [];
  let hasMore = true;
  let lastFaqId = '';
  let guard = 0;

  while (hasMore && guard < 50) {
    guard += 1;
    const payload = await requestGhl<{ faqs?: unknown[]; hasMore?: boolean; lastFaqId?: string }>('/knowledge-bases/faqs', {
      query: {
        locationId,
        knowledgeBaseId: normalizedKnowledgeBaseId,
        limit: 100,
        lastFaqId: lastFaqId || undefined,
      },
    });
    const faqs = Array.isArray(payload?.faqs) ? payload.faqs : [];
    out.push(
      ...faqs
        .map((item) => normalizeFaq(item))
        .filter((item): item is GhlKnowledgeFaq => item !== null && !item.deleted)
    );
    hasMore = Boolean(payload?.hasMore);
    lastFaqId = typeof payload?.lastFaqId === 'string' ? payload.lastFaqId : '';
    if (hasMore && !lastFaqId) break;
  }

  return out;
}

export async function createKnowledgeFaq(knowledgeBaseId: string, question: string, answer: string): Promise<GhlKnowledgeFaq> {
  const normalizedKnowledgeBaseId = knowledgeBaseId.trim();
  const normalizedQuestion = question.trim();
  const normalizedAnswer = answer.trim();
  if (!normalizedKnowledgeBaseId || !normalizedQuestion || !normalizedAnswer) {
    throw new Error('knowledgeBaseId, question, and answer are required.');
  }

  const { locationId } = getContext();
  const payload = await requestGhl<{ faq?: unknown }>('/knowledge-bases/faqs', {
    method: 'POST',
    body: {
      locationId,
      knowledgeBaseId: normalizedKnowledgeBaseId,
      question: normalizedQuestion,
      answer: normalizedAnswer,
    },
  });
  const faq = normalizeFaq(payload?.faq);
  if (!faq) {
    throw new Error('GHL returned an invalid FAQ payload after create.');
  }
  return faq;
}

export async function updateKnowledgeFaq(faqId: string, knowledgeBaseId: string, question: string, answer: string): Promise<void> {
  const normalizedFaqId = faqId.trim();
  const normalizedKnowledgeBaseId = knowledgeBaseId.trim();
  const normalizedQuestion = question.trim();
  const normalizedAnswer = answer.trim();
  if (!normalizedFaqId || !normalizedKnowledgeBaseId || !normalizedQuestion || !normalizedAnswer) {
    throw new Error('faqId, knowledgeBaseId, question, and answer are required.');
  }

  const { locationId } = getContext();
  await requestGhl(`/knowledge-bases/faqs/${encodeURIComponent(normalizedFaqId)}`, {
    method: 'PUT',
    body: {
      locationId,
      knowledgeBaseId: normalizedKnowledgeBaseId,
      question: normalizedQuestion,
      answer: normalizedAnswer,
    },
  });
}

export async function deleteKnowledgeFaq(faqId: string): Promise<void> {
  const normalizedFaqId = faqId.trim();
  if (!normalizedFaqId) {
    throw new Error('faqId is required.');
  }
  await requestGhl(`/knowledge-bases/faqs/${encodeURIComponent(normalizedFaqId)}`, {
    method: 'DELETE',
  });
}
