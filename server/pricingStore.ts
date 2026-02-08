import type { PricingConfig } from '../shared/estimateEngine';
import { createDefaultPricingConfig } from '../shared/estimateEngine';
import { getSupabaseAdminClient } from './supabaseAdmin';

type PricingSource = 'supabase' | 'defaults' | 'env_missing';

export interface LoadedPricingConfig {
  config: PricingConfig;
  source: PricingSource;
}

export async function loadActivePricingConfig(): Promise<LoadedPricingConfig> {
  const defaults = createDefaultPricingConfig();
  const supabase = await getSupabaseAdminClient();
  if (!supabase) {
    return { config: defaults, source: 'env_missing' };
  }

  const { data, error } = await supabase
    .from('pricing_config')
    .select('config, updated_at')
    .eq('id', 'active')
    .maybeSingle();

  if (error || !data?.config) {
    return { config: defaults, source: 'defaults' };
  }

  const config = data.config as PricingConfig;
  // Trust the stored config, but always refresh updatedAt from the DB timestamp if present.
  if (data.updated_at) {
    config.updatedAt = new Date(data.updated_at).toISOString();
  }

  return { config, source: 'supabase' };
}

export async function saveActivePricingConfig(next: PricingConfig): Promise<PricingConfig> {
  const supabase = await getSupabaseAdminClient();
  if (!supabase) {
    throw new Error('Supabase admin credentials are missing.');
  }

  const saved: PricingConfig = {
    ...next,
    updatedAt: new Date().toISOString(),
  };

  const { error } = await supabase.from('pricing_config').upsert(
    {
      id: 'active',
      config: saved,
      version: saved.version,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );

  if (error) {
    throw new Error(error.message);
  }

  return saved;
}
