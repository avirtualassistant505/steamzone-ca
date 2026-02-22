type ApiRequest = { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> };
type ApiResponse = { status: (code: number) => ApiResponse; json: (body: unknown) => void };

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed' });
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

    const versionFromConfig =
      typeof (config as Record<string, unknown>).version === 'number'
        ? (config as Record<string, number>).version
        : 2;

    const saved = {
      ...(typeof config === 'object' && config ? (config as Record<string, unknown>) : {}),
      updatedAt: new Date().toISOString(),
    };

    const { error } = await supabase.from('pricing_config').upsert(
      {
        id: 'active',
        config: saved,
        version: versionFromConfig,
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
