import type { LeadContact, ServiceType, WindowZone } from '../src/lib/estimateEngine.js';
import { getSchemaField, isAnswered, isFieldRequired, buildQuestionText, getAnswerValue } from '../src/quote/schema.js';
import { normalizeAndValidateField, validateAnswerValue } from '../src/quote/normalization.js';
import { strictFieldOrderByService } from './strictEstimateFieldOrder.js';

type EngineModule = {
  detectZoneFromPostalCode: (postalCode: string) => WindowZone;
};

let enginePromise: Promise<EngineModule> | null = null;

async function getEngine(): Promise<EngineModule> {
  if (!enginePromise) {
    enginePromise = import('./estimateEngineRuntime.mjs').then((mod) => mod as unknown as EngineModule);
  }
  return enginePromise;
}

const postalCodeRegex = /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function safeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function asBool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value !== 'string') return null;
  const s = value.trim().toLowerCase();
  if (!s) return null;
  if (['1', 'true', 'yes', 'y', 'on', 'agree', 'agreed'].includes(s)) return true;
  if (['0', 'false', 'no', 'n', 'off', 'disagree', 'decline', 'declined'].includes(s)) return false;
  return null;
}

function coerceServiceType(value: unknown): ServiceType | null {
  const normalized = safeString(value).toLowerCase();
  if (normalized === 'window') return 'window';
  if (normalized === 'commercialwindow' || normalized === 'commercial window') return 'commercialWindow';
  if (normalized === 'carpet') return 'carpet';
  if (normalized === 'postconstruction' || normalized === 'post construction' || normalized === 'post-construction') return 'postConstruction';
  return null;
}

function normalizePostalCode(value: unknown): string | null {
  const raw = safeString(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.length !== 6) return null;
  const formatted = `${raw.slice(0, 3)} ${raw.slice(3)}`;
  return postalCodeRegex.test(formatted) ? formatted : null;
}

function getNestedValue(source: Record<string, unknown>, key: string): unknown {
  if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
  const chunks = key.split('.');
  let current: unknown = source;
  for (const chunk of chunks) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[chunk];
  }
  return current;
}

function setNestedValue(target: Record<string, unknown>, key: string, value: unknown): void {
  const chunks = key.split('.');
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < chunks.length - 1; i += 1) {
    const part = chunks[i];
    const existing = cursor[part];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      cursor[part] = {};
    }
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[chunks[chunks.length - 1]] = value;
}

function buildContact(raw: Record<string, unknown>): LeadContact {
  const nestedContact = asRecord(raw.contact) ?? {};
  const consent = asBool(raw.consentToContact) ?? asBool(nestedContact.consentToContact) ?? false;
  const marketing = asBool(raw.marketingOptIn) ?? asBool(nestedContact.marketingOptIn) ?? false;
  return {
    fullName: safeString(raw.fullName) || safeString(nestedContact.fullName) || safeString(raw.name),
    phone: safeString(raw.phone) || safeString(nestedContact.phone),
    email: safeString(raw.email) || safeString(nestedContact.email),
    address: safeString(raw.address) || safeString(nestedContact.address),
    consentToContact: consent,
    marketingOptIn: marketing,
  };
}

function seedNormalizedAnswers(serviceType: ServiceType, postalCode: string, zone: WindowZone, contact: LeadContact): Record<string, unknown> {
  return {
    serviceType,
    postalCode,
    zone,
    contact: {
      fullName: contact.fullName,
      phone: contact.phone,
      email: contact.email,
      address: contact.address,
      consentToContact: contact.consentToContact,
      marketingOptIn: contact.marketingOptIn,
    },
  };
}

export interface VoiceEstimateValidationResult {
  ok: boolean;
  serviceType: ServiceType | null;
  postalCode: string | null;
  zone: WindowZone | null;
  missingFields: string[];
  invalidFields: Array<{ key: string; error: string }>;
  nextFieldKey: string | null;
  nextQuestion: string | null;
  clarificationQuestion: string | null;
  normalizedAnswers: Record<string, unknown>;
}

export async function validateVoiceEstimateSnapshot(rawInput: unknown): Promise<VoiceEstimateValidationResult> {
  const raw = asRecord(rawInput) ?? {};
  const serviceType = coerceServiceType(raw.serviceType);
  const postalCode = normalizePostalCode(raw.postalCode);
  const contact = buildContact(raw);
  const zone = postalCode ? (await getEngine()).detectZoneFromPostalCode(postalCode) : null;

  if (!serviceType) {
    return {
      ok: false,
      serviceType: null,
      postalCode,
      zone,
      missingFields: ['serviceType'],
      invalidFields: [],
      nextFieldKey: 'serviceType',
      nextQuestion: 'What service are you looking to estimate: residential windows, commercial windows, carpet cleaning, or post-construction?',
      clarificationQuestion: 'What service are you looking to estimate: residential windows, commercial windows, carpet cleaning, or post-construction?',
      normalizedAnswers: {},
    };
  }

  if (!postalCode) {
    return {
      ok: false,
      serviceType,
      postalCode: null,
      zone: null,
      missingFields: ['postalCode'],
      invalidFields: [],
      nextFieldKey: 'postalCode',
      nextQuestion: 'What is the postal code for the property? (Example: R5G 2X3)',
      clarificationQuestion: 'What is the postal code for the property? (Example: R5G 2X3)',
      normalizedAnswers: { serviceType },
    };
  }

  const normalized = seedNormalizedAnswers(serviceType, postalCode, zone!, contact);
  const invalidClarifications = new Map<string, string>();

  for (const key of strictFieldOrderByService[serviceType]) {
    let rawValue = getNestedValue(raw, key);
    if (rawValue === undefined) {
      const topLevelKey = key.startsWith('contact.') ? key.slice('contact.'.length) : key;
      rawValue = raw[topLevelKey];
    }
    if (rawValue === undefined || rawValue === null || rawValue === '') continue;

    const textValue = typeof rawValue === 'string' ? rawValue : String(rawValue);
    if (!textValue.trim()) continue;

    const parsed = normalizeAndValidateField(key, textValue, normalized);
    if (parsed.ok) {
      setNestedValue(normalized, key, parsed.normalized_value);
    } else if (parsed.error_message) {
      invalidClarifications.set(key, parsed.clarification_question || parsed.error_message);
    }
  }

  const missingFields: string[] = [];
  const invalidFields: Array<{ key: string; error: string }> = [];
  let nextFieldKey: string | null = null;
  let nextQuestion: string | null = null;
  let clarificationQuestion: string | null = null;

  for (const key of strictFieldOrderByService[serviceType]) {
    const field = getSchemaField(key);
    if (!field) continue;
    const isVoiceRequiredAddress = key === 'contact.address';
    if (!isVoiceRequiredAddress && !isFieldRequired(field, normalized)) continue;

    const value = getAnswerValue(normalized, key);
    const invalidMessage = invalidClarifications.get(key) ?? (value !== undefined ? validateAnswerValue(key, value, normalized) ?? undefined : undefined);

    if (!isAnswered(field, normalized)) {
      missingFields.push(key);
      if (!nextFieldKey) {
        nextFieldKey = key;
        nextQuestion = buildQuestionText(field, normalized);
        clarificationQuestion = nextQuestion;
      }
      continue;
    }

    if (invalidMessage) {
      invalidFields.push({ key, error: invalidMessage });
      if (!nextFieldKey) {
        nextFieldKey = key;
        nextQuestion = buildQuestionText(field, normalized);
        clarificationQuestion = invalidMessage;
      }
    }
  }

  return {
    ok: missingFields.length === 0 && invalidFields.length === 0,
    serviceType,
    postalCode,
    zone,
    missingFields,
    invalidFields,
    nextFieldKey,
    nextQuestion,
    clarificationQuestion,
    normalizedAnswers: normalized,
  };
}

export function summarizeVoiceValidation(result: VoiceEstimateValidationResult): string {
  if (result.ok) {
    return 'All required estimate fields are present and valid.';
  }

  const parts: string[] = [];
  if (result.missingFields.length > 0) {
    parts.push(`Missing: ${result.missingFields.join(', ')}`);
  }
  if (result.invalidFields.length > 0) {
    parts.push(`Invalid: ${result.invalidFields.map((entry) => `${entry.key} (${entry.error})`).join(', ')}`);
  }
  if (result.nextFieldKey && result.nextQuestion) {
    parts.push(`Next: ${result.nextFieldKey} -> ${result.nextQuestion}`);
  }
  return parts.join(' | ');
}
