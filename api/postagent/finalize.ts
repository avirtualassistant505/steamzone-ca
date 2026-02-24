import { createHash } from 'node:crypto';
import estimateCreateHandler from '../estimate-create.js';
import { getSession, saveSession } from '../../server/estimateAgentSessionStore.js';
import { computeDeterministicQuote, type QuoteOutput } from '../../src/quote/quoteEngine.js';
import { validateRequiredAnswers } from '../../src/quote/normalization.js';
import { getEstimateSchema } from '../../src/quote/schema.js';

type ApiRequest = { method?: string; body?: unknown };
type ApiResponse = { status: (code: number) => ApiResponse; json: (body: unknown) => void };

type FinalizeRequestBody = {
  session_id?: unknown;
  send_email?: unknown;
};

type MockResponse = {
  statusCode: number;
  payload: unknown;
  status: (code: number) => MockResponse;
  json: (body: unknown) => void;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asBool(value: unknown, fallback = true): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseBody(body: unknown): FinalizeRequestBody | null {
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return asRecord(parsed) as FinalizeRequestBody | null;
    } catch {
      return null;
    }
  }

  if (asRecord(body)) {
    return body as FinalizeRequestBody;
  }

  return null;
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

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
  const serialized = entries.map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`);
  return `{${serialized.join(',')}}`;
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

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed.' });
    return;
  }

  const parsedBody = parseBody(req.body);
  if (!parsedBody) {
    res.status(400).json({ message: 'Invalid JSON body.' });
    return;
  }

  const sessionId = asText(parsedBody.session_id);
  if (!sessionId) {
    res.status(400).json({ message: 'session_id is required.' });
    return;
  }

  const sendEmail = asBool(parsedBody.send_email, true);
  const requestQuoteHash = asText((parsedBody as { quote_hash?: unknown }).quote_hash);

  try {
    const session = await getSession(sessionId);
    const currentHash = requestQuoteHash || hashQuoteInputs(sessionId, stripInternalAnswerKeys(session.answers) as Record<string, unknown>);
    if (session.finalized_quote_hash && session.finalized_quote_hash === currentHash) {
      res.status(200).json({
        ok: true,
        session_id: sessionId,
        quote_hash: session.finalized_quote_hash,
        record_id: session.finalized_record_id,
        message: 'Estimate already finalized for this session state.',
        already_finalized: true,
      });
      return;
    }

    const cleanedAnswers = stripInternalAnswerKeys(session.answers) as Record<string, unknown>;
    const errors = validateRequiredAnswers(cleanedAnswers);
    if (errors.length > 0) {
      res.status(400).json({
        message: 'Cannot finalize yet: required estimate answers are missing.',
        missing_fields: errors,
      });
      return;
    }

    const quote = await computeDeterministicQuote(cleanedAnswers);
    const quoteHash = hashQuoteInputs(sessionId, cleanedAnswers);
    if (session.finalized_quote_hash && session.finalized_quote_hash === quoteHash) {
      res.status(200).json({
        ok: true,
        session_id: sessionId,
        quote,
        quote_hash: session.finalized_quote_hash,
        record_id: session.finalized_record_id,
        message: 'Estimate already finalized for this answer set.',
        already_finalized: true,
      });
      return;
    }

    if (session.finalized_quote_hash && !session.finalized_record_id && session.finalized_at) {
      // Legacy partial finalize marker; continue with idempotent path by recomputing and reusing prior result.
      const priorRecordId = String(session.finalized_record_id ?? '').trim();
      if (priorRecordId) {
        res.status(200).json({
          ok: true,
          session_id: sessionId,
          quote,
          quote_hash: session.finalized_quote_hash,
          record_id: priorRecordId,
          message: 'Estimate already finalized for this answer set.',
          already_finalized: true,
        });
        return;
      }
    }
    const idempotencyKey = `postagent:${sessionId}:${quoteHash}`;
    const serviceType = asText(cleanedAnswers.serviceType);
    if (!serviceType) {
      res.status(400).json({ message: 'Missing serviceType in finalized answers.' });
      return;
    }

    const estimateCreateResponse = makeMockResponse();
    await estimateCreateHandler(
      {
        method: 'POST',
        body: {
          serviceType,
          answers: cleanedAnswers,
          strict: true,
          idempotency_key: idempotencyKey,
          idempotencyKey,
          send_email: sendEmail,
        },
      },
      estimateCreateResponse
    );

    if (estimateCreateResponse.statusCode >= 400) {
      const payload = asRecord(estimateCreateResponse.payload);
      res.status(estimateCreateResponse.statusCode).json({
        message: asText(payload?.message) || 'Unable to finalize estimate.',
        details: payload,
      });
      return;
    }

    const payload = asRecord(estimateCreateResponse.payload);
    const record = asRecord(payload?.record);
    const email = asRecord(payload?.email);
    const recordId = asText(record?.id);
    const quoteNumber = asText(record?.quoteNumber);

    const finalizedAt = new Date().toISOString();
    await saveSession({
      ...session,
      finalized_record_id: recordId || null,
      finalized_quote_hash: quoteHash,
      finalized_at: finalizedAt,
    });

    res.status(200).json({
      ok: true,
      session_id: sessionId,
      quote_hash: quoteHash,
      record_id: recordId || null,
      quote_number: quoteNumber || null,
      quote: quote as QuoteOutput,
      email: email ?? null,
      idempotency_key: idempotencyKey,
    });
  } catch (error) {
    res.status(500).json({
      message: error instanceof Error ? error.message : 'Failed to finalize estimate.',
    });
  }
}
