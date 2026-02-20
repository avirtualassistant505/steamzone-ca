import {
  type SchemaField,
  buildQuestionText,
  getAnswerValue,
  getFieldOptions,
  getSchemaField,
  getEstimateSchema,
  type ServiceType,
} from './schema';

export interface NormalizeValidateResult {
  ok: boolean;
  normalized_value: unknown;
  error_message?: string;
  needs_clarification?: boolean;
  clarification_question?: string;
}

const yesTokens = new Set(['y', 'yes', 'yeah', 'yep', 'sure', 'ok', 'okay', 'affirmative', 'true', '1', 'please do']);
const noTokens = new Set(['n', 'no', 'nope', 'nah', 'negative', 'false', '0', 'dont', "don't"]);

const serviceSynonyms: Record<ServiceType, string[]> = {
  window: ['window', 'windows', 'residential window', 'residential windows', 'house windows'],
  commercialWindow: ['commercial window', 'commercial windows', 'storefront', 'office windows', 'business windows'],
  carpet: ['carpet', 'carpets', 'carpet cleaning'],
  postConstruction: ['post construction', 'post-construction', 'post construction cleaning', 'construction cleanup'],
};

function text(input: unknown): string {
  return String(input ?? '').trim();
}

function normalizeTextForMatch(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function parseYesNo(input: string): boolean | null {
  const normalized = normalizeTextForMatch(input);
  if (!normalized) return null;

  if (yesTokens.has(normalized)) return true;
  if (noTokens.has(normalized)) return false;

  if (/(^|\b)(yes|yep|yeah|sure|absolutely|certainly|correct|right|works)($|\b)/i.test(normalized)) return true;
  if (/(^|\b)(no|nope|nah|not really|dont|don't|decline|stop)($|\b)/i.test(normalized)) return false;

  return null;
}

function parseEmail(input: string): string | null {
  const hit = input.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return hit ? hit[0].trim().toLowerCase() : null;
}

function extractName(input: string): string | null {
  const cleaned = input.trim();
  const patterns = [
    /my name is\s+([^,.!?;]+)/i,
    /i['’]?m\s+([^,.!?;]+)/i,
    /i am\s+([^,.!?;]+)/i,
    /call me\s+([^,.!?;]+)/i,
    /name:\s*([^,.!?;]+)/i,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match?.[1]) {
      const parsed = match[1]
        .split(/\band\b|\bbut\b/i)[0]
        .trim();
      if (parsed.length >= 2) {
        return parsed;
      }
    }
  }

  return null;
}

function extractAddress(input: string): string | null {
  const match = input.match(/(?:address|at)\s+([^.,!?;]+)/i);
  if (!match?.[1]) {
    return null;
  }

  const parsed = match[1].trim();
  return parsed.length > 0 ? parsed : null;
}

function parsePostalCode(input: string): string | null {
  const hit = input.match(/[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d/);
  if (!hit) return null;
  const raw = hit[0].toUpperCase().replace(/\s+/g, '');
  return `${raw.slice(0, 3)} ${raw.slice(3)}`;
}

function parsePhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  if (digits.length < 7) return null;
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    const d = digits.slice(1);
    return `+1 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  return `+${digits}`;
}

function parseServiceType(input: string): ServiceType | null {
  const normalized = normalizeTextForMatch(input);
  const allServices = Object.keys(serviceSynonyms) as ServiceType[];

  for (const service of allServices) {
    if (normalized === service.toLowerCase()) {
      return service;
    }

    if (serviceSynonyms[service].some((phrase) => normalized.includes(phrase))) {
      return service;
    }
  }

  return null;
}

function findRange(input: string): { low: number; high: number } | null {
  const m = input.match(/(\d+(?:[.,]\d+)?)\s*(?:-|to)\s*(\d+(?:[.,]\d+)?)/i);
  if (!m) return null;

  const low = Number(m[1].replace(/,/g, ''));
  const high = Number(m[2].replace(/,/g, ''));
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;

  return { low, high };
}

function parseScaledNumber(token: string): number | null {
  const cleaned = token.toLowerCase().replace(/,/g, '').trim();
  if (!cleaned) return null;

  const match = cleaned.match(/^(-?\d+(?:\.\d+)?)(k)?$/i);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  return match[2] ? base * 1000 : base;
}

function extractInteger(input: string): number | null {
  const dimension = input.match(/(\d+(?:[.,]\d+)?)\s*[xX]\s*(\d+(?:[.,]\d+)?)\s*[xX]\s*(\d+(?:[.,]\d+)?)/);
  if (dimension) {
    const first = Number(dimension[1].replace(/,/g, ''));
    return Number.isFinite(first) ? Math.round(first) : null;
  }

  const roomsLike = input.match(/(\d+)\s*(bed(?:room)?s?)/i);
  if (roomsLike) return Number(roomsLike[1]);

  const tokens = input
    .replace(/sq\s*ft|sqft|square\s*feet|ft|feet|lbs?|pounds?|storeys?|stories?|levels?|steps?/gi, ' ')
    .split(/\s+/)
    .filter(Boolean);

  for (const token of tokens) {
    const parsed = parseScaledNumber(token);
    if (parsed !== null) {
      return Math.round(parsed);
    }
  }

  const fallback = input.match(/-?\d+(?:[.,]\d+)?/);
  if (!fallback) return null;
  const value = Number(fallback[0].replace(/,/g, ''));
  return Number.isFinite(value) ? Math.round(value) : null;
}

function coerceSelect(field: SchemaField, input: string, answersSoFar: Record<string, unknown>): string | null {
  const serviceType = (answersSoFar.serviceType as ServiceType | undefined) ?? undefined;
  const options = getFieldOptions(field, serviceType);
  const normalized = normalizeTextForMatch(input);

  if (!normalized) return null;

  for (const option of options) {
    if (normalizeTextForMatch(option.value) === normalized) return option.value;
    if (normalizeTextForMatch(option.label) === normalized) return option.value;
  }

  for (const option of options) {
    if (normalized.includes(normalizeTextForMatch(option.label))) return option.value;
    if (normalized.includes(normalizeTextForMatch(option.value))) return option.value;
  }

  // Small synonym support.
  if (field.key === 'scope') {
    if (normalized.includes('inside') && normalized.includes('outside')) return 'both';
    if (normalized.includes('interior')) return 'interior';
    if (normalized.includes('exterior') || normalized.includes('outside')) return 'exterior';
  }

  return null;
}

function conflictCheck(fieldKey: string, answers: Record<string, unknown>): string | null {
  if (fieldKey === 'slidingQuantity' && getAnswerValue(answers, 'slidingRemoval') === 'none') {
    return 'To set sliding quantity, choose a sliding removal type first.';
  }

  if (fieldKey === 'patioQuantity' && getAnswerValue(answers, 'patioDoors') === 'none') {
    return 'To set patio quantity, choose a patio door type first.';
  }

  if (fieldKey === 'skylightQuantity' && getAnswerValue(answers, 'skylights') === 'none') {
    return 'To set skylight quantity, choose a skylight option first.';
  }

  if (fieldKey === 'paneCount' && getAnswerValue(answers, 'sizeMode') !== 'paneCount') {
    return 'Pane count applies when size mode is pane count.';
  }

  if (fieldKey === 'frontageFeet' && getAnswerValue(answers, 'sizeMode') !== 'frontage') {
    return 'Frontage applies when size mode is frontage.';
  }

  if (fieldKey === 'rooms' && getAnswerValue(answers, 'estimateMode') !== 'rooms') {
    return 'Room count applies when estimate mode is rooms.';
  }

  if (fieldKey === 'sqftBracket' && getAnswerValue(answers, 'serviceType') === 'carpet' && getAnswerValue(answers, 'estimateMode') !== 'sqft') {
    return 'Square footage bracket applies when carpet estimate mode is square footage.';
  }

  return null;
}

function validateParsedValue(field: SchemaField, value: unknown): string | undefined {
  const rules = field.validation ?? {};

  if (field.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'Please enter a valid whole number.';
    if (typeof rules.min === 'number' && value < rules.min) return `Value must be at least ${rules.min}.`;
    if (typeof rules.max === 'number' && value > rules.max) return `Value must be at most ${rules.max}.`;
  }

  if (field.type === 'string') {
    const s = String(value ?? '').trim();
    if (typeof rules.minLength === 'number' && s.length < rules.minLength) return `Please provide at least ${rules.minLength} characters.`;
    if (typeof rules.maxLength === 'number' && s.length > rules.maxLength) return `Please keep it under ${rules.maxLength} characters.`;
  }

  if (field.type === 'email') {
    const s = String(value ?? '').trim();
    const regex = rules.regex ? new RegExp(String(rules.regex)) : /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!regex.test(s)) return 'Please enter a valid email address.';
  }

  if (field.type === 'postalCode') {
    const s = String(value ?? '').trim();
    const regex = rules.regex ? new RegExp(String(rules.regex)) : /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/;
    if (!regex.test(s)) return 'Please enter a valid Canadian postal code (e.g., R5G 2X3).';
  }

  if (field.type === 'phone') {
    const digits = String(value ?? '').replace(/\D/g, '');
    if (typeof rules.minDigits === 'number' && digits.length < rules.minDigits) return 'Please enter a valid phone number.';
    if (typeof rules.maxDigits === 'number' && digits.length > rules.maxDigits) return 'Phone number is too long.';
  }

  if (field.type === 'boolean' && rules.mustBeTrue === true && value !== true) {
    return 'This permission is required to proceed.';
  }

  if (field.type === 'select') {
    const serviceType = (value && typeof value === 'string' && value) ? null : null;
    void serviceType;
  }

  return undefined;
}

export function normalizeAndValidateField(
  fieldKey: string,
  userText: string,
  answersSoFar: Record<string, unknown>
): NormalizeValidateResult {
  const field = getSchemaField(fieldKey);
  if (!field) {
    return {
      ok: false,
      normalized_value: null,
      error_message: `Unknown field: ${fieldKey}.`,
    };
  }

  const raw = text(userText);
  if (!raw) {
    return {
      ok: false,
      normalized_value: null,
      needs_clarification: true,
      clarification_question: `Please provide ${field.label.toLowerCase()}.`,
      error_message: `${field.label} is required.`,
    };
  }

  if (/same as last time|as before|like before/i.test(raw)) {
    return {
      ok: false,
      normalized_value: null,
      needs_clarification: true,
      clarification_question: `I do not have prior-job memory in this flow. ${buildQuestionText(field, answersSoFar)}`,
      error_message: 'Please provide the value directly.',
    };
  }

  const range = findRange(raw);
  if (range && field.type === 'integer') {
    return {
      ok: false,
      normalized_value: null,
      needs_clarification: true,
      clarification_question: `You gave a range (${range.low}-${range.high}). What exact value should I use for ${field.label.toLowerCase()}?`,
      error_message: 'Range is ambiguous.',
    };
  }

  let normalizedValue: unknown = raw;

  if (field.key === 'serviceType') {
    normalizedValue = parseServiceType(raw);
  } else if (field.type === 'boolean') {
    normalizedValue = parseYesNo(raw);
  } else if (field.type === 'postalCode') {
    normalizedValue = parsePostalCode(raw);
  } else if (field.type === 'email') {
    normalizedValue = parseEmail(raw);
  } else if (field.type === 'phone') {
    normalizedValue = parsePhone(raw);
  } else if (field.type === 'integer') {
    normalizedValue = extractInteger(raw);
  } else if (field.type === 'select') {
    normalizedValue = coerceSelect(field, raw, answersSoFar);
  } else if (field.type === 'string') {
    if (field.key === 'contact.fullName') {
      normalizedValue = extractName(raw) ?? raw.trim();
    } else if (field.key === 'contact.address') {
      normalizedValue = extractAddress(raw) ?? raw.trim();
    } else {
      normalizedValue = raw.trim();
    }
  }

  if (normalizedValue === null || normalizedValue === undefined || normalizedValue === '') {
    return {
      ok: false,
      normalized_value: null,
      needs_clarification: true,
      clarification_question: buildQuestionText(field, answersSoFar),
      error_message: `I couldn't interpret that as ${field.label.toLowerCase()}.`,
    };
  }

  const prospectiveAnswers = structuredClone(answersSoFar);
  const chunks = fieldKey.split('.');
  let cursor: Record<string, unknown> = prospectiveAnswers;
  for (let i = 0; i < chunks.length - 1; i += 1) {
    const part = chunks[i];
    const existing = cursor[part];
    if (!existing || typeof existing !== 'object') {
      cursor[part] = {};
    }
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[chunks[chunks.length - 1]] = normalizedValue;

  const conflict = conflictCheck(fieldKey, prospectiveAnswers);
  if (conflict) {
    return {
      ok: false,
      normalized_value: normalizedValue,
      needs_clarification: true,
      clarification_question: conflict,
      error_message: conflict,
    };
  }

  const validationError = validateParsedValue(field, normalizedValue);
  if (validationError) {
    return {
      ok: false,
      normalized_value: normalizedValue,
      needs_clarification: true,
      clarification_question: `${validationError} ${buildQuestionText(field, answersSoFar)}`,
      error_message: validationError,
    };
  }

  return {
    ok: true,
    normalized_value: normalizedValue,
  };
}

export function validateAnswerValue(fieldKey: string, value: unknown, answersSoFar: Record<string, unknown>): string | null {
  const field = getSchemaField(fieldKey);
  if (!field) return `Unknown field: ${fieldKey}`;

  const conflict = conflictCheck(fieldKey, { ...answersSoFar, [fieldKey]: value });
  if (conflict) return conflict;

  const error = validateParsedValue(field, value);
  return error ?? null;
}

export function validateRequiredAnswers(answers: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const schema = getEstimateSchema();

  for (const field of schema.fields) {
    if (!field.required) continue;

    const visibleField = (() => {
      // Re-run visibility from schema module by using normalizeAndValidateField fallback.
      const serviceType = answers.serviceType as ServiceType | undefined;
      if (!serviceType && field.key !== 'serviceType') return false;
      if (serviceType && !field.appliesTo.includes(serviceType)) return false;

      const allRules = field.conditional?.all ?? [];
      const allOk = allRules.every((rule) => {
        const currentValue = getAnswerValue(answers, rule.key);
        if (Object.prototype.hasOwnProperty.call(rule, 'equals') && currentValue !== rule.equals) return false;
        if (Object.prototype.hasOwnProperty.call(rule, 'notEquals') && currentValue === rule.notEquals) return false;
        if (rule.in && !rule.in.includes(currentValue)) return false;
        if (rule.notIn && rule.notIn.includes(currentValue)) return false;
        if (typeof rule.exists === 'boolean') {
          const exists = currentValue !== undefined && currentValue !== null && currentValue !== '';
          if (exists !== rule.exists) return false;
        }
        return true;
      });

      const anyRules = field.conditional?.any ?? [];
      const anyOk = anyRules.length === 0 || anyRules.some((rule) => {
        const currentValue = getAnswerValue(answers, rule.key);
        if (Object.prototype.hasOwnProperty.call(rule, 'equals') && currentValue === rule.equals) return true;
        if (Object.prototype.hasOwnProperty.call(rule, 'notEquals') && currentValue !== rule.notEquals) return true;
        if (rule.in && rule.in.includes(currentValue)) return true;
        if (rule.notIn && !rule.notIn.includes(currentValue)) return true;
        if (typeof rule.exists === 'boolean') {
          const exists = currentValue !== undefined && currentValue !== null && currentValue !== '';
          if (exists === rule.exists) return true;
        }
        return false;
      });

      return allOk && anyOk;
    })();

    if (!visibleField) continue;

    const currentValue = getAnswerValue(answers, field.key);
    const missing = currentValue === undefined || currentValue === null || currentValue === '';
    if (missing) {
      errors.push(`${field.key}: missing required value`);
      continue;
    }

    const fieldError = validateAnswerValue(field.key, currentValue, answers);
    if (fieldError) {
      errors.push(`${field.key}: ${fieldError}`);
    }
  }

  return errors;
}
