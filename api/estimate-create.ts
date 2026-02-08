import { Resend } from 'resend';
import type { EstimateRecord, LeadContact, PricingConfig, ServiceType, WindowZone } from '../src/lib/estimateEngine';

type ApiRequest = { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> };
type ApiResponse = { status: (code: number) => ApiResponse; json: (body: unknown) => void };

const postalCodeRegex = /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/;
const idempotencyKeyRegex = /^[A-Za-z0-9._:-]{8,200}$/;
const ghlBaseUrlDefault = 'https://services.leadconnectorhq.com';
const ghlApiVersionDefault = '2021-07-28';

type EngineModule = {
  createDefaultPricingConfig: () => PricingConfig;
  calculateEstimate: (serviceType: ServiceType, input: unknown, config: PricingConfig) => EstimateRecord['result'];
  detectZoneFromPostalCode: (postalCode: string) => WindowZone;
  formatCurrency: (value: number) => string;
  formatServiceLabel: (serviceType: ServiceType) => string;
  formatZoneLabel: (zone: WindowZone) => string;
};

type MailerModule = {
  renderEmailTemplate: (input: unknown) => string;
  buildQuotePdf: (input: unknown) => Promise<Uint8Array>;
};

let enginePromise: Promise<EngineModule> | null = null;
let mailerPromise: Promise<MailerModule> | null = null;

async function getEngine(): Promise<EngineModule> {
  if (!enginePromise) {
    enginePromise = import('../server/estimateEngineRuntime.mjs').then((mod) => mod as unknown as EngineModule);
  }
  return enginePromise;
}

async function getMailer(): Promise<MailerModule> {
  if (!mailerPromise) {
    mailerPromise = import('../server/sendEstimateRuntime.mjs').then((mod) => mod as unknown as MailerModule);
  }
  return mailerPromise;
}

function safeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function env(name: string): string | null {
  const raw = process.env[name];
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed ? trimmed : null;
}

function finiteNumber(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function headerValue(req: ApiRequest, name: string): string | null {
  const headers = req.headers ?? {};
  const lower = name.toLowerCase();
  const exact = headers[name];
  const value = exact ?? headers[lower];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return typeof value === 'string' ? value : null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function generateQuoteNumber(): string {
  const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `SZ-${stamp}-${suffix}`;
}

function validatePostalCode(postalCode: string): string | null {
  const trimmed = postalCode.trim();
  if (!trimmed) return 'Postal code is required.';
  if (!postalCodeRegex.test(trimmed)) return 'Enter a valid Canadian postal code (example: R5G 2X3).';
  return null;
}

function validateContact(contact: LeadContact): string | null {
  if (!contact.fullName?.trim() || contact.fullName.trim().length < 2) return 'Full name is required.';
  if (!contact.phone?.replace(/\D/g, '') || contact.phone.replace(/\D/g, '').length < 7) return 'Phone number is required.';
  if (!contact.email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim())) return 'Valid email is required.';
  if (!contact.consentToContact) return 'Consent is required.';
  return null;
}

function coerceServiceType(value: unknown): ServiceType | null {
  return value === 'window' || value === 'commercialWindow' || value === 'carpet' || value === 'postConstruction'
    ? (value as ServiceType)
    : null;
}

function formatHoursRange(low: number, high: number): string {
  const a = Number.isFinite(low) ? low : 0;
  const b = Number.isFinite(high) ? high : 0;
  return `${a.toFixed(1)} - ${b.toFixed(1)} hours`;
}

async function loadPricingConfigForEstimate(): Promise<{ config: PricingConfig; source: string }> {
  const engine = await getEngine();
  const defaults = engine.createDefaultPricingConfig() as PricingConfig;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { config: defaults, source: 'env_missing' };
  }

  try {
    const supa = await import('@supabase/supabase-js');
    const supabase = supa.createClient(url, key, { auth: { persistSession: false } });

    const { data, error } = await supabase
      .from('pricing_config')
      .select('config, updated_at')
      .eq('id', 'active')
      .maybeSingle();

    if (error || !data?.config) {
      return { config: defaults, source: 'defaults' };
    }

    const config = data.config as PricingConfig;
    if (data.updated_at) {
      config.updatedAt = new Date(data.updated_at).toISOString();
    }

    return { config, source: 'supabase' };
  } catch {
    return { config: defaults, source: 'defaults_error' };
  }
}

async function storeEstimateRecord(record: EstimateRecord): Promise<{ stored: boolean; recordId?: string; error?: string }> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { stored: false, error: 'supabase_env_missing' };
  }

  try {
    const supa = await import('@supabase/supabase-js');
    const supabase = supa.createClient(url, key, { auth: { persistSession: false } });

    const { data, error } = await supabase
      .from('estimate_records')
      .insert({
        quote_number: record.quoteNumber,
        source: 'website',
        service_type: record.serviceType,
        postal_code: record.postalCode,
        zone: record.zone,
        contact: record.contact,
        answers: record.answers,
        result: record.result,
        pricing_version: record.pricingVersion,
        utm: record.utm,
      })
      .select('id')
      .single();

    if (error) {
      // Storage failure should not prevent the quote from being generated/sent.
      return { stored: false, error: error.message };
    }

    return { stored: true, recordId: (data as { id?: string } | null)?.id };
  } catch {
    return { stored: false, error: 'supabase_store_exception' };
  }
}

async function fetchEstimateRecordByIdempotencyKey(idempotencyKey: string): Promise<EstimateRecord | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return null;
  }

  try {
    const supa = await import('@supabase/supabase-js');
    const supabase = supa.createClient(url, key, { auth: { persistSession: false } });

    const { data, error } = await supabase
      .from('estimate_records')
      .select(
        'id, quote_number, created_at, service_type, postal_code, zone, contact, answers, result, pricing_version, utm'
      )
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (error || !data) {
      // If the column isn't present yet (migration not run), treat as not found.
      return null;
    }

    const row = data as unknown as {
      id: string;
      quote_number: string;
      created_at: string;
      service_type: ServiceType;
      postal_code: string;
      zone: WindowZone;
      contact: LeadContact;
      answers: unknown;
      result: EstimateRecord['result'];
      pricing_version: number;
      utm?: unknown;
    };

    return {
      id: row.id,
      quoteNumber: row.quote_number,
      createdAt: row.created_at,
      serviceType: row.service_type,
      postalCode: row.postal_code,
      zone: row.zone,
      contact: row.contact,
      answers: row.answers,
      result: row.result,
      pricingVersion: row.pricing_version,
      utm: (row.utm ?? {}) as EstimateRecord['utm'],
    };
  } catch {
    return null;
  }
}

async function storeEstimateRecordWithIdempotency(
  record: EstimateRecord,
  idempotencyKey: string | null
): Promise<{ stored: boolean; recordId?: string; existing?: EstimateRecord; error?: string }> {
  if (!idempotencyKey) {
    const stored = await storeEstimateRecord(record);
    return { stored: stored.stored, recordId: stored.recordId, error: stored.error };
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { stored: false, error: 'supabase_env_missing' };
  }

  try {
    const supa = await import('@supabase/supabase-js');
    const supabase = supa.createClient(url, key, { auth: { persistSession: false } });

    // First, check if this submission was already stored.
    const existing = await fetchEstimateRecordByIdempotencyKey(idempotencyKey);
    if (existing) {
      return { stored: true, recordId: existing.id, existing };
    }

    // Try inserting with idempotency_key. If the column isn't migrated yet, fall back to legacy insert.
    const insertPayload: Record<string, unknown> = {
      quote_number: record.quoteNumber,
      source: 'website',
      service_type: record.serviceType,
      postal_code: record.postalCode,
      zone: record.zone,
      contact: record.contact,
      answers: record.answers,
      result: record.result,
      pricing_version: record.pricingVersion,
      utm: record.utm,
      idempotency_key: idempotencyKey,
    };

    const { data, error } = await supabase.from('estimate_records').insert(insertPayload).select('id').single();

    if (!error && data) {
      return { stored: true, recordId: (data as { id?: string } | null)?.id };
    }

    const message = error?.message ?? '';
    const lowerMessage = message.toLowerCase();
    const idempotencyKeyMissing =
      lowerMessage.includes('idempotency_key') &&
      (lowerMessage.includes('does not exist') || lowerMessage.includes('schema cache') || lowerMessage.includes('could not find'));
    if (idempotencyKeyMissing) {
      const legacy = await storeEstimateRecord(record);
      return { stored: legacy.stored, recordId: legacy.recordId, error: legacy.error };
    }

    // Handle race: if another request inserted first, fetch the stored record and return it.
    const raced = await fetchEstimateRecordByIdempotencyKey(idempotencyKey);
    if (raced) {
      return { stored: true, recordId: raced.id, existing: raced };
    }

    return { stored: false, error: message || 'supabase_store_failed' };
  } catch {
    return { stored: false, error: 'supabase_store_exception' };
  }
}

type GhlResult = { posted: boolean; mode?: 'api' | 'webhook'; contactId?: string; opportunityId?: string; error?: string };

type GhlClient = {
  request: (path: string, options?: { method?: string; query?: Record<string, unknown>; body?: unknown }) => Promise<unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function makeGhlClientFromEnv(): { ok: true; ghl: GhlClient; locationId: string; expectedLocationName?: string } | { ok: false } {
  const token = env('GHL_PRIVATE_INTEGRATION_TOKEN') ?? env('GHL_ACCESS_TOKEN');
  const locationId = env('GHL_LOCATION_ID');
  if (!token || !locationId) {
    return { ok: false };
  }

  const baseUrl = (env('GHL_BASE_URL') ?? ghlBaseUrlDefault).replace(/\/+$/, '');
  const version = env('GHL_API_VERSION') ?? ghlApiVersionDefault;
  const expectedLocationName = env('GHL_EXPECT_LOCATION_NAME') ?? undefined;

  const request: GhlClient['request'] = async (path, options = {}) => {
    const url = new URL(baseUrl + (path.startsWith('/') ? path : `/${path}`));
    if (options.query) {
      for (const [k, v] of Object.entries(options.query)) {
        if (v === undefined || v === null || v === '') continue;
        url.searchParams.set(k, String(v));
      }
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      Version: version,
    };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    const contentType = res.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    const payload = isJson ? await res.json().catch(() => null) : await res.text().catch(() => '');

    if (!res.ok) {
      const detail = isJson ? JSON.stringify(payload) : String(payload);
      throw new Error(`GHL API error ${res.status} ${res.statusText} for ${options.method ?? 'GET'} ${url.toString()}\n${detail}`);
    }

    return payload;
  };

  return { ok: true, ghl: { request }, locationId, expectedLocationName };
}

let ghlCustomFieldIdCache: { locationId: string; map: Map<string, string>; fetchedAt: number } | null = null;

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

async function getGhlCustomFieldIdsByName(ghl: GhlClient, locationId: string): Promise<Map<string, string>> {
  const ttlMs = 15 * 60 * 1000;
  if (ghlCustomFieldIdCache && ghlCustomFieldIdCache.locationId === locationId && Date.now() - ghlCustomFieldIdCache.fetchedAt < ttlMs) {
    return ghlCustomFieldIdCache.map;
  }

  // Legacy endpoint that supports Contact custom fields.
  const payload = await ghl.request(`/locations/${locationId}/customFields`, { query: { model: 'contact' } });
  const payloadObj = asRecord(payload);
  const candidate =
    payloadObj?.['customFields'] ?? payloadObj?.['data'] ?? payloadObj?.['items'] ?? payloadObj?.['results'] ?? payload;
  const list = Array.isArray(candidate) ? candidate : [];
  const map = new Map<string, string>();
  for (const f of Array.isArray(list) ? list : []) {
    const rec = asRecord(f);
    const name = rec && typeof rec['name'] === 'string' ? (rec['name'] as string) : null;
    const id = rec && typeof rec['id'] === 'string' ? (rec['id'] as string) : null;
    if (!name || !id) continue;
    map.set(normalizeKey(String(name)), String(id));
  }

  ghlCustomFieldIdCache = { locationId, map, fetchedAt: Date.now() };
  return map;
}

async function syncToGhlViaApi(record: EstimateRecord): Promise<GhlResult> {
  const cfg = makeGhlClientFromEnv();
  if (!cfg.ok) {
    return { posted: false, mode: 'api', error: 'missing_env' };
  }

  const { ghl, locationId, expectedLocationName } = cfg;

  try {
    if (expectedLocationName) {
      const locPayload = await ghl.request(`/locations/${locationId}`);
      const actualName = extractLocationName(locPayload);
      if (!actualName || normalizeKey(actualName) !== normalizeKey(expectedLocationName)) {
        return { posted: false, mode: 'api', error: `location_mismatch:${actualName ?? 'UNKNOWN'}` };
      }
    }

    const engine = await getEngine();
    const contactName = record.contact.fullName?.trim() ?? '';
    const [firstName, ...rest] = contactName.split(/\s+/).filter(Boolean);
    const lastName = rest.length > 0 ? rest.join(' ') : undefined;

    const cfIds = await getGhlCustomFieldIdsByName(ghl, locationId);
    const customFields: Array<{ id: string; value: string }> = [];
    const setCF = (name: string, value: unknown) => {
      const id = cfIds.get(normalizeKey(name));
      if (!id) return;
      if (value === undefined || value === null || value === '') return;
      customFields.push({ id, value: String(value) });
    };

    const serviceLabel = engine.formatServiceLabel(record.serviceType);
    const zoneLabel = engine.formatZoneLabel(record.zone as WindowZone);

    setCF('service_type', serviceLabel);
    setCF('travel_zone', zoneLabel);
    setCF('quote_number', record.quoteNumber);
    setCF('estimate_low', record.result.estimateLow);
    setCF('estimate_high', record.result.estimateHigh);
    setCF('duration_low_hours', record.result.durationLowHours);
    setCF('duration_high_hours', record.result.durationHighHours);
    setCF('confidence', record.result.confidence);
    setCF('booking_mode', record.result.bookingMode);
    setCF('red_flags', (record.result.redFlags ?? []).join('\n'));
    setCF('estimate_notes', (record.result.notes ?? []).join('\n'));
    setCF('wizard_answers_json', JSON.stringify(record.answers ?? {}));

    const tags: string[] = [];
    tags.push('estimate_new');
    tags.push(record.result.confidence === 'green' ? 'estimate_green' : record.result.confidence === 'yellow' ? 'estimate_yellow' : 'estimate_red');
    tags.push(record.utm && Object.keys(record.utm).length > 0 ? 'source_ai_estimate' : 'source_website_estimate');

    const upsertPayload = await ghl.request('/contacts/upsert', {
      method: 'POST',
      body: {
        locationId,
        firstName: firstName || undefined,
        lastName,
        name: contactName || undefined,
        email: record.contact.email || undefined,
        phone: record.contact.phone || undefined,
        postalCode: record.postalCode || undefined,
        tags,
        customFields,
      },
    });

    const upsertObj = asRecord(upsertPayload);
    const contactObj = asRecord(upsertObj?.['contact']);
    const contactId = contactObj && typeof contactObj['id'] === 'string' ? (contactObj['id'] as string) : null;
    if (!contactId) {
      return { posted: false, mode: 'api', error: 'contact_upsert_failed' };
    }

    const pipelinesPayload = await ghl.request('/opportunities/pipelines', { query: { locationId } });
    const pipelinesObj = asRecord(pipelinesPayload);
    const rawPipelines = Array.isArray(pipelinesObj?.['pipelines']) ? (pipelinesObj?.['pipelines'] as unknown[]) : [];
    const pipelines = rawPipelines
      .map((item) => {
        const rec = asRecord(item);
        const id = rec && typeof rec['id'] === 'string' ? (rec['id'] as string) : null;
        const name = rec && typeof rec['name'] === 'string' ? (rec['name'] as string) : null;
        const rawStages = rec && Array.isArray(rec['stages']) ? (rec['stages'] as unknown[]) : [];
        const stages = rawStages
          .map((s) => {
            const srec = asRecord(s);
            const sid = srec && typeof srec['id'] === 'string' ? (srec['id'] as string) : null;
            const sname = srec && typeof srec['name'] === 'string' ? (srec['name'] as string) : null;
            return sid && sname ? { id: sid, name: sname } : null;
          })
          .filter((s): s is { id: string; name: string } => Boolean(s));
        return id && name ? { id, name, stages } : null;
      })
      .filter((p): p is { id: string; name: string; stages: Array<{ id: string; name: string }> } => Boolean(p));

    const pipelineNameWanted = env('GHL_PIPELINE_NAME') ?? 'Steam Zone – Jobs';
    const stageNameWanted = env('GHL_STAGE_NAME_DEFAULT') ?? 'New Lead';
    const pipeline =
      pipelines.find((p) => normalizeKey(p.name) === normalizeKey(pipelineNameWanted)) ??
      pipelines.find((p) => normalizeKey(p.name).includes('steam zone')) ??
      pipelines[0];
    const stages = pipeline?.stages ?? [];
    const stage = stages.find((s) => normalizeKey(s.name) === normalizeKey(stageNameWanted)) ?? stages[0];

    const pipelineId = pipeline?.id;
    const pipelineStageId = stage?.id;
    if (!pipelineId || !pipelineStageId) {
      return { posted: true, mode: 'api', contactId, error: 'pipeline_missing' };
    }

    const oppName = `Estimate ${record.quoteNumber}`;
    const existing = await ghl.request('/opportunities/search', {
      method: 'POST',
      body: { locationId, query: record.quoteNumber, limit: 5 },
    });
    const existingObj = asRecord(existing);
    const rawOpps = Array.isArray(existingObj?.['opportunities']) ? (existingObj?.['opportunities'] as unknown[]) : [];
    const existingOpp = rawOpps
      .map((o) => {
        const rec = asRecord(o);
        const id = rec && typeof rec['id'] === 'string' ? (rec['id'] as string) : null;
        const name = rec && typeof rec['name'] === 'string' ? (rec['name'] as string) : null;
        return id && name ? { id, name } : null;
      })
      .filter((o): o is { id: string; name: string } => Boolean(o))
      .find((o) => o.name.includes(record.quoteNumber));

    let opportunityId: string | undefined;
    if (existingOpp?.id) {
      opportunityId = String(existingOpp.id);
    } else {
      const created = await ghl.request('/opportunities/', {
        method: 'POST',
        body: {
          locationId,
          contactId,
          name: oppName,
          pipelineId,
          pipelineStageId,
          status: 'open',
          monetaryValue: Math.round((finiteNumber(record.result.estimateLow) + finiteNumber(record.result.estimateHigh)) / 2),
        },
      });
      const createdObj = asRecord(created);
      const createdOpp = asRecord(createdObj?.['opportunity']);
      const createdId = createdOpp && typeof createdOpp['id'] === 'string' ? (createdOpp['id'] as string) : null;
      if (createdId) {
        opportunityId = String(createdId);
      }
    }

    return { posted: true, mode: 'api', contactId: String(contactId), opportunityId };
  } catch (error) {
    return { posted: false, mode: 'api', error: error instanceof Error ? error.message : 'unknown_error' };
  }
}

async function postToGhlWebhook(record: EstimateRecord): Promise<GhlResult> {
  const url = process.env.GHL_INBOUND_WEBHOOK_URL?.trim();
  if (!url) {
    return { posted: false, mode: 'webhook', error: 'missing_env' };
  }

  const secret = process.env.GHL_WEBHOOK_SECRET?.trim();

  try {
    const engine = await getEngine();
    const contactName = record.contact.fullName?.trim() ?? '';
    const [firstName, ...rest] = contactName.split(/\s+/).filter(Boolean);
    const lastName = rest.length > 0 ? rest.join(' ') : undefined;
    const serviceLabel = engine.formatServiceLabel(record.serviceType);
    const zoneLabel = engine.formatZoneLabel(record.zone as WindowZone);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        secret: secret || undefined,
        source: record.utm?.source ?? record.utm?.utm_source ?? record.utm?.utmSource ?? 'website',
        event: 'estimate_received',
        locationId: process.env.GHL_LOCATION_ID ?? undefined,
        contact: {
          firstName: firstName || undefined,
          lastName,
          name: contactName || undefined,
          email: record.contact.email,
          phone: record.contact.phone,
          address: record.contact.address,
          postalCode: record.postalCode,
        },
        estimate: {
          quote_number: record.quoteNumber,
          created_at: record.createdAt,
          service_type: serviceLabel,
          service_type_key: record.serviceType,
          postal_code: record.postalCode,
          travel_zone: zoneLabel,
          travel_zone_key: record.zone,
          estimate_low: record.result.estimateLow,
          estimate_high: record.result.estimateHigh,
          duration_low_hours: record.result.durationLowHours,
          duration_high_hours: record.result.durationHighHours,
          confidence: record.result.confidence,
          booking_mode: record.result.bookingMode,
          red_flags: (record.result.redFlags ?? []).join('\n'),
          estimate_notes: (record.result.notes ?? []).join('\n'),
          wizard_answers_json: JSON.stringify(record.answers ?? {}),
        },
        utm: record.utm,
      }),
    });
    return { posted: response.ok, mode: 'webhook' };
  } catch {
    return { posted: false, mode: 'webhook' };
  }
}

async function syncToGhl(record: EstimateRecord): Promise<GhlResult> {
  const apiCfg = makeGhlClientFromEnv();
  if (apiCfg.ok) {
    return syncToGhlViaApi(record);
  }
  if (process.env.GHL_INBOUND_WEBHOOK_URL?.trim()) {
    return postToGhlWebhook(record);
  }
  return { posted: false };
}

function currentDeliveryMode(): 'customer' | 'internal' {
  const fromEmail = process.env.ESTIMATE_FROM_EMAIL;
  const usesResendOnboardingSender = fromEmail?.toLowerCase().includes('onboarding@resend.dev') ?? false;
  return usesResendOnboardingSender ? 'internal' : 'customer';
}

async function sendEstimateEmail(record: EstimateRecord): Promise<{ success: boolean; message: string; deliveryMode?: 'customer' | 'internal' }> {
  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.ESTIMATE_FROM_EMAIL;
  const internalInbox = process.env.ESTIMATE_TO_EMAIL?.trim();
  const usesResendOnboardingSender = fromEmail?.toLowerCase().includes('onboarding@resend.dev') ?? false;

  if (!resendApiKey || !fromEmail) {
    return {
      success: false,
      message: 'Email delivery is not configured yet. Add RESEND_API_KEY and ESTIMATE_FROM_EMAIL in Vercel environment variables.',
    };
  }

  if (usesResendOnboardingSender && !internalInbox) {
    return {
      success: false,
      message: 'Onboarding sender mode requires ESTIMATE_TO_EMAIL so leads can be delivered to your Steam Zone inbox.',
    };
  }

  try {
    const resend = new Resend(resendApiKey);

    const engine = await getEngine();
    const estimateRange = `${engine.formatCurrency(record.result.estimateLow)} - ${engine.formatCurrency(record.result.estimateHigh)}`;
    const durationRange = formatHoursRange(record.result.durationLowHours, record.result.durationHighHours);
    const service = engine.formatServiceLabel(record.serviceType);

    const to = usesResendOnboardingSender ? [internalInbox as string] : [record.contact.email];
    const bcc = !usesResendOnboardingSender && internalInbox ? [internalInbox] : undefined;
    const replyTo = usesResendOnboardingSender ? record.contact.email : undefined;
    const subject = usesResendOnboardingSender
      ? `New Steam Zone estimate lead ${record.quoteNumber}`.trim()
      : `Your Steam Zone Estimate ${record.quoteNumber}`.trim();

    const templateInput = usesResendOnboardingSender
      ? {
          preheader: `New estimate lead ${record.quoteNumber} from ${record.contact.fullName}.`,
          heading: 'New Estimate Lead',
          subheading: 'A customer submitted a live estimate request from steamzone.ca.',
          intro: 'The lead details and estimate summary are below. PDF quote is attached for your team.',
          estimateRange,
          durationRange,
          quoteNumber: record.quoteNumber,
          detailRows: [
            { label: 'Customer', value: record.contact.fullName },
            { label: 'Email', value: record.contact.email },
            { label: 'Phone', value: record.contact.phone },
            { label: 'Service', value: service },
            { label: 'Address', value: record.contact.address?.trim() ? record.contact.address : 'Not provided' },
            { label: 'Postal / Zone', value: `${record.postalCode} / ${engine.formatZoneLabel(record.zone as WindowZone)}` },
            { label: 'Next Step', value: record.result.bookingMode },
          ],
          notes: record.result.notes ?? [],
          redFlags: record.result.redFlags ?? [],
          footerLine: 'Reply to this email to follow up with the lead and schedule next steps.',
        }
      : {
          preheader: `Your estimate range is ${estimateRange}.`,
          heading: 'Your Steam Zone Estimate',
          subheading: 'Thanks for requesting an instant quote. A PDF copy is attached to your records.',
          intro:
            'Review the estimate summary below. Final pricing is confirmed based on site conditions and selected add-ons.',
          estimateRange,
          durationRange,
          quoteNumber: record.quoteNumber,
          detailRows: [
            { label: 'Customer', value: record.contact.fullName },
            { label: 'Service', value: service },
            { label: 'Quote Number', value: record.quoteNumber },
            { label: 'Estimated Duration', value: durationRange },
            { label: 'Address', value: record.contact.address?.trim() ? record.contact.address : 'Not provided' },
            { label: 'Postal / Zone', value: `${record.postalCode} / ${engine.formatZoneLabel(record.zone as WindowZone)}` },
            { label: 'Next Step', value: record.result.bookingMode },
          ],
          notes: record.result.notes ?? [],
          redFlags: record.result.redFlags ?? [],
          footerLine:
            'To book or confirm details, reply to this email or call Steam Zone at (431) 205-3909. We appreciate your business.',
        };

    const mailer = await getMailer();
    const html = mailer.renderEmailTemplate(templateInput);
    const pdfBytes = await mailer.buildQuotePdf(templateInput);
    const text = usesResendOnboardingSender
      ? [
          `New Steam Zone estimate lead ${record.quoteNumber}`,
          `Name: ${record.contact.fullName}`,
          `Email: ${record.contact.email}`,
          `Phone: ${record.contact.phone}`,
          `Service: ${service}`,
          `Estimate Range: ${estimateRange}`,
          `Duration: ${durationRange}`,
        ].join('\n')
      : [
          `Hi ${record.contact.fullName},`,
          '',
          `Thanks for requesting an estimate from Steam Zone.`,
          `Quote Number: ${record.quoteNumber}`,
          `Service: ${service}`,
          `Estimate Range: ${estimateRange}`,
          `Estimated Duration: ${durationRange}`,
          '',
          'Your PDF estimate is attached. Reply to this email or call (431) 205-3909 to book.',
        ].join('\n');

    const emailResult = await resend.emails.send({
      from: fromEmail,
      to,
      bcc,
      replyTo,
      subject,
      html,
      text,
      attachments: [
        {
          filename: `${record.quoteNumber}.pdf`,
          content: Buffer.from(pdfBytes).toString('base64'),
        },
      ],
    });

    if (emailResult.error) {
      return { success: false, message: emailResult.error.message };
    }

    return usesResendOnboardingSender
      ? { success: true, message: 'Estimate captured and sent to Steam Zone inbox for follow-up.', deliveryMode: 'internal' }
      : { success: true, message: 'Estimate email sent successfully.', deliveryMode: 'customer' };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'Unknown email delivery error.' };
  }
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  try {
    const idempotencyKeyRaw = headerValue(req, 'x-idempotency-key')?.trim() ?? '';
    const wantsResend = (headerValue(req, 'x-idempotency-resend') ?? '').toLowerCase() === 'true' || headerValue(req, 'x-idempotency-resend') === '1';
    const idempotencyKey = idempotencyKeyRaw ? idempotencyKeyRaw : null;
    if (idempotencyKey && !idempotencyKeyRegex.test(idempotencyKey)) {
      res.status(400).json({ message: 'Invalid X-Idempotency-Key header.' });
      return;
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const serviceType = coerceServiceType(body?.serviceType);
    const answers = body?.answers;

    if (!serviceType || !answers) {
      res.status(400).json({ message: 'Missing serviceType or answers.' });
      return;
    }

    const postalCode = safeString(answers.postalCode, '').trim();
    const postalError = validatePostalCode(postalCode);
    if (postalError) {
      res.status(400).json({ message: postalError });
      return;
    }

    const contact = answers.contact as LeadContact | undefined;
    if (!contact) {
      res.status(400).json({ message: 'Missing contact details.' });
      return;
    }

    const contactError = validateContact(contact);
    if (contactError) {
      res.status(400).json({ message: contactError });
      return;
    }

    // If we already created a record for this idempotency key, return it (and skip duplicate emails),
    // unless the client explicitly asks for a resend after configuration fixes.
    if (idempotencyKey) {
      const existing = await fetchEstimateRecordByIdempotencyKey(idempotencyKey);
      if (existing) {
        if (wantsResend) {
          const [email, ghl] = await Promise.all([sendEstimateEmail(existing), syncToGhl(existing)]);
          res.status(200).json({
            record: existing,
            email: { ...email, idempotent: true, resent: true, deliveryMode: email.deliveryMode ?? currentDeliveryMode() },
            storage: { stored: true },
            pricing: { source: 'supabase', version: existing.pricingVersion },
            ghl,
          });
          return;
        }

        res.status(200).json({
          record: existing,
          email: {
            success: true,
            message: 'Duplicate submission prevented. Quote already generated; not sending a second email.',
            deliveryMode: currentDeliveryMode(),
            idempotent: true,
          },
          storage: { stored: true },
          pricing: { source: 'supabase', version: existing.pricingVersion },
          ghl: { posted: false, idempotent: true },
        });
        return;
      }
    }

    const engine = await getEngine();
    const zone = engine.detectZoneFromPostalCode(postalCode);
    const normalizedAnswers = {
      ...answers,
      postalCode,
      zone,
      contact,
    };

    const { config: pricingConfig, source: pricingSource } = await loadPricingConfigForEstimate();
    const estimate = engine.calculateEstimate(serviceType, normalizedAnswers, pricingConfig);

    const createdAt = nowIso();
    const quoteNumber = generateQuoteNumber();
    const record: EstimateRecord = {
      id:
        typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2, 11),
      quoteNumber,
      createdAt,
      serviceType,
      postalCode,
      zone,
      contact,
      answers: normalizedAnswers,
      result: estimate,
      pricingVersion: pricingConfig.version,
      utm: (body?.utm ?? {}) as EstimateRecord['utm'],
    };

    try {
      const stored = await storeEstimateRecordWithIdempotency(record, idempotencyKey);
      if (stored.existing) {
        // Another request already inserted this idempotency key (race). Return the existing record.
        res.status(200).json({
          record: stored.existing,
          email: {
            success: true,
            message: 'Duplicate submission prevented. Quote already generated; not sending a second email.',
            deliveryMode: currentDeliveryMode(),
            idempotent: true,
          },
          storage: { stored: true },
          pricing: { source: pricingSource, version: pricingConfig.version },
          ghl: { posted: false, idempotent: true },
        });
        return;
      }

      if (stored.recordId) {
        record.id = stored.recordId;
      }

      const [email, ghl] = await Promise.all([sendEstimateEmail(record), syncToGhl(record)]);

      res.status(200).json({
        record,
        email,
        storage: { stored: stored.stored, error: stored.error },
        pricing: { source: pricingSource, version: pricingConfig.version },
        ghl,
      });
    } catch (error) {
      res.status(200).json({
        record,
        email: { success: false, message: error instanceof Error ? error.message : 'Unknown estimate-create error.' },
        storage: { stored: false },
        pricing: { source: pricingSource, version: pricingConfig.version },
        ghl: { posted: false },
      });
    }
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : 'Unknown estimate-create error.' });
  }
}
