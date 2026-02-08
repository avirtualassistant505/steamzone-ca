import type { SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;
let inflight: Promise<SupabaseClient | null> | null = null;

export async function getSupabaseAdminClient(): Promise<SupabaseClient | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return null;
  }

  if (cached) {
    return cached;
  }

  if (inflight) {
    return inflight;
  }

  inflight = (async () => {
    const mod = await import('@supabase/supabase-js');
    cached = mod.createClient(url, key, {
      auth: { persistSession: false },
    });
    return cached;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}
