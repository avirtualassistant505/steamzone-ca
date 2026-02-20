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
    const createClient =
      typeof mod.createClient === 'function'
        ? mod.createClient
        : typeof (mod as { default?: { createClient?: unknown } }).default?.createClient === 'function'
          ? (mod as { default: { createClient: typeof mod.createClient } }).default.createClient
          : null;

    if (!createClient || typeof createClient !== 'function') {
      throw new Error('Unable to initialize Supabase client from @supabase/supabase-js module shape.');
    }

    cached = createClient(url, key, {
      auth: { persistSession: false },
    });
    return cached;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}
