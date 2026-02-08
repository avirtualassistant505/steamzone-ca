import { Resend } from 'resend';
import type { EstimateRecord, LeadContact, PricingConfig, ServiceType, WindowZone } from '../src/lib/estimateEngine';

type ApiRequest = { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> };
type ApiResponse = { status: (code: number) => ApiResponse; json: (body: unknown) => void };

const postalCodeRegex = /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/;
const idempotencyKeyRegex = /^[A-Za-z0-9._:-]{8,200}$/;

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

async function postToGhl(record: EstimateRecord): Promise<{ posted: boolean }> {
  const url = process.env.GHL_INBOUND_WEBHOOK_URL?.trim();
  if (!url) {
    return { posted: false };
  }

  const secret = process.env.GHL_WEBHOOK_SECRET?.trim();

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        secret: secret || undefined,
        quoteNumber: record.quoteNumber,
        createdAt: record.createdAt,
        serviceType: record.serviceType,
        postalCode: record.postalCode,
        zone: record.zone,
        contact: record.contact,
        result: record.result,
        utm: record.utm,
      }),
    });
    return { posted: response.ok };
  } catch {
    return { posted: false };
  }
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
          const [email, ghl] = await Promise.all([sendEstimateEmail(existing), postToGhl(existing)]);
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

      const [email, ghl] = await Promise.all([sendEstimateEmail(record), postToGhl(record)]);

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
