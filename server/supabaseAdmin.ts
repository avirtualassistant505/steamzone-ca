import type { SupabaseClient } from '@supabase/supabase-js';

type CreateClientFn = (url: string, key: string, options: { auth: { persistSession: boolean } }) => unknown;

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
    try {
      const mod = await import('@supabase/supabase-js');
      const createClientCandidate =
        typeof mod.createClient === 'function'
          ? mod.createClient
          : typeof mod.default === 'function'
            ? (mod.default as typeof mod.createClient)
            : typeof mod.default?.createClient === 'function'
              ? mod.default.createClient
              : undefined;
      const createClient =
        createClientCandidate ??
        (typeof (mod as { SupabaseClient?: new (...args: unknown[]) => unknown }).SupabaseClient === 'function'
          ? (...args: unknown[]) =>
              new (mod as { SupabaseClient: new (...args: unknown[]) => unknown }).SupabaseClient(
                ...(args as [string, string, object])
              )
          : undefined);

      if (!createClient || typeof createClient !== 'function') {
        return null;
      }

      const candidate = (createClient as CreateClientFn)(url, key, {
        auth: { persistSession: false },
      });
      if (!candidate) {
        return null;
      }

      cached = candidate as SupabaseClient;
      return cached;
    } catch {
      return null;
    }
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}
