import { createHash } from 'node:crypto';
import { computeDeterministicQuote } from '../src/quote/quoteEngine.js';
import { validateRequiredAnswers } from '../src/quote/normalization.js';
import { getEstimateSchema } from '../src/quote/schema.js';
import estimateCreateHandler from '../api/estimate-create.js';
import { getSession, saveSession } from './estimateAgentSessionStore.js';

import type { QuoteOutput } from '../src/quote/quoteEngine.js';

export interface FinalizeEstimateResult {
  ok: boolean;
  session_id: string;
  quote_hash: string;
  quote: QuoteOutput | null;
  record_id: string | null;
  quote_number: string | null;
  email: { message: string; success: boolean; deliveryMode?: 'customer' | 'internal' } | null;
  already_finalized: boolean;
  message?: string;
}

type MockResponse = {
  statusCode: number;
  payload: unknown;
  status(code: number): MockResponse;
  json(body: unknown): void;
};

function makeMockResponse(): MockResponse {
  return {
    statusCode: 200,
    payload: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.payload = body;
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`).join(',')}}`;
}

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

function hashQuoteInputs(sessionId: string, answers: Record<string, unknown>): string {
  const payload = stableStringify({
    session_id: sessionId,
    answers,
    quote_version: 'v1',
    schema_version: getEstimateSchema().version,
  });
  return createHash('sha256').update(payload).digest('hex');
}

function asEmailMessage(value: unknown): { message: string; success: boolean; deliveryMode?: 'customer' | 'internal' } | null {
  const payload = asRecord(value);
  if (!payload) {
    return null;
  }

  const message = asText(payload.message);
  if (!message) {
    return null;
  }

  const rawSuccess = payload.success;
  const success = typeof rawSuccess === 'boolean' ? rawSuccess : true;
  const deliveryMode = asText(payload.deliveryMode);
  return {
    message,
    success,
    ...(deliveryMode === 'customer' || deliveryMode === 'internal' ? { deliveryMode } : {}),
  };
}

export async function finalizeEstimateSession(
  sessionId: string,
  options: { sendEmail?: boolean; quoteHash?: string } = {}
): Promise<FinalizeEstimateResult> {
  const sendEmail = options.sendEmail !== false;
  const requestHash = options.quoteHash?.trim();

  const session = await getSession(sessionId);
  const cleanedAnswers = stripInternalAnswerKeys(session.answers) as Record<string, unknown>;
  const quoteHash = requestHash ?? hashQuoteInputs(sessionId, cleanedAnswers);
  const errors = validateRequiredAnswers(cleanedAnswers as unknown as Record<string, unknown>);

  if (errors.length > 0) {
    return {
      ok: false,
      session_id: sessionId,
      quote_hash: quoteHash,
      quote: null,
      record_id: null,
      quote_number: null,
      email: { message: `Cannot finalize yet: missing required fields: ${errors.join('; ')}`, success: false },
      already_finalized: false,
      message: 'Cannot finalize yet.',
    };
  }

  const serviceType = asText(cleanedAnswers.serviceType);
  if (!serviceType) {
    return {
      ok: false,
      session_id: sessionId,
      quote_hash: quoteHash,
      quote: null,
      record_id: null,
      quote_number: null,
      email: { message: 'Missing serviceType in finalized answers.', success: false },
      already_finalized: false,
      message: 'Missing service type.',
    };
  }

  let computedQuote: QuoteOutput;
  try {
    computedQuote = await computeDeterministicQuote(cleanedAnswers);
  } catch (error) {
    return {
      ok: false,
      session_id: sessionId,
      quote_hash: quoteHash,
      quote: null,
      record_id: null,
      quote_number: null,
      email: {
        message: error instanceof Error ? error.message : 'Unable to compute estimate quote.',
        success: false,
      },
      already_finalized: false,
      message: 'Unable to compute estimate quote.',
    };
  }

  if (session.finalized_quote_hash && session.finalized_quote_hash === quoteHash) {
    return {
      ok: true,
      session_id: sessionId,
      quote_hash: quoteHash,
      quote: computedQuote,
      record_id: session.finalized_record_id,
      quote_number: null,
      email: { message: 'Estimate already finalized for this answer set.', success: true },
      already_finalized: true,
      message: 'Estimate already finalized for this answer set.',
    };
  }

  const idempotencyKey = `postagent:${sessionId}:${quoteHash}`;

  const estimateCreateResponse = makeMockResponse();
  await estimateCreateHandler(
    {
      method: 'POST',
      body: {
        serviceType,
        answers: cleanedAnswers,
        strict: true,
        source: 'chat',
        idempotency_key: idempotencyKey,
        idempotencyKey,
        send_email: sendEmail,
      },
    },
    estimateCreateResponse
  );

  if (estimateCreateResponse.statusCode >= 400) {
    const payload = asRecord(estimateCreateResponse.payload);
    const message = asText(payload?.message) || 'Unable to finalize estimate.';
    const details = asRecord(payload?.errors);
    return {
      ok: false,
      session_id: sessionId,
      quote_hash: quoteHash,
      quote: null,
      record_id: null,
      quote_number: null,
      email: { message, success: false },
      already_finalized: false,
      message: details ? JSON.stringify(details) : message,
    };
  }

  const payload = asRecord(estimateCreateResponse.payload);
  const record = asRecord(payload?.record);
  const recordId = asText(record?.id);
  const quoteNumber = asText((record as Record<string, unknown> | null)?.quoteNumber);

  await saveSession({
    ...session,
    finalized_record_id: recordId || null,
    finalized_quote_hash: quoteHash,
    finalized_at: new Date().toISOString(),
  });

  return {
    ok: true,
    session_id: sessionId,
    quote_hash: quoteHash,
    quote: computedQuote,
    record_id: recordId || null,
    quote_number: quoteNumber || null,
    email: asEmailMessage(payload?.email) ?? { message: 'Estimate finalized successfully.', success: true },
    already_finalized: false,
  };
}
