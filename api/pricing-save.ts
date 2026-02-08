type ApiRequest = { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> };
type ApiResponse = { status: (code: number) => ApiResponse; json: (body: unknown) => void };

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
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      res.status(500).json({ message: 'Supabase is not configured on the server yet.' });
      return;
    }

    const supa = await import('@supabase/supabase-js');
    const supabase = supa.createClient(url, key, { auth: { persistSession: false } });

    const saved = {
      ...(typeof config === 'object' && config ? (config as Record<string, unknown>) : {}),
      updatedAt: new Date().toISOString(),
    };

    const { error } = await supabase.from('pricing_config').upsert(
      {
        id: 'active',
        config: saved,
        version: typeof (saved as { version?: unknown }).version === 'number' ? (saved as { version: number }).version : 2,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );

    if (error) {
      res.status(500).json({ message: error.message });
      return;
    }

    res.status(200).json({ config: saved });
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : 'Unable to save pricing config.' });
  }
}
