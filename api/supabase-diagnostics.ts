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
  errorCategory?: 'missing_env' | 'missing_table' | 'cloudflare_error' | 'network_error' | 'html_error' | 'other';
  errorCode?: number;
  remediationHint?: string;
  projectHealthUrl?: string;
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
  ) || (
    text.includes('could not find the table') &&
    text.includes('schema cache')
  );
}

function buildErrorMessage(message: string): string {
  if (!message) {
    return 'Unknown Supabase error.';
  }
  return message.length > 240 ? `${message.substring(0, 240)}...` : message;
}

function safeStripHtml(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractCloudflareStatus(message: string): number | null {
  const statusTag = message.match(/<title>.*?\((\d{3})\)/i);
  if (statusTag && statusTag[1]) {
    const parsed = Number.parseInt(statusTag[1], 10);
    return Number.isNaN(parsed) ? null : parsed;
  }

  const statusCode = message.match(/\b(5\d{2})\b/);
  return statusCode ? Number.parseInt(statusCode[1], 10) : null;
}

function classifyError(message: string): {
  errorCategory: 'missing_env' | 'missing_table' | 'cloudflare_error' | 'network_error' | 'html_error' | 'other';
  errorCode?: number;
  remediationHint?: string;
  projectHealthUrl?: string;
} {
  const lower = message.toLowerCase();
  const containsHtml = message.includes('<!DOCTYPE html') || message.includes('<html');
  const cloudflareStatus = extractCloudflareStatus(message);
  const projectRef = extractProjectRef(process.env.SUPABASE_URL || '');
  const projectHealthUrl = projectRef ? `https://supabase.com/dashboard/project/${projectRef}` : undefined;

  if (containsHtml && lower.includes('web server is down')) {
    return {
      errorCategory: 'cloudflare_error',
      errorCode: cloudflareStatus ?? undefined,
      remediationHint:
        'Supabase project is returning a Cloudflare page (often paused or unavailable). Check project status in the Supabase dashboard and resume if needed.',
      projectHealthUrl,
    };
  }

  if (containsHtml && lower.includes('error')) {
    return {
      errorCategory: 'html_error',
      errorCode: cloudflareStatus ?? undefined,
      remediationHint:
        'The response is HTML instead of JSON. Verify project URL/key and open the dashboard health check for the project.',
      projectHealthUrl,
    };
  }

  if (isMissingTableError(lower)) {
    return {
      errorCategory: 'missing_table',
      remediationHint:
        'Create the estimate_sessions table (or run your migration SQL). `api/transcripts-get` will fallback to memory if missing.',
    };
  }

  if (
    lower.includes('enotfound') ||
    lower.includes('fetch failed') ||
    lower.includes('failed to fetch') ||
    lower.includes('network') ||
    lower.includes('econn')
  ) {
    return {
      errorCategory: 'network_error',
      remediationHint:
        'Network connectivity issue to Supabase. Verify the SUPABASE_URL and that your Vercel network policy allows outbound access.',
    };
  }

  return {
    errorCategory: 'other',
  };
}

function normalizeSampleError(message: string): string {
  const short = buildErrorMessage(message);
  const isHtml = short.includes('<!DOCTYPE html') || short.includes('<html');
  if (!isHtml) {
    return short;
  }

  const stripped = safeStripHtml(short);
  if (!stripped) {
    return short;
  }

  return stripped.includes('Web server is down') ? `${stripped}` : short;
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
      const classification = classifyError(error.message);
      const sampleError = normalizeSampleError(error.message);

      if (isMissingTableError(error.message)) {
        res.status(200).json({
          ok: false,
          message:
            'Supabase is reachable, but table `estimate_sessions` is missing. Create the table or use migration SQL.',
          errorCategory: classification.errorCategory,
          errorCode: classification.errorCode,
          remediationHint: classification.remediationHint,
          projectHealthUrl: classification.projectHealthUrl,
          config,
          probe: {
            reachable: true,
            estimateSessionsTableExists: false,
            sampleError,
          },
        } as Diagnostics);
        return;
      }

      res.status(200).json({
        ok: false,
        message: buildErrorMessage(error.message).includes('query failed')
          ? 'Supabase connection established but query failed.'
          : buildErrorMessage(error.message),
        errorCategory: classification.errorCategory,
        errorCode: classification.errorCode,
        remediationHint: classification.remediationHint,
        projectHealthUrl: classification.projectHealthUrl,
        config,
        probe: {
          reachable: true,
          estimateSessionsTableExists: false,
          sampleError,
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
    const rawError = error instanceof Error ? error.message : 'Failed to run Supabase diagnostics.';
    const classification = classifyError(rawError);

    res.status(200).json({
      ok: false,
      message: rawError,
      errorCategory: classification.errorCategory,
      errorCode: classification.errorCode,
      remediationHint: classification.remediationHint,
      projectHealthUrl: classification.projectHealthUrl,
      config,
      probe: {
        reachable: false,
        sampleError: normalizeSampleError(rawError),
      },
    } as Diagnostics);
  }
}
