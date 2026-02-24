import type { SupabaseClient } from '@supabase/supabase-js';

type CreateClientFn = (url: string, key: string, options: { auth: { persistSession: boolean } }) => unknown;
type DefaultSupabaseModule = {
  default?: {
    createClient?: CreateClientFn;
  };
  createClient?: CreateClientFn;
  SupabaseClient?: new (...args: unknown[]) => unknown;
};

function getSupabaseCreateClient(candidate: unknown): CreateClientFn | null {
  const mod = candidate as DefaultSupabaseModule;

  const defaultExport = mod.default;
  if (typeof mod.createClient === 'function') {
    return mod.createClient;
  }

  if (defaultExport && typeof defaultExport.createClient === 'function') {
    return defaultExport.createClient;
  }

  if (typeof mod.default === 'function') {
    const defaultFn = mod.default as unknown;
    return defaultFn as CreateClientFn;
  }

  if (typeof mod.SupabaseClient === 'function') {
    const { SupabaseClient } = mod;
    return (url: string, key: string, options: { auth: { persistSession: boolean } }) =>
      new (SupabaseClient as { new (url: string, key: string, options: { auth: { persistSession: boolean } }): unknown })(
      url,
      key,
      options
    );
  }

  return null;
}

export async function createSupabaseAdminClient(url: string, key: string): Promise<SupabaseClient | null> {
  try {
    const mod = await import('@supabase/supabase-js');
    const createClient = getSupabaseCreateClient(mod);
    if (!createClient) {
      return null;
    }

    const client = createClient(url, key, { auth: { persistSession: false } });
    return client as SupabaseClient;
  } catch {
    return null;
  }
}

let cached: SupabaseClient | null = null;
let inflight: Promise<SupabaseClient | null> | null = null;

export async function getSupabaseAdminClient(): Promise<SupabaseClient | null> {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
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
      const createClient = getSupabaseCreateClient(mod);

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
