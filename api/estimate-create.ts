import { Resend } from 'resend';
import type { EstimateRecord, LeadContact, PricingConfig, ServiceType, WindowZone } from '../src/lib/estimateEngine.js';

type ApiRequest = { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> };
type ApiResponse = { status: (code: number) => ApiResponse; json: (body: unknown) => void };

const postalCodeRegex = /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/;
const idempotencyKeyRegex = /^[A-Za-z0-9._:-]{8,200}$/;
const ghlBaseUrlDefault = 'https://services.leadconnectorhq.com';
const ghlApiVersionDefault = '2021-07-28';
const ghlConversationsApiVersion = '2021-04-15';

function asBool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value !== 'string') return fallback;
  const s = value.trim().toLowerCase();
  if (!s) return fallback;
  if (['1', 'true', 'yes', 'y', 'on', 'agree', 'agreed'].includes(s)) return true;
  if (['0', 'false', 'no', 'n', 'off', 'disagree', 'decline', 'declined'].includes(s)) return false;
  return fallback;
}

function clampInt(value: unknown, fallback = 0, min = 0, max = 1000000): number {
  const n = Math.round(finiteNumber(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const v = typeof value === 'string' ? value : '';
  return (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

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

type QuoteRuntimeModule = {
  validateRequiredAnswers: (answers: Record<string, unknown>) => string[];
};

let enginePromise: Promise<EngineModule> | null = null;
let mailerPromise: Promise<MailerModule> | null = null;
let quoteRuntimePromise: Promise<QuoteRuntimeModule> | null = null;

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

async function getQuoteRuntime(): Promise<QuoteRuntimeModule> {
  if (!quoteRuntimePromise) {
    quoteRuntimePromise = import('../server/quoteRuntime.mjs').then((mod) => mod as unknown as QuoteRuntimeModule);
  }
  return quoteRuntimePromise;
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

function assertFiniteNumber(value: unknown, label: string): number {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Non-finite number for ${label}.`);
  }
  return num;
}

function assertEstimateResultSafe(result: EstimateRecord['result']): void {
  assertFiniteNumber(result.subtotal, 'result.subtotal');
  assertFiniteNumber(result.estimateLow, 'result.estimateLow');
  assertFiniteNumber(result.estimateHigh, 'result.estimateHigh');
  assertFiniteNumber(result.durationLowHours, 'result.durationLowHours');
  assertFiniteNumber(result.durationHighHours, 'result.durationHighHours');
  assertFiniteNumber(result.complexityScore, 'result.complexityScore');
  assertFiniteNumber(result.estimatedSqft, 'result.estimatedSqft');

  for (const item of result.includedItems ?? []) {
    const normalized = String(item ?? '').toLowerCase();
    if (!normalized) {
      continue;
    }
    if (normalized.includes('undefined')) {
      throw new Error('Estimate includes invalid undefined line-item text.');
    }
  }
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

function validateContact(
  contact: LeadContact,
  opts: { requireName?: boolean; requirePhone?: boolean } = {}
): string | null {
  const requireName = opts.requireName ?? true;
  const requirePhone = opts.requirePhone ?? true;

  if (requireName && (!contact.fullName?.trim() || contact.fullName.trim().length < 2)) return 'Full name is required.';
  if (requirePhone && (!contact.phone?.replace(/\D/g, '') || contact.phone.replace(/\D/g, '').length < 7)) {
    return 'Phone number is required.';
  }
  if (!contact.email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim())) return 'Valid email is required.';
  if (!contact.consentToContact) return 'Consent is required.';
  return null;
}

function coerceContact(input: unknown): LeadContact | null {
  const rec = asRecord(input);
  if (!rec) return null;

  const firstName = safeString(rec.firstName, safeString(rec.first_name, '')).trim();
  const lastName = safeString(rec.lastName, safeString(rec.last_name, '')).trim();
  const joinedName = [firstName, lastName].filter(Boolean).join(' ').trim();
  const email = safeString(rec.email, '').trim();
  const fallbackName = email ? email.split('@')[0]?.replace(/[._-]+/g, ' ').trim() : '';
  const bestName = safeString(rec.fullName, safeString(rec.name, joinedName || fallbackName)).trim();

  return {
    fullName: bestName,
    address: safeString(rec.address, '').trim(),
    phone: safeString(rec.phone, '').trim(),
    email,
    consentToContact: asBool(rec.consentToContact, false),
    marketingOptIn: asBool(rec.marketingOptIn, false),
  };
}

type GhlWebhookContext = { isGhlWebhook: true; contactId?: string | null; conversationId?: string | null };

function maybeExtractGhlWebhookPayload(body: unknown): { serviceType?: unknown; answers?: unknown; ghl?: GhlWebhookContext } | null {
  const root = asRecord(body);
  if (!root) return null;

  const customData = asRecord(root.customData) ?? asRecord(root.custom_data) ?? null;
  const contactBlock = asRecord(root.contact) ?? null;

  // If this doesn't look like a GHL webhook payload, bail.
  if (!customData && !contactBlock) return null;

  const contactId =
    safeString(contactBlock?.id, '').trim() ||
    safeString(customData?.contactId, safeString(customData?.contact_id, '')).trim() ||
    null;

  const conversationId =
    safeString(customData?.conversationId, safeString(customData?.conversation_id, '')).trim() || null;

  const serviceType =
    root.serviceType ??
    root.service_type ??
    customData?.serviceType ??
    customData?.service_type ??
    customData?.service ??
    customData?.serviceKey ??
    customData?.service_key ??
    null;

  const postalCode =
    safeString(root.postalCode, safeString(root.postal_code, '')).trim() ||
    safeString(contactBlock?.postalCode, safeString(contactBlock?.postal_code, '')).trim() ||
    safeString(customData?.postalCode, safeString(customData?.postal_code, '')).trim();

  const contact = coerceContact(customData?.contact) ?? coerceContact(contactBlock) ?? coerceContact(customData) ?? null;

  // Flatten customData into answers (works with GHL webhook key/value custom payload).
  const answers: Record<string, unknown> = {
    ...(customData ? customData : {}),
    postalCode,
    contact: {
      ...(contact ?? {}),
      // Allow consent + marketing to be supplied as separate custom keys (common in workflows).
      consentToContact: asBool(
        customData?.consentToContact ?? customData?.consent_to_contact ?? (contact as LeadContact | null)?.consentToContact,
        false
      ),
      marketingOptIn: asBool(
        customData?.marketingOptIn ?? customData?.marketing_opt_in ?? (contact as LeadContact | null)?.marketingOptIn,
        false
      ),
    },
  };

  return { serviceType, answers, ghl: { isGhlWebhook: true, contactId, conversationId } };
}

function extractCanadianPostalCodeFromText(text: string): string | null {
  const hit = text.match(/[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d/);
  if (!hit) return null;
  return hit[0].toUpperCase().replace(/\s+/g, ' ').trim();
}

function extractEmailFromText(text: string): string | null {
  const hit = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return hit ? hit[0].trim() : null;
}

function inferServiceTypeFromText(text: string): ServiceType | null {
  const s = normalizeKey(text);
  if (!s) return null;
  if (s.includes('post') && s.includes('construction')) return 'postConstruction';
  if (s.includes('carpet')) return 'carpet';
  if (s.includes('commercial') && s.includes('window')) return 'commercialWindow';
  if (s.includes('window')) return 'window';
  return null;
}

type GhlConversationMessage = { direction?: string; body?: string; dateAdded?: string };

function extractMessagesArray(payload: unknown): GhlConversationMessage[] {
  const p = asRecord(payload);
  if (!p) return [];
  const messagesContainer = p['messages'];
  if (Array.isArray(messagesContainer)) return messagesContainer as GhlConversationMessage[];
  const container = asRecord(messagesContainer);
  const nested = container?.['messages'];
  if (Array.isArray(nested)) return nested as GhlConversationMessage[];
  return [];
}

async function inferIntakeFromGhlConversation(contactId: string): Promise<{
  serviceType?: ServiceType | null;
  postalCode?: string | null;
  consentToContact?: boolean | null;
  marketingOptIn?: boolean | null;
  email?: string | null;
}> {
  const token = env('GHL_PRIVATE_INTEGRATION_TOKEN') ?? env('GHL_ACCESS_TOKEN');
  const locationId = env('GHL_LOCATION_ID');
  if (!token || !locationId) return {};

  const baseUrl = (env('GHL_BASE_URL') ?? ghlBaseUrlDefault).replace(/\/+$/, '');

  const request = async (path: string, query?: Record<string, unknown>) => {
    const url = new URL(baseUrl + (path.startsWith('/') ? path : `/${path}`));
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null || v === '') continue;
        url.searchParams.set(k, String(v));
      }
    }

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        Version: ghlConversationsApiVersion,
      },
    });

    const contentType = res.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    const payload = isJson ? await res.json().catch(() => null) : await res.text().catch(() => '');
    if (!res.ok) return null;
    return payload;
  };

  const convoSearch = await request('/conversations/search', { locationId, contactId, limit: 1 });
  const convoObj = asRecord(convoSearch);
  const conversations = Array.isArray(convoObj?.['conversations']) ? (convoObj?.['conversations'] as unknown[]) : [];
  const convo = asRecord(conversations[0]);
  const conversationId = convo && typeof convo['id'] === 'string' ? (convo['id'] as string) : null;
  if (!conversationId) return {};

  const messagesPayload = await request(`/conversations/${conversationId}/messages`, { limit: 50 });
  const messages = extractMessagesArray(messagesPayload)
    .map((m) => ({
      direction: typeof m.direction === 'string' ? m.direction : '',
      body: typeof m.body === 'string' ? m.body : '',
      dateAdded: typeof m.dateAdded === 'string' ? m.dateAdded : '',
    }))
    .filter((m) => m.body)
    .sort((a, b) => (a.dateAdded || '').localeCompare(b.dateAdded || ''));

  const transcript = messages.map((m) => m.body).join('\n');
  const inbound = messages.filter((m) => m.direction === 'inbound').map((m) => m.body).join('\n');

  const serviceType = inferServiceTypeFromText(transcript);
  const postalCode = extractCanadianPostalCodeFromText(transcript);
  const email = extractEmailFromText(transcript);

  let consentToContact: boolean | null = null;
  let marketingOptIn: boolean | null = null;
  for (let i = 0; i < messages.length - 1; i += 1) {
    const cur = messages[i];
    const next = messages[i + 1];
    if (cur.direction !== 'outbound' || next.direction !== 'inbound') continue;
    const q = normalizeKey(cur.body);
    const a = normalizeKey(next.body);
    if (consentToContact === null && (q.includes('permission') || q.includes('consent'))) {
      consentToContact = asBool(a, false);
    }
    if (marketingOptIn === null && (q.includes('offers') || q.includes('service updates') || q.includes('updates'))) {
      marketingOptIn = asBool(a, false);
    }
  }

  if (consentToContact === null && inbound.trim()) {
    const inboundHasYes = /\byes\b/i.test(inbound);
    if (inboundHasYes && normalizeKey(transcript).includes('estimate')) {
      consentToContact = true;
    }
  }

  return { serviceType, postalCode, consentToContact, marketingOptIn, email };
}

function coerceServiceType(value: unknown): ServiceType | null {
  if (value === 'window' || value === 'commercialWindow' || value === 'carpet' || value === 'postConstruction') {
    return value as ServiceType;
  }

  // Accept common label/synonym values so external systems (ex: GHL workflows) can submit without strict keys.
  const raw = typeof value === 'string' ? value : '';
  const normalized = raw.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (!normalized) return null;

  if (
    normalized === 'residential window cleaning' ||
    normalized === 'window cleaning' ||
    normalized === 'residential windows' ||
    normalized === 'windows' ||
    normalized === 'residential window'
  ) {
    return 'window';
  }
  if (
    normalized === 'commercial window cleaning' ||
    normalized === 'commercial windows' ||
    normalized === 'commercial window'
  ) {
    return 'commercialWindow';
  }
  if (normalized === 'carpet cleaning' || normalized === 'carpet') {
    return 'carpet';
  }
  if (
    normalized === 'post construction' ||
    normalized === 'post construction cleaning' ||
    normalized === 'post-construction cleaning' ||
    normalized === 'post construction cleanup' ||
    normalized === 'post construction clean'
  ) {
    return 'postConstruction';
  }

  return null;
}

function formatHoursRange(low: number, high: number): string {
  const a = Number.isFinite(low) ? low : 0;
  const b = Number.isFinite(high) ? high : 0;
  return `${a.toFixed(1)} - ${b.toFixed(1)} hours`;
}

function normalizeEstimateAnswers(serviceType: ServiceType, raw: unknown, postalCode: string, zone: WindowZone, contact: LeadContact) {
  const rec = asRecord(raw) ?? {};

  if (serviceType === 'window') {
    // Defaults are intentionally conservative; chat/workflow can send partial answers and still succeed.
    const windowStoreys = ['bungalow', 'oneHalf', 'two', 'twoHalf', 'three'] as const;
    const sizeBrackets = ['under1000', '1000to1500', '1500to2000', '2000to2500', '2500to3000', 'over3000'] as const;
    const scopes = ['exterior', 'interior', 'both'] as const;
    const screens = ['none', 'some', 'all'] as const;
    const tracks = ['basic', 'detailed'] as const;
    const sliding = ['none', 'threePanel', 'fivePanel'] as const;
    const patio = ['none', 'takeApart', 'slideOnly'] as const;
    const skylights = ['none', 'interior', 'exterior', 'both'] as const;
    const railing = ['none', 'oneSide', 'twoSides'] as const;
    const french = ['none', 'some', 'lots'] as const;

    return {
      postalCode,
      zone,
      storey: pickEnum(rec.storey, windowStoreys, 'bungalow'),
      sizeBracket: pickEnum(rec.sizeBracket, sizeBrackets, 'under1000'),
      scope: pickEnum(rec.scope, scopes, 'exterior'),
      screens: pickEnum(rec.screens, screens, 'none'),
      tracks: pickEnum(rec.tracks, tracks, 'basic'),
      hardToReach: asBool(rec.hardToReach, false),
      hardWaterRemoval: asBool(rec.hardWaterRemoval, false),
      constructionDebris: asBool(rec.constructionDebris, false),
      slidingRemoval: pickEnum(rec.slidingRemoval, sliding, 'none'),
      slidingQuantity: clampInt(rec.slidingQuantity, 0, 0, 50),
      patioDoors: pickEnum(rec.patioDoors, patio, 'none'),
      patioQuantity: clampInt(rec.patioQuantity, 0, 0, 50),
      skylights: pickEnum(rec.skylights, skylights, 'none'),
      skylightQuantity: clampInt(rec.skylightQuantity, 0, 0, 50),
      railingGlass: pickEnum(rec.railingGlass, railing, 'none'),
      frenchPanes: pickEnum(rec.frenchPanes, french, 'none'),
      sunroom: asBool(rec.sunroom, false),
      walkoutBasement: asBool(rec.walkoutBasement, false),
      contact,
    };
  }

  if (serviceType === 'commercialWindow') {
    const buildingType = ['storefront', 'lowRise', 'midRise', 'highRise'] as const;
    const storeys = ['ground', 'twoToThree', 'fourToEight', 'ninePlus'] as const;
    const sizeMode = ['paneCount', 'frontage'] as const;
    const scope = ['exterior', 'both'] as const;
    const frequency = ['oneTime', 'monthly', 'biweekly', 'weekly'] as const;

    return {
      postalCode,
      zone,
      buildingType: pickEnum(rec.buildingType, buildingType, 'storefront'),
      storeys: pickEnum(rec.storeys, storeys, 'ground'),
      sizeMode: pickEnum(rec.sizeMode, sizeMode, 'paneCount'),
      paneCount: clampInt(rec.paneCount, 20, 0, 10000),
      frontageFeet: clampInt(rec.frontageFeet, 30, 0, 100000),
      glassDoors: clampInt(rec.glassDoors, 0, 0, 1000),
      scope: pickEnum(rec.scope, scope, 'exterior'),
      frequency: pickEnum(rec.frequency, frequency, 'oneTime'),
      liftRequired: asBool(rec.liftRequired, false),
      afterHours: asBool(rec.afterHours, false),
      overspray: asBool(rec.overspray, false),
      hardWater: asBool(rec.hardWater, false),
      contact,
    };
  }

  if (serviceType === 'carpet') {
    const estimateMode = ['rooms', 'sqft'] as const;
    const sqftBracket = ['under500', '500to1000', '1000to1500', '1500to2000', 'over2000'] as const;
    const condition = ['light', 'moderate', 'heavy'] as const;
    const furniture = ['none', 'light', 'heavy'] as const;
    const schedule = ['asap', 'nextWeek', 'flexible', 'tomorrow'] as const;

    return {
      postalCode,
      zone,
      estimateMode: pickEnum(rec.estimateMode, estimateMode, 'rooms'),
      rooms: clampInt(rec.rooms, 3, 0, 50),
      sqftBracket: pickEnum(rec.sqftBracket, sqftBracket, 'under500'),
      condition: pickEnum(rec.condition, condition, 'moderate'),
      stairsSteps: clampInt(rec.stairsSteps, 0, 0, 200),
      hallways: clampInt(rec.hallways, 0, 0, 50),
      advancedStainRemoval: asBool(rec.advancedStainRemoval, false),
      odorElimination: asBool(rec.odorElimination, false),
      petTreatment: asBool(rec.petTreatment, false),
      stainProtector: asBool(rec.stainProtector, false),
      furnitureMoving: pickEnum(rec.furnitureMoving, furniture, 'none'),
      unusualCondition: asBool(rec.unusualCondition, false),
      schedule: pickEnum(rec.schedule, schedule, 'flexible'),
      contact,
    };
  }

  // postConstruction
  const projectType = ['residential', 'commercial'] as const;
  const buildType = ['renovation', 'newBuild'] as const;
  const sqftBracket = ['under1000', '1000to2500', '2500to5000', 'over5000'] as const;
  const stage = ['rough', 'light', 'final', 'touchUp'] as const;
  const dustLoad = ['light', 'medium', 'heavy'] as const;
  const addOnSize = ['none', 'small', 'medium', 'large'] as const;
  const scraping = ['none', 'some', 'lots'] as const;
  const schedule = ['asap', 'nextWeek', 'flexible', 'tomorrow'] as const;

  return {
    postalCode,
    zone,
    projectType: pickEnum(rec.projectType, projectType, 'residential'),
    buildType: pickEnum(rec.buildType, buildType, 'renovation'),
    // Accept alternate key so external tools can avoid parameter name collisions.
    sqftBracket: pickEnum(rec.sqftBracket ?? rec.postSqftBracket, sqftBracket, '1000to2500'),
    floors: clampInt(rec.floors, 1, 1, 100),
    stage: pickEnum(rec.stage, stage, 'final'),
    dustLoad: pickEnum(rec.dustLoad, dustLoad, 'medium'),
    interiorWindows: pickEnum(rec.interiorWindows, addOnSize, 'none'),
    scraping: pickEnum(rec.scraping, scraping, 'none'),
    insideCabinets: asBool(rec.insideCabinets, false),
    appliances: asBool(rec.appliances, false),
    floorDetailing: pickEnum(rec.floorDetailing, addOnSize, 'none'),
    specialDetailing: asBool(rec.specialDetailing, false),
    multiTenantAccess: asBool(rec.multiTenantAccess, false),
    schedule: pickEnum(rec.schedule, schedule, 'flexible'),
    contact,
  };
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
      answers: row.answers as EstimateRecord['answers'],
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

type GhlSmsResult = { attempted: boolean; sent: boolean; error?: string };

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
    setCF('consent_to_contact', record.contact.consentToContact ? 'true' : '');
    setCF('marketing_opt_in', record.contact.marketingOptIn ? 'true' : '');

    const tags: string[] = [];
    tags.push('estimate_new');
    tags.push(record.result.confidence === 'green' ? 'estimate_green' : record.result.confidence === 'yellow' ? 'estimate_yellow' : 'estimate_red');
    tags.push(record.utm && Object.keys(record.utm).length > 0 ? 'source_ai_estimate' : 'source_website_estimate');
    if (record.contact.consentToContact) {
      tags.push('consent_to_contact');
    }
    if (record.contact.marketingOptIn) {
      tags.push('marketing_opt_in');
    }

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

async function sendEstimateSmsViaGhlApi(record: EstimateRecord, contactId: string): Promise<GhlSmsResult> {
  // Only send SMS when we have explicit consent + a phone number to receive it.
  const hasPhone = Boolean(record.contact.phone?.replace(/\D/g, ''));
  if (!record.contact.consentToContact || !hasPhone) {
    return { attempted: false, sent: false };
  }

  const token = env('GHL_PRIVATE_INTEGRATION_TOKEN') ?? env('GHL_ACCESS_TOKEN');
  if (!token) return { attempted: false, sent: false, error: 'missing_token' };

  const baseUrl = (env('GHL_BASE_URL') ?? ghlBaseUrlDefault).replace(/\/+$/, '');
  // GHL Conversations "send message" endpoint uses a different Version header than the core CRM APIs.
  const conversationsVersion = '2021-04-15';

  try {
    const engine = await getEngine();
    const estimateRange = `${engine.formatCurrency(record.result.estimateLow)} - ${engine.formatCurrency(record.result.estimateHigh)}`;

    const msg = [
      `Steam Zone estimate: ${estimateRange}`,
      `Quote: ${record.quoteNumber}`,
      `We also emailed the PDF quote to you.`,
      `Reply BOOK to schedule, or reply with questions.`,
    ].join('\n');

    const url = new URL(baseUrl + '/conversations/messages');
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        Version: conversationsVersion,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'SMS',
        contactId,
        message: msg,
      }),
    });

    const contentType = res.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    const payload = isJson ? await res.json().catch(() => null) : await res.text().catch(() => '');

    if (!res.ok) {
      const detail = isJson ? JSON.stringify(payload) : String(payload);
      return { attempted: true, sent: false, error: `sms_failed:${res.status}:${detail}` };
    }

    const ok = Boolean((payload as Record<string, unknown> | null)?.success ?? true);
    return { attempted: true, sent: ok };
  } catch (e) {
    return { attempted: true, sent: false, error: e instanceof Error ? e.message : 'sms_exception' };
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

    const utm = (record.utm ?? {}) as Record<string, string>;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        secret: secret || undefined,
        source: utm.source ?? utm.utm_source ?? utm.utmSource ?? 'website',
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
          consentToContact: record.contact.consentToContact ? true : undefined,
          marketingOptIn: record.contact.marketingOptIn ? true : undefined,
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
          consent_to_contact: record.contact.consentToContact,
          marketing_opt_in: record.contact.marketingOptIn,
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
  return { posted: false, error: 'missing_env' };
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
            'To book or confirm details, reply to this email or call Steam Zone at (236) 506-6570. We appreciate your business.',
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
          'Your PDF estimate is attached. Reply to this email or call (236) 506-6570 to book.',
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
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const sendEmailRequested = asBool((asRecord(body)?.send_email ?? true) as unknown, true);

    // Idempotency: prefer header (best practice), but allow body for tools that can't set headers.
    const idempotencyKeyRaw =
      headerValue(req, 'x-idempotency-key')?.trim() ??
      safeString((body as Record<string, unknown> | null)?.idempotencyKey, '').trim() ??
      safeString((body as Record<string, unknown> | null)?.idempotency_key, '').trim() ??
      '';
    const wantsResend =
      (headerValue(req, 'x-idempotency-resend') ?? '').toLowerCase() === 'true' || headerValue(req, 'x-idempotency-resend') === '1';
    const idempotencyKey = idempotencyKeyRaw ? idempotencyKeyRaw : null;
    if (idempotencyKey && !idempotencyKeyRegex.test(idempotencyKey)) {
      res.status(400).json({ message: 'Invalid idempotency key.' });
      return;
    }

    const extracted = maybeExtractGhlWebhookPayload(body);
    const isGhlWebhook = Boolean(extracted?.ghl?.isGhlWebhook);
    const ghlContactId = extracted?.ghl?.contactId ?? null;

    let serviceType = coerceServiceType(extracted?.serviceType ?? body?.serviceType);
    // Allow both:
    // - { serviceType, answers: {...} } (site/app)
    // - { serviceType, ...answersFields } (tools that can't nest under "answers")
    let answers: unknown = extracted?.answers ?? body?.answers;
    if (!answers && body && typeof body === 'object') {
      answers = body;
    }

    // If the call came from a GHL workflow, we may not receive structured answers/custom fields.
    // Try to infer missing pieces from the conversation transcript (contactId -> conversation -> messages).
    if (isGhlWebhook && ghlContactId) {
      const inferred = await inferIntakeFromGhlConversation(String(ghlContactId));
      if (!serviceType && inferred.serviceType) {
        serviceType = inferred.serviceType;
      }

      const answersRec = asRecord(answers) ?? {};
      const postalFromAnswers = safeString(answersRec.postalCode, '').trim();
      if (!postalFromAnswers && inferred.postalCode) {
        answersRec.postalCode = inferred.postalCode;
      }

      const contactRec = asRecord(answersRec.contact) ?? {};
      if (!safeString(contactRec.email, '').trim() && inferred.email) {
        contactRec.email = inferred.email;
      }
      // When the workflow doesn't pass custom fields, our extracted payload defaults these to false.
      // If we can infer a real answer from the chat transcript, prefer the inferred value.
      if (inferred.consentToContact !== undefined && inferred.consentToContact !== null) {
        contactRec.consentToContact = inferred.consentToContact;
      }
      if (inferred.marketingOptIn !== undefined && inferred.marketingOptIn !== null) {
        contactRec.marketingOptIn = inferred.marketingOptIn;
      }
      answersRec.contact = contactRec;
      answers = answersRec;
    }

    if (!serviceType || !answers) {
      res.status(400).json({ message: 'Missing serviceType or answers.' });
      return;
    }

    const answersRec = asRecord(answers) ?? {};
    const postalCode = safeString(answersRec.postalCode, '').trim();
    const postalError = validatePostalCode(postalCode);
    if (postalError) {
      res.status(400).json({ message: postalError });
      return;
    }

    // Prefer answers.contact, but accept flattened contact fields too.
    const contact = coerceContact(answersRec.contact) ?? coerceContact(answersRec);
    if (!contact) {
      res.status(400).json({ message: 'Missing contact details.' });
      return;
    }

    const contactError = validateContact(contact, isGhlWebhook ? { requireName: false, requirePhone: false } : undefined);
    if (contactError) {
      res.status(400).json({ message: contactError });
      return;
    }

    const engine = await getEngine();
    const strictMode = asBool((asRecord(body)?.strict ?? true) as unknown, true);
    const detectedZone = engine.detectZoneFromPostalCode(postalCode);
    const zone = pickEnum(answersRec.zone, ['zoneA', 'zoneB', 'zoneC', 'zoneD'] as const, detectedZone);

    if (strictMode) {
      const quoteRuntime = await getQuoteRuntime();
      const strictAnswers: Record<string, unknown> = {
        ...answersRec,
        serviceType,
        postalCode,
        zone,
        contact: {
          ...(asRecord(answersRec.contact) ?? {}),
          ...contact,
        },
      };
      const errors = quoteRuntime.validateRequiredAnswers(strictAnswers);
      if (errors.length > 0) {
        res.status(400).json({
          message: 'Validation failed for final estimate.',
          errors,
        });
        return;
      }
    }

    // If we already created a record for this idempotency key, return it (and skip duplicate emails),
    // unless the client explicitly asks for a resend after configuration fixes.
    if (idempotencyKey) {
      const existing = await fetchEstimateRecordByIdempotencyKey(idempotencyKey);
      if (existing) {
        if (wantsResend) {
          const [email, ghl] = await Promise.all([
            sendEmailRequested
              ? sendEstimateEmail(existing)
              : Promise.resolve({
                  success: true,
                  message: 'Email delivery skipped by request.',
                  deliveryMode: currentDeliveryMode(),
                }),
            syncToGhl(existing),
          ]);
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

    const normalizedAnswers = normalizeEstimateAnswers(serviceType, answers, postalCode, zone, contact);

    const { config: pricingConfig, source: pricingSource } = await loadPricingConfigForEstimate();
    const estimate = engine.calculateEstimate(serviceType, normalizedAnswers, pricingConfig);
    assertEstimateResultSafe(estimate);

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

      const [email, ghl] = await Promise.all([
        sendEmailRequested
          ? sendEstimateEmail(record)
          : Promise.resolve({
              success: true,
              message: 'Email delivery skipped by request.',
              deliveryMode: currentDeliveryMode(),
            }),
        syncToGhl(record),
      ]);
      const sms =
        ghl?.posted && ghl?.mode === 'api' && ghl?.contactId
          ? await sendEstimateSmsViaGhlApi(record, String(ghl.contactId))
          : ({ attempted: false, sent: false } as GhlSmsResult);

      res.status(200).json({
        record,
        email,
        sms,
        storage: { stored: stored.stored, error: stored.error },
        pricing: { source: pricingSource, version: pricingConfig.version },
        ghl,
      });
    } catch (error) {
      res.status(200).json({
        record,
        email: { success: false, message: error instanceof Error ? error.message : 'Unknown estimate-create error.' },
        sms: { attempted: false, sent: false },
        storage: { stored: false },
        pricing: { source: pricingSource, version: pricingConfig.version },
        ghl: { posted: false },
      });
    }
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : 'Unknown estimate-create error.' });
  }
}
