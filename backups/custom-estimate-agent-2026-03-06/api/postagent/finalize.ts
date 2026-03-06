import { finalizeEstimateSession } from '../../server/estimateFinalize.js';

type ApiRequest = { method?: string; body?: unknown };
type ApiResponse = { status: (code: number) => ApiResponse; json: (body: unknown) => void };

type FinalizeRequestBody = {
  session_id?: unknown;
  send_email?: unknown;
  quote_hash?: unknown;
};

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
      return typeof parsed === 'object' && parsed && !Array.isArray(parsed) ? (parsed as FinalizeRequestBody) : null;
    } catch {
      return null;
    }
  }
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return body as FinalizeRequestBody;
  }
  return null;
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed.' });
    return;
  }

  const payload = parseBody(req.body);
  if (!payload) {
    res.status(400).json({ message: 'Invalid JSON body.' });
    return;
  }

  const sessionId = asText(payload.session_id);
  if (!sessionId) {
    res.status(400).json({ message: 'session_id is required.' });
    return;
  }

  const sendEmail = asBool(payload.send_email, true);
  const quoteHash = asText(payload.quote_hash);

  try {
    const result = await finalizeEstimateSession(sessionId, {
      sendEmail,
      quoteHash: quoteHash || undefined,
    });

    if (!result.ok) {
      res.status(result.message?.startsWith('Cannot finalize yet') ? 400 : 500).json({
        message: result.message ?? 'Unable to finalize estimate.',
        quote_hash: result.quote_hash,
        session_id: result.session_id,
        quote_number: result.quote_number,
        quote: result.quote,
        already_finalized: false,
      });
      return;
    }

    res.status(200).json({
      ok: true,
      already_finalized: result.already_finalized,
      session_id: result.session_id,
      quote_hash: result.quote_hash,
      quote: result.quote,
      record_id: result.record_id,
      quote_number: result.quote_number,
      email: result.email,
      message: result.already_finalized
        ? 'Estimate already finalized for this answer set.'
        : 'Estimate finalized.',
    });
  } catch (error) {
    res.status(500).json({
      message: error instanceof Error ? error.message : 'Failed to finalize estimate.',
    });
  }
}
