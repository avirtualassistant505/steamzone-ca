import {
  calculateEstimate,
  createDefaultCarpetInput,
  createDefaultCommercialWindowInput,
  createDefaultPostConstructionInput,
  createDefaultWindowInput,
  detectZoneFromPostalCode,
  formatBookingMode,
  formatConfidence,
  type CarpetEstimateInput,
  type CommercialWindowEstimateInput,
  type PostConstructionEstimateInput,
  type ServiceType,
  type WindowEstimateInput,
  type WindowZone,
} from '../lib/estimateEngine.js';
import { loadActivePricingConfig } from '../../server/pricingStore.js';
import { getAnswerValue } from './schema.js';

export interface QuoteLineItem {
  label: string;
  amount: number;
}

export interface QuoteOutput {
  quote_id: string;
  total: number;
  currency: 'CAD';
  line_items: QuoteLineItem[];
  assumptions: string[];
  answers_echo: Record<string, unknown>;
  version: 'v1';
}

function generateQuoteId(): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `Q-${stamp}-${suffix}`;
}

function assertFiniteAmount(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`Quote computation produced non-finite value for ${label}.`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stripInternalAnswerKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stripInternalAnswerKeys(entry));
  }

  if (!isObject(value)) {
    return value;
  }

  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (key.startsWith('__')) {
      continue;
    }
    out[key] = stripInternalAnswerKeys(nested);
  }
  return out;
}

function readAnswer<T>(answers: Record<string, unknown>, key: string, fallback: T): T {
  const value = getAnswerValue(answers, key);
  return (value === undefined ? fallback : (value as T));
}

function parseWindowZone(value: unknown): WindowZone | null {
  const raw = String(value ?? '').trim();
  if (raw === 'zoneA' || raw === 'zoneB' || raw === 'zoneC' || raw === 'zoneD') {
    return raw;
  }
  return null;
}

function resolveZoneFromPostal(answers: Record<string, unknown>, fallback: WindowZone): WindowZone {
  // Respect an explicit zone answer first. The website flow auto-detects from postal code,
  // then allows a manual adjustment when a customer is near a boundary.
  const explicit = parseWindowZone(readAnswer(answers, 'zone', ''));
  if (explicit) {
    return explicit;
  }

  const postalCode = String(readAnswer(answers, 'postalCode', '')).trim();
  if (postalCode.length >= 3) {
    return detectZoneFromPostalCode(postalCode);
  }

  return fallback;
}

function readContact(answers: Record<string, unknown>) {
  return {
    fullName: String(readAnswer(answers, 'contact.fullName', '')).trim(),
    address: String(readAnswer(answers, 'contact.address', '')).trim(),
    phone: String(readAnswer(answers, 'contact.phone', '')).trim(),
    email: String(readAnswer(answers, 'contact.email', '')).trim(),
    consentToContact: Boolean(readAnswer(answers, 'contact.consentToContact', false)),
    marketingOptIn: Boolean(readAnswer(answers, 'contact.marketingOptIn', false)),
  };
}

function buildInputFromAnswers(answers: Record<string, unknown>): {
  serviceType: ServiceType;
  normalizedInput: WindowEstimateInput | CommercialWindowEstimateInput | CarpetEstimateInput | PostConstructionEstimateInput;
} {
  const serviceType = String(readAnswer(answers, 'serviceType', '')) as ServiceType;

  if (serviceType === 'window') {
    const defaults = createDefaultWindowInput();
    const input: WindowEstimateInput = {
      ...defaults,
      postalCode: String(readAnswer(answers, 'postalCode', defaults.postalCode)).trim(),
      zone: resolveZoneFromPostal(answers, defaults.zone),
      storey: readAnswer(answers, 'storey', defaults.storey),
      sizeBracket: readAnswer(answers, 'sizeBracket', defaults.sizeBracket),
      scope: readAnswer(answers, 'scope', defaults.scope),
      screens: readAnswer(answers, 'screens', defaults.screens),
      tracks: readAnswer(answers, 'tracks', defaults.tracks),
      hardToReach: Boolean(readAnswer(answers, 'hardToReach', defaults.hardToReach)),
      hardWaterRemoval: Boolean(readAnswer(answers, 'hardWaterRemoval', defaults.hardWaterRemoval)),
      constructionDebris: Boolean(readAnswer(answers, 'constructionDebris', defaults.constructionDebris)),
      slidingRemoval: readAnswer(answers, 'slidingRemoval', defaults.slidingRemoval),
      slidingQuantity: Number(readAnswer(answers, 'slidingQuantity', defaults.slidingQuantity)),
      patioDoors: readAnswer(answers, 'patioDoors', defaults.patioDoors),
      patioQuantity: Number(readAnswer(answers, 'patioQuantity', defaults.patioQuantity)),
      skylights: readAnswer(answers, 'skylights', defaults.skylights),
      skylightQuantity: Number(readAnswer(answers, 'skylightQuantity', defaults.skylightQuantity)),
      railingGlass: readAnswer(answers, 'railingGlass', defaults.railingGlass),
      frenchPanes: readAnswer(answers, 'frenchPanes', defaults.frenchPanes),
      sunroom: Boolean(readAnswer(answers, 'sunroom', defaults.sunroom)),
      walkoutBasement: Boolean(readAnswer(answers, 'walkoutBasement', defaults.walkoutBasement)),
      contact: readContact(answers),
    };

    return { serviceType, normalizedInput: input };
  }

  if (serviceType === 'commercialWindow') {
    const defaults = createDefaultCommercialWindowInput();
    const input: CommercialWindowEstimateInput = {
      ...defaults,
      postalCode: String(readAnswer(answers, 'postalCode', defaults.postalCode)).trim(),
      zone: resolveZoneFromPostal(answers, defaults.zone),
      buildingType: readAnswer(answers, 'buildingType', defaults.buildingType),
      storeys: readAnswer(answers, 'storeys', defaults.storeys),
      sizeMode: readAnswer(answers, 'sizeMode', defaults.sizeMode),
      paneCount: Number(readAnswer(answers, 'paneCount', defaults.paneCount)),
      frontageFeet: Number(readAnswer(answers, 'frontageFeet', defaults.frontageFeet)),
      glassDoors: Number(readAnswer(answers, 'glassDoors', defaults.glassDoors)),
      scope: readAnswer(answers, 'scope', defaults.scope),
      frequency: readAnswer(answers, 'frequency', defaults.frequency),
      liftRequired: Boolean(readAnswer(answers, 'liftRequired', defaults.liftRequired)),
      afterHours: Boolean(readAnswer(answers, 'afterHours', defaults.afterHours)),
      overspray: Boolean(readAnswer(answers, 'overspray', defaults.overspray)),
      hardWater: Boolean(readAnswer(answers, 'hardWater', defaults.hardWater)),
      contact: readContact(answers),
    };

    return { serviceType, normalizedInput: input };
  }

  if (serviceType === 'carpet') {
    const defaults = createDefaultCarpetInput();
    const input: CarpetEstimateInput = {
      ...defaults,
      postalCode: String(readAnswer(answers, 'postalCode', defaults.postalCode)).trim(),
      zone: resolveZoneFromPostal(answers, defaults.zone),
      estimateMode: readAnswer(answers, 'estimateMode', defaults.estimateMode),
      rooms: Number(readAnswer(answers, 'rooms', defaults.rooms)),
      sqftBracket: readAnswer(answers, 'sqftBracket', defaults.sqftBracket),
      condition: readAnswer(answers, 'condition', defaults.condition),
      stairsSteps: Number(readAnswer(answers, 'stairsSteps', defaults.stairsSteps)),
      hallways: Number(readAnswer(answers, 'hallways', defaults.hallways)),
      advancedStainRemoval: Boolean(readAnswer(answers, 'advancedStainRemoval', defaults.advancedStainRemoval)),
      odorElimination: Boolean(readAnswer(answers, 'odorElimination', defaults.odorElimination)),
      petTreatment: Boolean(readAnswer(answers, 'petTreatment', defaults.petTreatment)),
      stainProtector: Boolean(readAnswer(answers, 'stainProtector', defaults.stainProtector)),
      furnitureMoving: readAnswer(answers, 'furnitureMoving', defaults.furnitureMoving),
      unusualCondition: Boolean(readAnswer(answers, 'unusualCondition', defaults.unusualCondition)),
      schedule: readAnswer(answers, 'schedule', defaults.schedule),
      contact: readContact(answers),
    };

    return { serviceType, normalizedInput: input };
  }

  if (serviceType === 'postConstruction') {
    const defaults = createDefaultPostConstructionInput();
    const input: PostConstructionEstimateInput = {
      ...defaults,
      postalCode: String(readAnswer(answers, 'postalCode', defaults.postalCode)).trim(),
      zone: resolveZoneFromPostal(answers, defaults.zone),
      projectType: readAnswer(answers, 'projectType', defaults.projectType),
      buildType: readAnswer(answers, 'buildType', defaults.buildType),
      sqftBracket: readAnswer(answers, 'sqftBracket', defaults.sqftBracket),
      floors: Number(readAnswer(answers, 'floors', defaults.floors)),
      stage: readAnswer(answers, 'stage', defaults.stage),
      dustLoad: readAnswer(answers, 'dustLoad', defaults.dustLoad),
      interiorWindows: readAnswer(answers, 'interiorWindows', defaults.interiorWindows),
      scraping: readAnswer(answers, 'scraping', defaults.scraping),
      insideCabinets: Boolean(readAnswer(answers, 'insideCabinets', defaults.insideCabinets)),
      appliances: Boolean(readAnswer(answers, 'appliances', defaults.appliances)),
      floorDetailing: readAnswer(answers, 'floorDetailing', defaults.floorDetailing),
      specialDetailing: Boolean(readAnswer(answers, 'specialDetailing', defaults.specialDetailing)),
      multiTenantAccess: Boolean(readAnswer(answers, 'multiTenantAccess', defaults.multiTenantAccess)),
      schedule: readAnswer(answers, 'schedule', defaults.schedule),
      contact: readContact(answers),
    };

    return { serviceType, normalizedInput: input };
  }

  throw new Error('serviceType is required and must be one of window, commercialWindow, carpet, postConstruction.');
}

export async function computeDeterministicQuote(answersInput: Record<string, unknown>): Promise<QuoteOutput> {
  if (!isObject(answersInput)) {
    throw new Error('answers must be an object.');
  }

  const answers = stripInternalAnswerKeys(structuredClone(answersInput)) as Record<string, unknown>;
  const { serviceType, normalizedInput } = buildInputFromAnswers(answers);
  const { config } = await loadActivePricingConfig();
  const result = calculateEstimate(serviceType, normalizedInput, config);

  assertFiniteAmount(result.subtotal, 'subtotal');
  assertFiniteAmount(result.estimateLow, 'estimateLow');
  assertFiniteAmount(result.estimateHigh, 'estimateHigh');

  const lineItems = [
    {
      label: 'Estimated subtotal',
      amount: result.subtotal,
    },
    {
      label: 'Low estimate',
      amount: result.estimateLow,
    },
    {
      label: 'High estimate',
      amount: result.estimateHigh,
    },
  ];

  lineItems.forEach((item, index) => {
    assertFiniteAmount(item.amount, `line item ${index + 1} (${item.label})`);
  });

  const quote: QuoteOutput = {
    quote_id: generateQuoteId(),
    total: result.subtotal,
    currency: 'CAD',
    line_items: lineItems,
    assumptions: [
      ...result.notes,
      `Confidence: ${formatConfidence(result.confidence)}`,
      `Booking mode: ${formatBookingMode(result.bookingMode)}`,
    ],
    answers_echo: answers,
    version: 'v1',
  };

  return quote;
}
