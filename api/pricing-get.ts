import { getSupabaseAdminClient } from '../server/supabaseAdmin.js';
type ApiRequest = { method?: string };
type ApiResponse = { status: (code: number) => ApiResponse; json: (body: unknown) => void };

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  try {
    const engine = await import('../server/estimateEngineRuntime.mjs');
    const defaults = engine.createDefaultPricingConfig();
    const supabase = await getSupabaseAdminClient();
    if (!supabase) {
      res.status(200).json({ config: defaults, source: 'env_missing' });
      return;
    }

    const { data, error } = await supabase
      .from('pricing_config')
      .select('config, updated_at')
      .eq('id', 'active')
      .maybeSingle();

    if (error || !data?.config) {
      res.status(200).json({ config: defaults, source: 'defaults' });
      return;
    }

    const config = data.config;
    if (data.updated_at && typeof config === 'object' && config) {
      (config as { updatedAt?: string }).updatedAt = new Date(data.updated_at).toISOString();
    }

    res.status(200).json({ config, source: 'supabase' });
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : 'Unable to load pricing config.' });
  }
}
