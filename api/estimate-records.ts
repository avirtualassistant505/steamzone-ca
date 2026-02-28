import type { EstimateRecord, ServiceType, WindowZone } from '../src/lib/estimateEngine.js';
import { getSupabaseAdminClient } from '../server/supabaseAdmin.js';

type ApiRequest = {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
};

type EstimateSource = 'form' | 'chat' | 'voice' | 'api' | 'website';

type EstimateRecordRow = {
  id: string;
  quote_number: string;
  created_at: string;
  source: string | null;
  service_type: ServiceType;
  postal_code: string;
  zone: WindowZone;
  contact: EstimateRecord['contact'];
  answers: EstimateRecord['answers'];
  result: EstimateRecord['result'];
  pricing_version: number;
  utm: EstimateRecord['utm'] | null;
};

function asText(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0]?.trim() ?? '';
  }
  return value?.trim() ?? '';
}

function coerceSource(value: string | null): EstimateSource {
  const normalized = (value ?? '').trim().toLowerCase();
  if (normalized === 'form' || normalized === 'chat' || normalized === 'voice' || normalized === 'api' || normalized === 'website') {
    return normalized;
  }
  return 'website';
}

function coerceServiceType(value: string): ServiceType | '' {
  if (value === 'window' || value === 'commercialWindow' || value === 'carpet' || value === 'postConstruction') {
    return value;
  }
  return '';
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ message: 'Method not allowed.' });
    return;
  }

  const supabase = await getSupabaseAdminClient();
  if (!supabase) {
    res.status(503).json({
      message: 'Supabase admin client is not configured.',
      records: [],
    });
    return;
  }

  const limitRaw = Number(asText(req.query?.limit) || '200');
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, Math.round(limitRaw))) : 200;
  const sourceFilter = asText(req.query?.source).toLowerCase();
  const serviceFilter = coerceServiceType(asText(req.query?.service_type));

  try {
    let query = supabase
      .from('estimate_records')
      .select('id, quote_number, created_at, source, service_type, postal_code, zone, contact, answers, result, pricing_version, utm')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (sourceFilter) {
      query = query.eq('source', sourceFilter);
    }

    if (serviceFilter) {
      query = query.eq('service_type', serviceFilter);
    }

    let { data, error } = await query;
    if (error && error.message.toLowerCase().includes('source') && error.message.toLowerCase().includes('column')) {
      let fallbackQuery = supabase
        .from('estimate_records')
        .select('id, quote_number, created_at, service_type, postal_code, zone, contact, answers, result, pricing_version, utm')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (serviceFilter) {
        fallbackQuery = fallbackQuery.eq('service_type', serviceFilter);
      }

      const fallbackResult = await fallbackQuery;
      data = fallbackResult.data;
      error = fallbackResult.error;
    }

    if (error) {
      res.status(500).json({ message: error.message, records: [] });
      return;
    }

    const rows = (data ?? []) as Array<EstimateRecordRow & { source?: string | null }>;
    const records = rows.map((row) => ({
      id: row.id,
      quoteNumber: row.quote_number,
      createdAt: row.created_at,
      source: coerceSource(row.source),
      serviceType: row.service_type,
      postalCode: row.postal_code,
      zone: row.zone,
      contact: row.contact,
      answers: row.answers,
      result: row.result,
      pricingVersion: row.pricing_version,
      utm: row.utm ?? {},
    }));

    res.status(200).json({
      records,
      count: records.length,
    });
  } catch (error) {
    res.status(500).json({
      message: error instanceof Error ? error.message : 'Unable to load estimate records.',
      records: [],
    });
  }
}
