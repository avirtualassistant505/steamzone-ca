import estimateFormSchemaJson from './estimateFormSchema.json';

export type ServiceType = 'window' | 'commercialWindow' | 'carpet' | 'postConstruction';

export type SchemaFieldType =
  | 'select'
  | 'boolean'
  | 'integer'
  | 'string'
  | 'email'
  | 'phone'
  | 'postalCode';

export interface SchemaConditionRule {
  key: string;
  equals?: unknown;
  notEquals?: unknown;
  in?: unknown[];
  notIn?: unknown[];
  exists?: boolean;
}

export interface SchemaCondition {
  all?: SchemaConditionRule[];
  any?: SchemaConditionRule[];
}

export interface SchemaOption {
  value: string;
  label: string;
}

export interface SchemaField {
  key: string;
  label: string;
  type: SchemaFieldType;
  required: boolean;
  step: number;
  appliesTo: ServiceType[];
  options?: SchemaOption[];
  optionsByService?: Partial<Record<ServiceType, SchemaOption[]>>;
  validation?: Record<string, unknown>;
  conditional?: SchemaCondition;
  helpText?: string;
  examples?: string[];
}

export interface EstimateFormSchema {
  version: string;
  title: string;
  services: Array<{
    key: ServiceType;
    label: string;
    steps: string[];
  }>;
  fields: SchemaField[];
}

const estimateFormSchema = estimateFormSchemaJson as EstimateFormSchema;

const fieldMap = new Map(estimateFormSchema.fields.map((field) => [field.key, field]));

function getPathValue(obj: Record<string, unknown>, path: string): unknown {
  const pieces = path.split('.');
  let current: unknown = obj;

  for (const piece of pieces) {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[piece];
  }

  return current;
}

function setPathValue(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const pieces = path.split('.');
  const out = structuredClone(obj);
  let current: Record<string, unknown> = out;

  for (let i = 0; i < pieces.length - 1; i += 1) {
    const piece = pieces[i];
    const existing = current[piece];
    if (!existing || typeof existing !== 'object') {
      current[piece] = {};
    }
    current = current[piece] as Record<string, unknown>;
  }

  const leaf = pieces[pieces.length - 1];
  current[leaf] = value;
  return out;
}

function deletePathValue(obj: Record<string, unknown>, path: string): Record<string, unknown> {
  const pieces = path.split('.');
  const out = structuredClone(obj);
  let current: Record<string, unknown> | null = out;

  for (let i = 0; i < pieces.length - 1; i += 1) {
    if (!current) break;
    const next = current[pieces[i]];
    if (!next || typeof next !== 'object') {
      current = null;
      break;
    }
    current = next as Record<string, unknown>;
  }

  if (current) {
    delete current[pieces[pieces.length - 1]];
  }

  return out;
}

function evaluateRule(rule: SchemaConditionRule, answers: Record<string, unknown>): boolean {
  const value = getPathValue(answers, rule.key);

  if (typeof rule.exists === 'boolean') {
    const exists = value !== undefined && value !== null && value !== '';
    if (exists !== rule.exists) return false;
  }

  if (Object.prototype.hasOwnProperty.call(rule, 'equals') && value !== rule.equals) {
    return false;
  }

  if (Object.prototype.hasOwnProperty.call(rule, 'notEquals') && value === rule.notEquals) {
    return false;
  }

  if (rule.in && !rule.in.includes(value)) {
    return false;
  }

  if (rule.notIn && rule.notIn.includes(value)) {
    return false;
  }

  return true;
}

export function evaluateCondition(condition: SchemaCondition | undefined, answers: Record<string, unknown>): boolean {
  if (!condition) return true;

  const allPass = (condition.all ?? []).every((rule) => evaluateRule(rule, answers));
  const anyRules = condition.any ?? [];
  const anyPass = anyRules.length === 0 ? true : anyRules.some((rule) => evaluateRule(rule, answers));

  return allPass && anyPass;
}

export function getEstimateSchema(): EstimateFormSchema {
  return estimateFormSchema;
}

export function getSchemaField(fieldKey: string): SchemaField | undefined {
  return fieldMap.get(fieldKey);
}

export function getFieldOptions(field: SchemaField, serviceType: ServiceType | undefined): SchemaOption[] {
  if (serviceType && field.optionsByService?.[serviceType]) {
    return field.optionsByService[serviceType] ?? [];
  }
  return field.options ?? [];
}

export function isFieldVisible(field: SchemaField, answers: Record<string, unknown>): boolean {
  const serviceType = (answers.serviceType as ServiceType | undefined) ?? undefined;
  if (serviceType && !field.appliesTo.includes(serviceType)) {
    return false;
  }

  // Before serviceType is chosen, only show fields that apply to all services and step 0/service prompt.
  if (!serviceType && field.key !== 'serviceType') {
    return false;
  }

  return evaluateCondition(field.conditional, answers);
}

export function isFieldRequired(field: SchemaField, answers: Record<string, unknown>): boolean {
  return field.required && isFieldVisible(field, answers);
}

export function getVisibleFieldsInOrder(answers: Record<string, unknown>): SchemaField[] {
  return estimateFormSchema.fields.filter((field) => isFieldVisible(field, answers));
}

export function getRequiredVisibleFieldsInOrder(answers: Record<string, unknown>): SchemaField[] {
  return estimateFormSchema.fields.filter((field) => isFieldRequired(field, answers));
}

export function getAnswerValue(answers: Record<string, unknown>, key: string): unknown {
  return getPathValue(answers, key);
}

export function withAnswerValue(answers: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> {
  return setPathValue(answers, key, value);
}

export function withoutAnswerValue(answers: Record<string, unknown>, key: string): Record<string, unknown> {
  return deletePathValue(answers, key);
}

export function isAnswered(field: SchemaField, answers: Record<string, unknown>): boolean {
  const value = getAnswerValue(answers, field.key);

  if (value === undefined || value === null) return false;
  if (field.type === 'string' || field.type === 'email' || field.type === 'phone' || field.type === 'postalCode') {
    return String(value).trim().length > 0;
  }

  return true;
}

export function buildInputUiHint(field: SchemaField, answers: Record<string, unknown>): {
  type: string;
  options?: SchemaOption[];
  min?: number;
  max?: number;
  placeholder?: string;
} {
  if (field.type === 'select') {
    const serviceType = (answers.serviceType as ServiceType | undefined) ?? undefined;
    return {
      type: 'select',
      options: getFieldOptions(field, serviceType),
    };
  }

  if (field.type === 'boolean') {
    return {
      type: 'boolean',
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
      ],
    };
  }

  if (field.type === 'integer') {
    return {
      type: 'number',
      min: typeof field.validation?.min === 'number' ? (field.validation.min as number) : 0,
      max: typeof field.validation?.max === 'number' ? (field.validation.max as number) : undefined,
      placeholder: field.examples?.[0],
    };
  }

  return {
    type: 'text',
    placeholder: field.examples?.[0],
  };
}

export function pruneInvisibleAnswers(answers: Record<string, unknown>): Record<string, unknown> {
  let out = structuredClone(answers);

  for (const field of estimateFormSchema.fields) {
    if (field.key === 'serviceType') continue;
    if (!isFieldVisible(field, out)) {
      out = withoutAnswerValue(out, field.key);
    }
  }

  return out;
}

export function buildQuestionText(field: SchemaField, answers: Record<string, unknown>): string {
  const options = getFieldOptions(field, (answers.serviceType as ServiceType | undefined) ?? undefined);
  if (field.type === 'select' && options.length > 0) {
    return `${field.label}: ${options.map((opt) => opt.label).join(', ')}`;
  }

  if (field.type === 'boolean') {
    return `${field.label}? (Yes/No)`;
  }

  return field.label;
}
