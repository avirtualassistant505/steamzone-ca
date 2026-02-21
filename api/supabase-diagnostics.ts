type ApiRequest = {
  method?: string;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
};

type EnvPresence = {
  hasUrl: boolean;
  hasServiceRoleKey: boolean;
  urlHost: string | null;
  projectRef: string | null;
  keyHint: string | null;
};

type Diagnostics = {
  ok: boolean;
  message: string;
  config: EnvPresence;
  probe: {
    reachable: boolean;
    estimateSessionsTableExists?: boolean;
    sampleError?: string;
  };
};

function envTrim(name: string): string {
  const raw = process.env[name];
  return typeof raw === 'string' ? raw.trim() : '';
}

function extractProjectRef(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    if (!host.endsWith('.supabase.co')) return null;
    return host.split('.').shift() || null;
  } catch {
    return null;
  }
}

function keyHint(rawKey: string): string | null {
  if (!rawKey) return null;
  const trimmed = rawKey.trim();
  if (trimmed.length <= 8) return `${trimmed.slice(0, 2)}...`;
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

function isMissingTableError(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes('relation') &&
    (text.includes('does not exist') || text.includes('was not found'))
  );
}

function buildErrorMessage(message: string): string {
  if (!message) {
    return 'Unknown Supabase error.';
  }

  return message;
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ message: 'Method not allowed.' });
    return;
  }

  const rawUrl = envTrim('SUPABASE_URL');
  const rawKey = envTrim('SUPABASE_SERVICE_ROLE_KEY');

  const config: EnvPresence = {
    hasUrl: Boolean(rawUrl),
    hasServiceRoleKey: Boolean(rawKey),
    urlHost: null,
    projectRef: null,
    keyHint: keyHint(rawKey),
  };

  if (!config.hasUrl || !config.hasServiceRoleKey) {
    res.status(200).json({
      ok: false,
      message: 'Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY in Vercel environment.',
      config,
      probe: { reachable: false },
    } as Diagnostics);
    return;
  }

  try {
    const parsedUrl = new URL(rawUrl);
    config.urlHost = parsedUrl.hostname;
    config.projectRef = extractProjectRef(rawUrl);

    const { createClient } = await import('@supabase/supabase-js');
    const client = createClient(rawUrl, rawKey, { auth: { persistSession: false } });

    const { data, error } = await client
      .from('estimate_sessions')
      .select('session_id')
      .limit(1);

    if (error) {
      if (isMissingTableError(error.message)) {
        res.status(200).json({
          ok: false,
          message:
            'Supabase is reachable, but table `estimate_sessions` is missing. Create the table or use migration SQL.',
          config,
          probe: {
            reachable: true,
            estimateSessionsTableExists: false,
            sampleError: buildErrorMessage(error.message),
          },
        } as Diagnostics);
        return;
      }

      res.status(200).json({
        ok: false,
        message: 'Supabase connection established but query failed.',
        config,
        probe: {
          reachable: true,
          estimateSessionsTableExists: false,
          sampleError: buildErrorMessage(error.message),
        },
      } as Diagnostics);
      return;
    }

    res.status(200).json({
      ok: true,
      message:
        'Supabase env vars are present and the estimate_sessions table is reachable.',
      config,
      probe: {
        reachable: true,
        estimateSessionsTableExists: true,
        sampleError: data ? undefined : undefined,
      },
    } as Diagnostics);
    return;
  } catch (error) {
    res.status(200).json({
      ok: false,
      message: error instanceof Error ? error.message : 'Failed to run Supabase diagnostics.',
      config,
      probe: { reachable: false, sampleError: error instanceof Error ? error.message : 'Unknown error.' },
    } as Diagnostics);
  }
}
