type ApiRequest = { method?: string };
type ApiResponse = { status: (code: number) => ApiResponse; json: (body: unknown) => void };

const ghlBaseUrlDefault = 'https://services.leadconnectorhq.com';
const ghlApiVersionDefault = '2021-07-28';

function env(name: string): string | null {
  const raw = process.env[name];
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed ? trimmed : null;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function extractLocationName(payload: unknown): string | null {
  const p = asRecord(payload);
  if (!p) return null;
  const location = asRecord(p['location']);
  const fromLocation = location && typeof location['name'] === 'string' ? (location['name'] as string) : null;
  const fromRoot = typeof p['name'] === 'string' ? (p['name'] as string) : null;
  const data = asRecord(p['data']);
  const fromData = data && typeof data['name'] === 'string' ? (data['name'] as string) : null;
  return fromLocation ?? fromRoot ?? fromData ?? null;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, message: 'Method not allowed' });
    return;
  }

  const token = env('GHL_PRIVATE_INTEGRATION_TOKEN') ?? env('GHL_ACCESS_TOKEN');
  const locationId = env('GHL_LOCATION_ID');
  const expectedLocationName = env('GHL_EXPECT_LOCATION_NAME');
  const inboundWebhookUrl = env('GHL_INBOUND_WEBHOOK_URL');
  const baseUrl = (env('GHL_BASE_URL') ?? ghlBaseUrlDefault).replace(/\/+$/, '');
  const version = env('GHL_API_VERSION') ?? ghlApiVersionDefault;

  const hasToken = Boolean(token);
  const hasLocationId = Boolean(locationId);

  // If API creds are not set, return a safe diagnostic (no secrets).
  if (!hasToken || !hasLocationId) {
    res.status(200).json({
      ok: true,
      mode: inboundWebhookUrl ? 'webhook' : 'none',
      hasToken,
      hasLocationId,
      expectedLocationName: expectedLocationName ?? null,
      locationId: locationId ?? null,
      baseUrl,
      version,
    });
    return;
  }

  try {
    const url = new URL(`${baseUrl}/locations/${locationId}`);
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        Version: version,
      },
    });

    const contentType = response.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    const payload = isJson ? await response.json().catch(() => null) : await response.text().catch(() => '');

    const actualLocationName = extractLocationName(payload);
    const nameMatches =
      expectedLocationName && actualLocationName
        ? normalizeKey(expectedLocationName) === normalizeKey(actualLocationName)
        : null;

    res.status(200).json({
      ok: true,
      mode: 'api',
      hasToken,
      hasLocationId,
      expectedLocationName: expectedLocationName ?? null,
      actualLocationName,
      expectedNameMatches: nameMatches,
      locationId,
      baseUrl,
      version,
      ghl: {
        status: response.status,
        ok: response.ok,
      },
    });
  } catch (error) {
    res.status(200).json({
      ok: true,
      mode: 'api',
      hasToken,
      hasLocationId,
      expectedLocationName: expectedLocationName ?? null,
      locationId,
      baseUrl,
      version,
      ghl: {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
}

