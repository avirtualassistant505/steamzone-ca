import { saveActivePricingConfig } from '../server/pricingStore';
import type { ApiRequest, ApiResponse } from '../server/apiTypes';

function getBearerToken(req: ApiRequest): string | null {
  const raw = req.headers?.authorization ?? req.headers?.Authorization ?? '';
  const header = typeof raw === 'string' ? raw : '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  const expected = process.env.ADMIN_PRICING_TOKEN;
  const provided =
    getBearerToken(req) ??
    (typeof req.headers?.['x-admin-pricing-token'] === 'string' ? req.headers?.['x-admin-pricing-token'].trim() : null);

  if (!expected) {
    res.status(500).json({ message: 'ADMIN_PRICING_TOKEN is not configured on the server.' });
    return;
  }

  if (!provided || provided !== expected) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const config = body?.config;
  if (!config) {
    res.status(400).json({ message: 'Missing pricing config.' });
    return;
  }

  try {
    const saved = await saveActivePricingConfig(config);
    res.status(200).json({ config: saved });
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : 'Unable to save pricing config.' });
  }
}
