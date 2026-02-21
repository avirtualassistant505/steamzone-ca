import estimateFormSchemaJson from './estimateFormSchema.json' with { type: 'json' };

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
  const formatOptions = () => options.map((opt) => opt.label).join(', ');

  if (field.key === 'serviceType') {
    return `What service are you looking to estimate? ${formatOptions()}.`;
  }

  if (field.key === 'postalCode') {
    return 'What is the postal code for the property? (Example: R5G 2X3)';
  }

  if (field.key === 'zone') {
    return `Which travel zone applies? ${formatOptions()}`;
  }

  if (field.key === 'storey') {
    return `What is the house type/storey? ${formatOptions()}`;
  }

  if (field.key === 'sizeBracket') {
    return `What is the square footage bracket for this home? ${formatOptions()}`;
  }

  if (field.key === 'scope') {
    return `What cleaning scope do you need? ${formatOptions()}`;
  }

  if (field.key === 'screens') {
    return `How many screens are you including? ${formatOptions()}`;
  }

  if (field.key === 'tracks') {
    return `For tracks and sills, how would you like it handled? ${formatOptions()}`;
  }

  if (field.key === 'slidingRemoval') {
    return `Do you need sliding windows removed for cleaning? ${formatOptions()}`;
  }

  if (field.key === 'patioDoors') {
    return `How do you want patio doors handled? ${formatOptions()}`;
  }

  if (field.key === 'skylights') {
    return `How many skylights are there and what scope do you need? ${formatOptions()}`;
  }

  if (field.key === 'railingGlass') {
    return `Will railing glass be included? ${formatOptions()}`;
  }

  if (field.key === 'frenchPanes') {
    return `How many french panes are there? ${formatOptions()}`;
  }

  if (field.key === 'buildingType') {
    return `What type of building is this? ${formatOptions()}`;
  }

  if (field.key === 'storeys') {
    return `How many storeys is this building? ${formatOptions()}`;
  }

  if (field.key === 'sizeMode') {
    return `How should we measure size: ${formatOptions()}`;
  }

  if (field.key === 'paneCount') {
    return `How many panes are we cleaning?`;
  }

  if (field.key === 'frontageFeet') {
    return `What is the frontage length in feet?`;
  }

  if (field.key === 'estimateMode') {
    return `How would you like to measure carpet estimate (${formatOptions()})?`;
  }

  if (field.key === 'rooms') {
    return `How many bedrooms/rooms are you estimating?`;
  }

  if (field.key === 'sqftBracket') {
    return `What square-footage bracket fits this project? ${formatOptions()}`;
  }

  if (field.key === 'condition') {
    return `What is the soil/condition level? ${formatOptions()}`;
  }

  if (field.key === 'furnitureMoving') {
    return `How heavy is furniture moving expected to be? ${formatOptions()}`;
  }

  if (field.key === 'projectType') {
    return `Is this a residential or commercial post-construction project? ${formatOptions()}`;
  }

  if (field.key === 'buildType') {
    return `Is this renovation or new build?`;
  }

  if (field.key === 'floors') {
    return 'How many floors/levels are involved?';
  }

  if (field.key === 'stage') {
    return `Which cleanup stage is this project in? ${formatOptions()}`;
  }

  if (field.key === 'dustLoad') {
    return `How heavy is the dust/debris load? ${formatOptions()}`;
  }

  if (field.key === 'contact.fullName') {
    return `Could I have your full name?`;
  }

  if (field.key === 'contact.phone') {
    return `What is the best callback phone number?`;
  }

  if (field.key === 'contact.email') {
    return `What is your email address so we can send your estimate?`;
  }

  if (field.key === 'contact.address') {
    return `What is the service address? (optional)`;
  }

  if (field.key === 'contact.consentToContact') {
    return `Do I have your permission to contact you about this estimate?`;
  }

  if (field.key === 'contact.marketingOptIn') {
    return `Would you like to receive occasional offers and updates?`;
  }

  if (field.key === 'schedule') {
    return `When is the best time for us to work with you?`;
  }

  if (field.type === 'select' && options.length > 0) {
    return `${field.label}: ${formatOptions()}`;
  }

  if (field.type === 'boolean') {
    return `${field.label}? (Yes/No)`;
  }

  return field.label;
}
