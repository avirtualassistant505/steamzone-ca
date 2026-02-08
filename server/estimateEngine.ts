export type ServiceType = 'window' | 'commercialWindow' | 'carpet' | 'postConstruction';

export type ConfidenceLevel = 'green' | 'yellow' | 'red';

export type BookingMode = 'instant_book' | 'confirm_by_text' | 'site_visit_required';

export type WindowZone = 'zoneA' | 'zoneB' | 'zoneC' | 'zoneD';
export type WindowStorey = 'bungalow' | 'oneHalf' | 'two' | 'twoHalf' | 'three';
export type WindowSizeBracket =
  | 'under1000'
  | '1000to1500'
  | '1500to2000'
  | '2000to2500'
  | '2500to3000'
  | 'over3000';
export type WindowScope = 'exterior' | 'interior' | 'both';
export type WindowScreensOption = 'none' | 'some' | 'all';
export type WindowTracksOption = 'basic' | 'detailed';
export type SlidingRemovalOption = 'none' | 'threePanel' | 'fivePanel';
export type PatioDoorOption = 'none' | 'takeApart' | 'slideOnly';
export type SkylightOption = 'none' | 'interior' | 'exterior' | 'both';
export type RailingOption = 'none' | 'oneSide' | 'twoSides';
export type FrenchPaneOption = 'none' | 'some' | 'lots';

export type CommercialBuildingType = 'storefront' | 'lowRise' | 'midRise' | 'highRise';
export type CommercialSizeMode = 'paneCount' | 'frontage';
export type CommercialScope = 'exterior' | 'both';
export type CommercialFrequency = 'oneTime' | 'monthly' | 'biweekly' | 'weekly';
export type CommercialStoreys = 'ground' | 'twoToThree' | 'fourToEight' | 'ninePlus';

export type CarpetEstimateMode = 'rooms' | 'sqft';
export type CarpetSqftBracket = 'under500' | '500to1000' | '1000to1500' | '1500to2000' | 'over2000';
export type CarpetCondition = 'light' | 'moderate' | 'heavy';
export type FurnitureMoving = 'none' | 'light' | 'heavy';
export type SchedulePreference = 'asap' | 'nextWeek' | 'flexible' | 'tomorrow';

export type PostProjectType = 'residential' | 'commercial';
export type PostBuildType = 'renovation' | 'newBuild';
export type PostSqftBracket = 'under1000' | '1000to2500' | '2500to5000' | 'over5000';
export type PostStage = 'rough' | 'light' | 'final' | 'touchUp';
export type PostDustLoad = 'light' | 'medium' | 'heavy';
export type AddOnSize = 'none' | 'small' | 'medium' | 'large';
export type ScrapingOption = 'none' | 'some' | 'lots';

export interface LeadContact {
  fullName: string;
  address: string;
  phone: string;
  email: string;
  consentToContact: boolean;
  marketingOptIn: boolean;
}

export interface WindowEstimateInput {
  postalCode: string;
  zone: WindowZone;
  storey: WindowStorey;
  sizeBracket: WindowSizeBracket;
  scope: WindowScope;
  screens: WindowScreensOption;
  tracks: WindowTracksOption;
  hardToReach: boolean;
  hardWaterRemoval: boolean;
  constructionDebris: boolean;
  slidingRemoval: SlidingRemovalOption;
  slidingQuantity: number;
  patioDoors: PatioDoorOption;
  patioQuantity: number;
  skylights: SkylightOption;
  skylightQuantity: number;
  railingGlass: RailingOption;
  frenchPanes: FrenchPaneOption;
  sunroom: boolean;
  walkoutBasement: boolean;
  contact: LeadContact;
}

export interface CommercialWindowEstimateInput {
  postalCode: string;
  zone: WindowZone;
  buildingType: CommercialBuildingType;
  storeys: CommercialStoreys;
  sizeMode: CommercialSizeMode;
  paneCount: number;
  frontageFeet: number;
  glassDoors: number;
  scope: CommercialScope;
  frequency: CommercialFrequency;
  liftRequired: boolean;
  afterHours: boolean;
  overspray: boolean;
  hardWater: boolean;
  contact: LeadContact;
}

export interface CarpetEstimateInput {
  postalCode: string;
  zone: WindowZone;
  estimateMode: CarpetEstimateMode;
  rooms: number;
  sqftBracket: CarpetSqftBracket;
  condition: CarpetCondition;
  stairsSteps: number;
  hallways: number;
  advancedStainRemoval: boolean;
  odorElimination: boolean;
  petTreatment: boolean;
  stainProtector: boolean;
  furnitureMoving: FurnitureMoving;
  unusualCondition: boolean;
  schedule: SchedulePreference;
  contact: LeadContact;
}

export interface PostConstructionEstimateInput {
  postalCode: string;
  zone: WindowZone;
  projectType: PostProjectType;
  buildType: PostBuildType;
  sqftBracket: PostSqftBracket;
  floors: number;
  stage: PostStage;
  dustLoad: PostDustLoad;
  interiorWindows: AddOnSize;
  scraping: ScrapingOption;
  insideCabinets: boolean;
  appliances: boolean;
  floorDetailing: AddOnSize;
  specialDetailing: boolean;
  multiTenantAccess: boolean;
  schedule: SchedulePreference;
  contact: LeadContact;
}

export interface PricingConfig {
  version: number;
  updatedAt: string;
  estimateRange: {
    lowMultiplier: number;
    highMultiplier: number;
  };
  travelFees: Record<WindowZone, number>;
  window: {
    minimumCharge: number;
    yellowComplexityThreshold: number;
    perPaneRate: number;
    estimatedPanes: Record<WindowSizeBracket, number>;
    storeyMultipliers: Record<WindowStorey, number>;
    scopeMultipliers: Record<WindowScope, number>;
    addOns: {
      screensSome: number;
      screensPerPane: number;
      tracksDetailed: number;
      slidingThreePanel: number;
      slidingFivePanel: number;
      patioTakeApart: number;
      patioSlideOnly: number;
      skylightPerSide: number;
      railingOneSide: number;
      railingTwoSides: number;
      frenchSome: number;
      frenchLots: number;
      sunroom: number;
      walkout: number;
      hardToReachPercent: number;
      hardWaterRemoval: number;
      constructionDebris: number;
    };
    duration: {
      baseHours: number;
      minutesPerPane: number;
      tracksDetailedHours: number;
      slidingRemovalEachHours: number;
      patioTakeApartEachHours: number;
      skylightEachSideHours: number;
      sunroomHours: number;
      hardWaterHours: number;
      hardToReachHours: number;
      constructionDebrisHours: number;
    };
    redFlags: {
      over3000RequiresQuote: boolean;
      threeStoreyFrenchLotsRequiresQuote: boolean;
      hardWaterNeedsConfirmation: boolean;
      constructionDebrisNeedsQuote: boolean;
    };
  };
  commercialWindow: {
    minimumCharge: number;
    yellowComplexityThreshold: number;
    storefront: {
      exteriorPerPane: number;
      bothSidesPerPane: number;
      perGlassDoor: number;
      panesPerFrontageFoot: number;
    };
    lowRise: {
      perPaneMin: number;
      perPaneMax: number;
      bothSidesMultiplier: number;
      upperStoreyPremiumPercent: number;
    };
    midHighRise: {
      midRisePerPane: number;
      highRiseBaseVisit: number;
    };
    recurringDiscountPercent: Record<CommercialFrequency, number>;
    addOns: {
      afterHoursPercent: number;
      oversprayPerPane: number;
      hardWaterPerPane: number;
    };
    duration: {
      baseHours: number;
      minutesPerPane: number;
      minutesPerDoor: number;
      afterHoursExtraHours: number;
    };
    redFlags: {
      midRiseRequiresQuote: boolean;
      highRiseRequiresQuote: boolean;
      liftRequiredRequiresQuote: boolean;
      oversprayNeedsConfirmation: boolean;
    };
  };
  carpet: {
    minimumCharge: number;
    yellowComplexityThreshold: number;
    roomPackages: {
      twoRooms: number;
      threeRooms: number;
      fourRooms: number;
      fiveRooms: number;
      sixRooms: number;
      additionalRoom: number;
    };
    baseRatePerSqft: number;
    conditionMultipliers: Record<CarpetCondition, number>;
    stairsPerStep: number;
    hallwayPrice: number;
    addOns: {
      advancedStainRemoval: number;
      odorElimination: number;
      petTreatment: number;
      protectorPerSqft: number;
      protectorPerRoom: number;
      furnitureLight: number;
      furnitureHeavy: number;
    };
    duration: {
      baseHours: number;
      minutesPerRoom: number;
      minutesPer100Sqft: number;
      minutesPerStair: number;
      minutesPerHallway: number;
      stainHours: number;
      odorHours: number;
      protectorHours: number;
    };
    redFlags: {
      maxRoomsInstant: number;
      maxSqftInstant: number;
      unusualConditionRequiresQuote: boolean;
      heavyOdorNeedsConfirmation: boolean;
    };
  };
  postConstruction: {
    minimumCharge: number;
    yellowComplexityThreshold: number;
    stageRates: Record<PostStage, number>;
    dustMultipliers: Record<PostDustLoad, number>;
    sizeSqftEstimates: Record<PostSqftBracket, number>;
    addOns: {
      interiorWindows: Record<Exclude<AddOnSize, 'none'>, number>;
      floorDetailing: Record<Exclude<AddOnSize, 'none'>, number>;
      scrapingPerSqftSome: number;
      scrapingPerSqftLots: number;
      cabinetsFlat: number;
      appliancesFlat: number;
      specialDetailingHourly: number;
      specialDetailingEstimatedHours: Record<PostSqftBracket, number>;
    };
    duration: {
      baseHours: number;
      hoursPer1000Sqft: number;
      stageMultipliers: Record<PostStage, number>;
      dustMultipliers: Record<PostDustLoad, number>;
      interiorWindowsHours: Record<Exclude<AddOnSize, 'none'>, number>;
      floorDetailingHours: Record<Exclude<AddOnSize, 'none'>, number>;
      scrapingSomeHoursPer1000: number;
      scrapingLotsHoursPer1000: number;
      cabinetsHours: number;
      appliancesHours: number;
      specialDetailingHoursMultiplier: number;
    };
    redFlags: {
      maxSqftInstant: number;
      heavyDustWithLotsScraping: boolean;
      commercialMultiTenant: boolean;
      tomorrowSchedule: boolean;
    };
  };
}

export interface EstimateResult {
  serviceType: ServiceType;
  subtotal: number;
  estimateLow: number;
  estimateHigh: number;
  durationLowHours: number;
  durationHighHours: number;
  confidence: ConfidenceLevel;
  bookingMode: BookingMode;
  complexityScore: number;
  estimatedSqft: number;
  redFlags: string[];
  includedItems: string[];
  notes: string[];
}

export interface EstimateRecord {
  id: string;
  quoteNumber: string;
  createdAt: string;
  serviceType: ServiceType;
  postalCode: string;
  zone: WindowZone;
  contact: LeadContact;
  answers:
    | WindowEstimateInput
    | CommercialWindowEstimateInput
    | CarpetEstimateInput
    | PostConstructionEstimateInput;
  result: EstimateResult;
  pricingVersion: number;
  utm: Partial<Record<'utm_source' | 'utm_medium' | 'utm_campaign' | 'utm_content', string>>;
}

const PRICING_STORAGE_KEY = 'steamzone.pricing-config.v2';
const QUOTE_STORAGE_KEY = 'steamzone.quote-history.v2';

const CARPET_SQFT_ESTIMATES: Record<CarpetSqftBracket, number> = {
  under500: 425,
  '500to1000': 750,
  '1000to1500': 1250,
  '1500to2000': 1750,
  over2000: 2300,
};

function nowIso(): string {
  return new Date().toISOString();
}

function quoteNumber(): string {
  const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `SZ-${stamp}-${suffix}`;
}

function roundCurrency(value: number): number {
  return Math.round(value);
}

function roundHours(value: number): number {
  return Math.max(0.5, Math.round(value * 10) / 10);
}

function withRange(total: number, lowMultiplier: number, highMultiplier: number): { low: number; high: number } {
  return {
    low: roundCurrency(total * lowMultiplier),
    high: roundCurrency(total * highMultiplier),
  };
}

function bookingModeFromConfidence(confidence: ConfidenceLevel): BookingMode {
  if (confidence === 'red') {
    return 'site_visit_required';
  }

  if (confidence === 'yellow') {
    return 'confirm_by_text';
  }

  return 'instant_book';
}

function buildConfidence(redFlags: string[], complexityScore: number, yellowThreshold: number): ConfidenceLevel {
  if (redFlags.length > 0) {
    return 'red';
  }

  if (complexityScore >= yellowThreshold) {
    return 'yellow';
  }

  return 'green';
}

function travelFee(zone: WindowZone, config: PricingConfig): number {
  return config.travelFees[zone];
}

function sidesFromSkylight(option: SkylightOption): number {
  if (option === 'both') {
    return 2;
  }

  if (option === 'interior' || option === 'exterior') {
    return 1;
  }

  return 0;
}

function roomPackageBasePrice(rooms: number, config: PricingConfig['carpet']['roomPackages']): number {
  if (rooms <= 2) {
    return config.twoRooms;
  }

  if (rooms === 3) {
    return config.threeRooms;
  }

  if (rooms === 4) {
    return config.fourRooms;
  }

  if (rooms === 5) {
    return config.fiveRooms;
  }

  if (rooms === 6) {
    return config.sixRooms;
  }

  return config.sixRooms + (rooms - 6) * config.additionalRoom;
}

function getUtmParams(): EstimateRecord['utm'] {
  if (typeof window === 'undefined') {
    return {};
  }

  const params = new URLSearchParams(window.location.search);

  return {
    utm_source: params.get('utm_source') ?? undefined,
    utm_medium: params.get('utm_medium') ?? undefined,
    utm_campaign: params.get('utm_campaign') ?? undefined,
    utm_content: params.get('utm_content') ?? undefined,
  };
}

function computeWindowEstimate(input: WindowEstimateInput, config: PricingConfig): EstimateResult {
  const paneEstimate = config.window.estimatedPanes[input.sizeBracket];
  const storeyMultiplier = config.window.storeyMultipliers[input.storey];
  const scopeMultiplier = config.window.scopeMultipliers[input.scope];
  const basePaneCost = paneEstimate * config.window.perPaneRate * storeyMultiplier * scopeMultiplier;

  const screensCost =
    input.screens === 'all'
      ? paneEstimate * config.window.addOns.screensPerPane
      : input.screens === 'some'
        ? config.window.addOns.screensSome
        : 0;

  const tracksCost = input.tracks === 'detailed' ? config.window.addOns.tracksDetailed : 0;
  const slidingCost =
    input.slidingRemoval === 'threePanel'
      ? input.slidingQuantity * config.window.addOns.slidingThreePanel
      : input.slidingRemoval === 'fivePanel'
        ? input.slidingQuantity * config.window.addOns.slidingFivePanel
        : 0;
  const patioCost =
    input.patioDoors === 'takeApart'
      ? input.patioQuantity * config.window.addOns.patioTakeApart
      : input.patioDoors === 'slideOnly'
        ? input.patioQuantity * config.window.addOns.patioSlideOnly
        : 0;

  const skylightSides = sidesFromSkylight(input.skylights);
  const skylightCost = skylightSides * input.skylightQuantity * config.window.addOns.skylightPerSide;

  const railingCost =
    input.railingGlass === 'oneSide'
      ? config.window.addOns.railingOneSide
      : input.railingGlass === 'twoSides'
        ? config.window.addOns.railingTwoSides
        : 0;

  const frenchCost =
    input.frenchPanes === 'some'
      ? config.window.addOns.frenchSome
      : input.frenchPanes === 'lots'
        ? config.window.addOns.frenchLots
        : 0;

  const hardToReachCost = input.hardToReach
    ? basePaneCost * (config.window.addOns.hardToReachPercent / 100)
    : 0;
  const hardWaterCost = input.hardWaterRemoval ? config.window.addOns.hardWaterRemoval : 0;
  const constructionDebrisCost = input.constructionDebris ? config.window.addOns.constructionDebris : 0;

  const subtotalRaw =
    travelFee(input.zone, config) +
    basePaneCost +
    screensCost +
    tracksCost +
    slidingCost +
    patioCost +
    skylightCost +
    railingCost +
    frenchCost +
    (input.sunroom ? config.window.addOns.sunroom : 0) +
    (input.walkoutBasement ? config.window.addOns.walkout : 0) +
    hardToReachCost +
    hardWaterCost +
    constructionDebrisCost;

  const subtotal = Math.max(config.window.minimumCharge, subtotalRaw);

  const durationHoursRaw =
    config.window.duration.baseHours +
    (paneEstimate * config.window.duration.minutesPerPane * storeyMultiplier * scopeMultiplier) / 60 +
    (input.tracks === 'detailed' ? config.window.duration.tracksDetailedHours : 0) +
    input.slidingQuantity * config.window.duration.slidingRemovalEachHours +
    (input.patioDoors === 'takeApart' ? input.patioQuantity * config.window.duration.patioTakeApartEachHours : 0) +
    skylightSides * input.skylightQuantity * config.window.duration.skylightEachSideHours +
    (input.sunroom ? config.window.duration.sunroomHours : 0) +
    (input.hardWaterRemoval ? config.window.duration.hardWaterHours : 0) +
    (input.hardToReach ? config.window.duration.hardToReachHours : 0) +
    (input.constructionDebris ? config.window.duration.constructionDebrisHours : 0);

  const complexityScore =
    (input.scope === 'both' ? 2 : input.scope === 'interior' ? 1 : 0) +
    (input.storey === 'three' ? 2 : input.storey === 'twoHalf' ? 1 : 0) +
    (input.screens === 'all' ? 1 : 0) +
    (input.tracks === 'detailed' ? 1 : 0) +
    (input.hardToReach ? 2 : 0) +
    (input.hardWaterRemoval ? 2 : 0) +
    (input.constructionDebris ? 3 : 0) +
    (input.frenchPanes === 'lots' ? 2 : input.frenchPanes === 'some' ? 1 : 0) +
    (input.skylightQuantity > 0 ? 1 : 0);

  const redFlags: string[] = [];
  if (input.sizeBracket === 'over3000' && config.window.redFlags.over3000RequiresQuote) {
    redFlags.push('Homes over 3000 sq ft require final confirmation.');
  }
  if (
    input.storey === 'three' &&
    input.frenchPanes === 'lots' &&
    config.window.redFlags.threeStoreyFrenchLotsRequiresQuote
  ) {
    redFlags.push('3-storey homes with lots of French panes require a site quote.');
  }
  if (input.hardWaterRemoval && config.window.redFlags.hardWaterNeedsConfirmation) {
    redFlags.push('Hard water stain work is confirmed after review/photos.');
  }
  if (input.constructionDebris && config.window.redFlags.constructionDebrisNeedsQuote) {
    redFlags.push('Post-construction debris on glass is priced after confirmation.');
  }

  const confidence = buildConfidence(redFlags, complexityScore, config.window.yellowComplexityThreshold);
  const range = withRange(subtotal, config.estimateRange.lowMultiplier, config.estimateRange.highMultiplier);

  return {
    serviceType: 'window',
    subtotal: roundCurrency(subtotal),
    estimateLow: range.low,
    estimateHigh: range.high,
    durationLowHours: roundHours(durationHoursRaw * 0.85),
    durationHighHours: roundHours(durationHoursRaw * 1.2),
    confidence,
    bookingMode: bookingModeFromConfidence(confidence),
    complexityScore,
    estimatedSqft: 0,
    redFlags,
    includedItems: [
      'Residential window detailing',
      input.scope === 'both' ? 'Interior and exterior glass cleaning' : `${input.scope} glass cleaning`,
      input.tracks === 'detailed' ? 'Detailed track and sill cleaning' : 'Standard frame wipe-down',
    ],
    notes: [
      'Estimate includes travel from Steinbach area zoning.',
      'Taxes are not included.',
      'Final price is confirmed after details/photos if required.',
    ],
  };
}

function computeCommercialWindowEstimate(input: CommercialWindowEstimateInput, config: PricingConfig): EstimateResult {
  const paneEstimate =
    input.sizeMode === 'paneCount'
      ? Math.max(1, input.paneCount)
      : Math.max(1, Math.round(input.frontageFeet * config.commercialWindow.storefront.panesPerFrontageFoot));

  const storefrontRate =
    input.scope === 'both'
      ? config.commercialWindow.storefront.bothSidesPerPane
      : config.commercialWindow.storefront.exteriorPerPane;

  const lowRiseBaseRate =
    (config.commercialWindow.lowRise.perPaneMin + config.commercialWindow.lowRise.perPaneMax) / 2;

  const storeyPremium =
    input.storeys === 'twoToThree'
      ? 1 + config.commercialWindow.lowRise.upperStoreyPremiumPercent / 100
      : input.storeys === 'fourToEight'
        ? 1.5
        : input.storeys === 'ninePlus'
          ? 1.9
          : 1;

  let labor = 0;
  if (input.buildingType === 'storefront') {
    labor = paneEstimate * storefrontRate + input.glassDoors * config.commercialWindow.storefront.perGlassDoor;
  } else if (input.buildingType === 'lowRise') {
    labor =
      paneEstimate *
        lowRiseBaseRate *
        (input.scope === 'both' ? config.commercialWindow.lowRise.bothSidesMultiplier : 1) *
        storeyPremium +
      input.glassDoors * config.commercialWindow.storefront.perGlassDoor;
  } else if (input.buildingType === 'midRise') {
    labor = paneEstimate * config.commercialWindow.midHighRise.midRisePerPane + input.glassDoors * 18;
  } else {
    labor = config.commercialWindow.midHighRise.highRiseBaseVisit + paneEstimate * 5;
  }

  const oversprayCost = input.overspray ? paneEstimate * config.commercialWindow.addOns.oversprayPerPane : 0;
  const hardWaterCost = input.hardWater ? paneEstimate * config.commercialWindow.addOns.hardWaterPerPane : 0;

  const afterHoursMultiplier = input.afterHours
    ? 1 + config.commercialWindow.addOns.afterHoursPercent / 100
    : 1;

  const recurringDiscount = config.commercialWindow.recurringDiscountPercent[input.frequency] / 100;

  const subtotalRaw =
    (labor * afterHoursMultiplier + oversprayCost + hardWaterCost + travelFee(input.zone, config)) *
    (1 - recurringDiscount);

  const subtotal = Math.max(config.commercialWindow.minimumCharge, subtotalRaw);

  const durationHoursRaw =
    config.commercialWindow.duration.baseHours +
    (paneEstimate * config.commercialWindow.duration.minutesPerPane) / 60 +
    (input.glassDoors * config.commercialWindow.duration.minutesPerDoor) / 60 +
    (input.afterHours ? config.commercialWindow.duration.afterHoursExtraHours : 0);

  const complexityScore =
    (input.buildingType === 'highRise' ? 4 : input.buildingType === 'midRise' ? 3 : input.buildingType === 'lowRise' ? 1 : 0) +
    (input.scope === 'both' ? 1 : 0) +
    (input.frequency === 'weekly' || input.frequency === 'biweekly' ? 1 : 0) +
    (input.liftRequired ? 2 : 0) +
    (input.afterHours ? 1 : 0) +
    (input.overspray ? 2 : 0) +
    (input.hardWater ? 1 : 0);

  const redFlags: string[] = [];
  if (input.buildingType === 'midRise' && config.commercialWindow.redFlags.midRiseRequiresQuote) {
    redFlags.push('Mid-rise commercial buildings require on-site confirmation.');
  }
  if (input.buildingType === 'highRise' && config.commercialWindow.redFlags.highRiseRequiresQuote) {
    redFlags.push('High-rise commercial work requires a custom quote.');
  }
  if (input.liftRequired && config.commercialWindow.redFlags.liftRequiredRequiresQuote) {
    redFlags.push('Lift or boom access jobs are priced after access planning.');
  }
  if (input.overspray && config.commercialWindow.redFlags.oversprayNeedsConfirmation) {
    redFlags.push('Overspray or sticker removal is confirmed after photos/site review.');
  }

  const confidence = buildConfidence(redFlags, complexityScore, config.commercialWindow.yellowComplexityThreshold);
  const range = withRange(subtotal, config.estimateRange.lowMultiplier, config.estimateRange.highMultiplier);

  return {
    serviceType: 'commercialWindow',
    subtotal: roundCurrency(subtotal),
    estimateLow: range.low,
    estimateHigh: range.high,
    durationLowHours: roundHours(durationHoursRaw * 0.85),
    durationHighHours: roundHours(durationHoursRaw * 1.25),
    confidence,
    bookingMode: bookingModeFromConfidence(confidence),
    complexityScore,
    estimatedSqft: 0,
    redFlags,
    includedItems: [
      input.buildingType === 'storefront' ? 'Storefront glass route estimate' : 'Commercial window maintenance estimate',
      `Scope: ${input.scope === 'both' ? 'interior + exterior' : 'exterior only'}`,
      `Frequency: ${input.frequency}`,
    ],
    notes: [
      'Recurring frequency discounts are included in this estimate.',
      'Taxes are not included.',
      'Complex commercial access may require a confirmed walkthrough.',
    ],
  };
}

function computeCarpetEstimate(input: CarpetEstimateInput, config: PricingConfig): EstimateResult {
  const estimatedSqft =
    input.estimateMode === 'sqft' ? CARPET_SQFT_ESTIMATES[input.sqftBracket] : Math.max(350, input.rooms * 180);

  const basePrice =
    input.estimateMode === 'rooms'
      ? roomPackageBasePrice(input.rooms, config.carpet.roomPackages)
      : estimatedSqft * config.carpet.baseRatePerSqft;

  const conditionMultiplier = config.carpet.conditionMultipliers[input.condition];
  const stairsCost = input.stairsSteps * config.carpet.stairsPerStep;
  const hallwayCost = input.hallways * config.carpet.hallwayPrice;

  const furnitureCost =
    input.furnitureMoving === 'heavy'
      ? config.carpet.addOns.furnitureHeavy
      : input.furnitureMoving === 'light'
        ? config.carpet.addOns.furnitureLight
        : 0;

  const treatmentCost =
    (input.advancedStainRemoval ? config.carpet.addOns.advancedStainRemoval : 0) +
    (input.odorElimination ? config.carpet.addOns.odorElimination : 0) +
    (input.petTreatment ? config.carpet.addOns.petTreatment : 0) +
    (input.stainProtector
      ? input.estimateMode === 'sqft'
        ? estimatedSqft * config.carpet.addOns.protectorPerSqft
        : input.rooms * config.carpet.addOns.protectorPerRoom
      : 0);

  const subtotalRaw =
    basePrice * conditionMultiplier +
    stairsCost +
    hallwayCost +
    furnitureCost +
    treatmentCost +
    travelFee(input.zone, config);

  const subtotal = Math.max(config.carpet.minimumCharge, subtotalRaw);

  const durationHoursRaw =
    config.carpet.duration.baseHours +
    (input.estimateMode === 'rooms'
      ? (input.rooms * config.carpet.duration.minutesPerRoom) / 60
      : ((estimatedSqft / 100) * config.carpet.duration.minutesPer100Sqft) / 60) +
    (input.stairsSteps * config.carpet.duration.minutesPerStair) / 60 +
    (input.hallways * config.carpet.duration.minutesPerHallway) / 60 +
    (input.advancedStainRemoval ? config.carpet.duration.stainHours : 0) +
    (input.odorElimination ? config.carpet.duration.odorHours : 0) +
    (input.stainProtector ? config.carpet.duration.protectorHours : 0);

  const complexityScore =
    (input.condition === 'heavy' ? 3 : input.condition === 'moderate' ? 1 : 0) +
    (input.estimateMode === 'rooms' && input.rooms >= 6 ? 2 : 0) +
    (input.estimateMode === 'sqft' && estimatedSqft > 1500 ? 2 : 0) +
    (input.stairsSteps >= 12 ? 1 : 0) +
    (input.hallways >= 2 ? 1 : 0) +
    (input.advancedStainRemoval ? 1 : 0) +
    (input.odorElimination ? 2 : 0) +
    (input.unusualCondition ? 3 : 0);

  const redFlags: string[] = [];
  if (input.estimateMode === 'rooms' && input.rooms > config.carpet.redFlags.maxRoomsInstant) {
    redFlags.push('Large multi-room carpet jobs require confirmation.');
  }
  if (input.estimateMode === 'sqft' && estimatedSqft > config.carpet.redFlags.maxSqftInstant) {
    redFlags.push('Large square-foot carpet jobs require confirmation.');
  }
  if (input.unusualCondition && config.carpet.redFlags.unusualConditionRequiresQuote) {
    redFlags.push('Flooding, mould, or unusual carpet conditions require a custom quote.');
  }
  if (input.condition === 'heavy' && input.odorElimination && config.carpet.redFlags.heavyOdorNeedsConfirmation) {
    redFlags.push('Heavy soil with odor treatment is confirmed by technician review.');
  }

  const confidence = buildConfidence(redFlags, complexityScore, config.carpet.yellowComplexityThreshold);
  const range = withRange(subtotal, config.estimateRange.lowMultiplier, config.estimateRange.highMultiplier);

  return {
    serviceType: 'carpet',
    subtotal: roundCurrency(subtotal),
    estimateLow: range.low,
    estimateHigh: range.high,
    durationLowHours: roundHours(durationHoursRaw * 0.85),
    durationHighHours: roundHours(durationHoursRaw * 1.2),
    confidence,
    bookingMode: bookingModeFromConfidence(confidence),
    complexityScore,
    estimatedSqft,
    redFlags,
    includedItems: [
      'Professional hot-water extraction carpet cleaning',
      'Basic spot treatment and post-clean walk-through',
      input.stainProtector ? 'Stain protector included' : 'Optional stain protector available',
    ],
    notes: [
      'Room packages assume standard rooms up to ~200 sq ft each.',
      'Taxes are not included.',
      'Estimate includes travel based on your service zone.',
    ],
  };
}

function computePostConstructionEstimate(input: PostConstructionEstimateInput, config: PricingConfig): EstimateResult {
  const estimatedSqft = config.postConstruction.sizeSqftEstimates[input.sqftBracket];
  const baseRate = config.postConstruction.stageRates[input.stage] * config.postConstruction.dustMultipliers[input.dustLoad];

  const base = estimatedSqft * baseRate;
  const interiorWindowsCost =
    input.interiorWindows === 'none' ? 0 : config.postConstruction.addOns.interiorWindows[input.interiorWindows];
  const floorDetailingCost =
    input.floorDetailing === 'none' ? 0 : config.postConstruction.addOns.floorDetailing[input.floorDetailing];
  const scrapingCost =
    input.scraping === 'some'
      ? estimatedSqft * config.postConstruction.addOns.scrapingPerSqftSome
      : input.scraping === 'lots'
        ? estimatedSqft * config.postConstruction.addOns.scrapingPerSqftLots
        : 0;
  const cabinetsCost = input.insideCabinets ? config.postConstruction.addOns.cabinetsFlat : 0;
  const appliancesCost = input.appliances ? config.postConstruction.addOns.appliancesFlat : 0;
  const specialHours = input.specialDetailing
    ? config.postConstruction.addOns.specialDetailingEstimatedHours[input.sqftBracket]
    : 0;
  const specialCost = specialHours * config.postConstruction.addOns.specialDetailingHourly;

  const subtotalRaw =
    base +
    interiorWindowsCost +
    floorDetailingCost +
    scrapingCost +
    cabinetsCost +
    appliancesCost +
    specialCost +
    travelFee(input.zone, config);

  const subtotal = Math.max(config.postConstruction.minimumCharge, subtotalRaw);

  const durationHoursRaw =
    config.postConstruction.duration.baseHours +
    (estimatedSqft / 1000) *
      config.postConstruction.duration.hoursPer1000Sqft *
      config.postConstruction.duration.stageMultipliers[input.stage] *
      config.postConstruction.duration.dustMultipliers[input.dustLoad] +
    (input.interiorWindows === 'none' ? 0 : config.postConstruction.duration.interiorWindowsHours[input.interiorWindows]) +
    (input.floorDetailing === 'none' ? 0 : config.postConstruction.duration.floorDetailingHours[input.floorDetailing]) +
    (input.scraping === 'some'
      ? (estimatedSqft / 1000) * config.postConstruction.duration.scrapingSomeHoursPer1000
      : input.scraping === 'lots'
        ? (estimatedSqft / 1000) * config.postConstruction.duration.scrapingLotsHoursPer1000
        : 0) +
    (input.insideCabinets ? config.postConstruction.duration.cabinetsHours : 0) +
    (input.appliances ? config.postConstruction.duration.appliancesHours : 0) +
    specialHours * config.postConstruction.duration.specialDetailingHoursMultiplier;

  const complexityScore =
    (input.projectType === 'commercial' ? 2 : 0) +
    (input.stage === 'final' ? 1 : input.stage === 'rough' ? 2 : 0) +
    (input.dustLoad === 'heavy' ? 3 : input.dustLoad === 'medium' ? 1 : 0) +
    (input.scraping === 'lots' ? 3 : input.scraping === 'some' ? 1 : 0) +
    (input.specialDetailing ? 2 : 0) +
    (input.multiTenantAccess ? 2 : 0) +
    (input.schedule === 'tomorrow' ? 2 : 0);

  const redFlags: string[] = [];
  if (estimatedSqft > config.postConstruction.redFlags.maxSqftInstant) {
    redFlags.push('Projects over the instant-quote square-foot threshold need a site quote.');
  }
  if (
    input.dustLoad === 'heavy' &&
    input.scraping === 'lots' &&
    config.postConstruction.redFlags.heavyDustWithLotsScraping
  ) {
    redFlags.push('Heavy dust plus lots of scraping requires a custom walkthrough quote.');
  }
  if (input.projectType === 'commercial' && input.multiTenantAccess && config.postConstruction.redFlags.commercialMultiTenant) {
    redFlags.push('Commercial multi-tenant access jobs require direct scheduling confirmation.');
  }
  if (input.schedule === 'tomorrow' && config.postConstruction.redFlags.tomorrowSchedule) {
    redFlags.push('Next-day post-construction requests are confirmed by phone.');
  }

  const confidence = buildConfidence(redFlags, complexityScore, config.postConstruction.yellowComplexityThreshold);
  const range = withRange(subtotal, config.estimateRange.lowMultiplier, config.estimateRange.highMultiplier);

  return {
    serviceType: 'postConstruction',
    subtotal: roundCurrency(subtotal),
    estimateLow: range.low,
    estimateHigh: range.high,
    durationLowHours: roundHours(durationHoursRaw * 0.9),
    durationHighHours: roundHours(durationHoursRaw * 1.25),
    confidence,
    bookingMode: bookingModeFromConfidence(confidence),
    complexityScore,
    estimatedSqft,
    redFlags,
    includedItems: [
      `Stage estimate: ${input.stage}`,
      'Dust removal, vacuuming, and surface wipe-down',
      'Disposal and detail-level cleanup based on selected options',
    ],
    notes: [
      'Post-construction estimates are indicative and confirmed after scope check.',
      'Taxes are not included.',
      'Travel and mobilization are included by zone.',
    ],
  };
}

export function calculateEstimate(
  serviceType: ServiceType,
  input:
    | WindowEstimateInput
    | CommercialWindowEstimateInput
    | CarpetEstimateInput
    | PostConstructionEstimateInput,
  config: PricingConfig
): EstimateResult {
  if (serviceType === 'window') {
    return computeWindowEstimate(input as WindowEstimateInput, config);
  }

  if (serviceType === 'commercialWindow') {
    return computeCommercialWindowEstimate(input as CommercialWindowEstimateInput, config);
  }

  if (serviceType === 'carpet') {
    return computeCarpetEstimate(input as CarpetEstimateInput, config);
  }

  return computePostConstructionEstimate(input as PostConstructionEstimateInput, config);
}

export function createDefaultLeadContact(): LeadContact {
  return {
    fullName: '',
    address: '',
    phone: '',
    email: '',
    // Start checked per business preference (user can uncheck).
    consentToContact: true,
    // Optional marketing consent for offers/updates.
    marketingOptIn: false,
  };
}

export function createDefaultWindowInput(): WindowEstimateInput {
  return {
    postalCode: '',
    zone: 'zoneA',
    storey: 'bungalow',
    sizeBracket: '1000to1500',
    scope: 'both',
    screens: 'some',
    tracks: 'basic',
    hardToReach: false,
    hardWaterRemoval: false,
    constructionDebris: false,
    slidingRemoval: 'none',
    slidingQuantity: 0,
    patioDoors: 'none',
    patioQuantity: 0,
    skylights: 'none',
    skylightQuantity: 0,
    railingGlass: 'none',
    frenchPanes: 'none',
    sunroom: false,
    walkoutBasement: false,
    contact: createDefaultLeadContact(),
  };
}

export function createDefaultCommercialWindowInput(): CommercialWindowEstimateInput {
  return {
    postalCode: '',
    zone: 'zoneA',
    buildingType: 'storefront',
    storeys: 'ground',
    sizeMode: 'paneCount',
    paneCount: 12,
    frontageFeet: 20,
    glassDoors: 1,
    scope: 'both',
    frequency: 'oneTime',
    liftRequired: false,
    afterHours: false,
    overspray: false,
    hardWater: false,
    contact: createDefaultLeadContact(),
  };
}

export function createDefaultCarpetInput(): CarpetEstimateInput {
  return {
    postalCode: '',
    zone: 'zoneA',
    estimateMode: 'rooms',
    rooms: 3,
    sqftBracket: '1000to1500',
    condition: 'light',
    stairsSteps: 0,
    hallways: 0,
    advancedStainRemoval: false,
    odorElimination: false,
    petTreatment: false,
    stainProtector: false,
    furnitureMoving: 'none',
    unusualCondition: false,
    schedule: 'flexible',
    contact: createDefaultLeadContact(),
  };
}

export function createDefaultPostConstructionInput(): PostConstructionEstimateInput {
  return {
    postalCode: '',
    zone: 'zoneA',
    projectType: 'residential',
    buildType: 'renovation',
    sqftBracket: '1000to2500',
    floors: 1,
    stage: 'final',
    dustLoad: 'medium',
    interiorWindows: 'none',
    scraping: 'none',
    insideCabinets: false,
    appliances: false,
    floorDetailing: 'none',
    specialDetailing: false,
    multiTenantAccess: false,
    schedule: 'flexible',
    contact: createDefaultLeadContact(),
  };
}

export function createDefaultPricingConfig(): PricingConfig {
  return {
    version: 2,
    updatedAt: nowIso(),
    estimateRange: {
      lowMultiplier: 0.9,
      highMultiplier: 1.15,
    },
    travelFees: {
      zoneA: 25,
      zoneB: 45,
      zoneC: 95,
      zoneD: 125,
    },
    window: {
      minimumCharge: 179,
      yellowComplexityThreshold: 6,
      perPaneRate: 5,
      estimatedPanes: {
        under1000: 20,
        '1000to1500': 26,
        '1500to2000': 32,
        '2000to2500': 40,
        '2500to3000': 48,
        over3000: 56,
      },
      storeyMultipliers: {
        bungalow: 1,
        oneHalf: 1.1,
        two: 1.25,
        twoHalf: 1.4,
        three: 1.6,
      },
      scopeMultipliers: {
        exterior: 1,
        interior: 1.2,
        both: 1.7,
      },
      addOns: {
        screensSome: 60,
        screensPerPane: 5,
        tracksDetailed: 90,
        slidingThreePanel: 25,
        slidingFivePanel: 35,
        patioTakeApart: 45,
        patioSlideOnly: 25,
        skylightPerSide: 20,
        railingOneSide: 60,
        railingTwoSides: 100,
        frenchSome: 75,
        frenchLots: 150,
        sunroom: 120,
        walkout: 40,
        hardToReachPercent: 15,
        hardWaterRemoval: 120,
        constructionDebris: 140,
      },
      duration: {
        baseHours: 1,
        minutesPerPane: 4,
        tracksDetailedHours: 0.5,
        slidingRemovalEachHours: 0.15,
        patioTakeApartEachHours: 0.2,
        skylightEachSideHours: 0.15,
        sunroomHours: 0.75,
        hardWaterHours: 0.75,
        hardToReachHours: 0.5,
        constructionDebrisHours: 0.75,
      },
      redFlags: {
        over3000RequiresQuote: true,
        threeStoreyFrenchLotsRequiresQuote: true,
        hardWaterNeedsConfirmation: true,
        constructionDebrisNeedsQuote: true,
      },
    },
    commercialWindow: {
      minimumCharge: 65,
      yellowComplexityThreshold: 5,
      storefront: {
        exteriorPerPane: 3,
        bothSidesPerPane: 4.5,
        perGlassDoor: 15,
        panesPerFrontageFoot: 1.2,
      },
      lowRise: {
        perPaneMin: 6,
        perPaneMax: 9,
        bothSidesMultiplier: 1.2,
        upperStoreyPremiumPercent: 30,
      },
      midHighRise: {
        midRisePerPane: 15,
        highRiseBaseVisit: 2200,
      },
      recurringDiscountPercent: {
        oneTime: 0,
        monthly: 10,
        biweekly: 20,
        weekly: 25,
      },
      addOns: {
        afterHoursPercent: 15,
        oversprayPerPane: 2.5,
        hardWaterPerPane: 4,
      },
      duration: {
        baseHours: 0.75,
        minutesPerPane: 3,
        minutesPerDoor: 8,
        afterHoursExtraHours: 0.35,
      },
      redFlags: {
        midRiseRequiresQuote: true,
        highRiseRequiresQuote: true,
        liftRequiredRequiresQuote: true,
        oversprayNeedsConfirmation: true,
      },
    },
    carpet: {
      minimumCharge: 119,
      yellowComplexityThreshold: 5,
      roomPackages: {
        twoRooms: 119,
        threeRooms: 129,
        fourRooms: 159,
        fiveRooms: 189,
        sixRooms: 219,
        additionalRoom: 40,
      },
      baseRatePerSqft: 0.3,
      conditionMultipliers: {
        light: 1,
        moderate: 1.25,
        heavy: 1.4,
      },
      stairsPerStep: 3,
      hallwayPrice: 35,
      addOns: {
        advancedStainRemoval: 50,
        odorElimination: 75,
        petTreatment: 45,
        protectorPerSqft: 0.1,
        protectorPerRoom: 25,
        furnitureLight: 20,
        furnitureHeavy: 45,
      },
      duration: {
        baseHours: 0.75,
        minutesPerRoom: 25,
        minutesPer100Sqft: 12,
        minutesPerStair: 1.5,
        minutesPerHallway: 12,
        stainHours: 0.3,
        odorHours: 0.35,
        protectorHours: 0.3,
      },
      redFlags: {
        maxRoomsInstant: 7,
        maxSqftInstant: 2200,
        unusualConditionRequiresQuote: true,
        heavyOdorNeedsConfirmation: true,
      },
    },
    postConstruction: {
      minimumCharge: 350,
      yellowComplexityThreshold: 6,
      stageRates: {
        rough: 0.2,
        light: 0.3,
        final: 0.35,
        touchUp: 0.15,
      },
      dustMultipliers: {
        light: 1,
        medium: 1.25,
        heavy: 1.8,
      },
      sizeSqftEstimates: {
        under1000: 850,
        '1000to2500': 1800,
        '2500to5000': 3500,
        over5000: 6000,
      },
      addOns: {
        interiorWindows: {
          small: 100,
          medium: 200,
          large: 350,
        },
        floorDetailing: {
          small: 75,
          medium: 150,
          large: 250,
        },
        scrapingPerSqftSome: 0.05,
        scrapingPerSqftLots: 0.12,
        cabinetsFlat: 80,
        appliancesFlat: 90,
        specialDetailingHourly: 80,
        specialDetailingEstimatedHours: {
          under1000: 1,
          '1000to2500': 2,
          '2500to5000': 3,
          over5000: 4,
        },
      },
      duration: {
        baseHours: 1.5,
        hoursPer1000Sqft: 1.6,
        stageMultipliers: {
          rough: 1.15,
          light: 1,
          final: 1.25,
          touchUp: 0.85,
        },
        dustMultipliers: {
          light: 1,
          medium: 1.2,
          heavy: 1.5,
        },
        interiorWindowsHours: {
          small: 0.7,
          medium: 1.2,
          large: 2,
        },
        floorDetailingHours: {
          small: 0.5,
          medium: 1,
          large: 1.6,
        },
        scrapingSomeHoursPer1000: 0.4,
        scrapingLotsHoursPer1000: 1,
        cabinetsHours: 0.5,
        appliancesHours: 0.45,
        specialDetailingHoursMultiplier: 1,
      },
      redFlags: {
        maxSqftInstant: 5000,
        heavyDustWithLotsScraping: true,
        commercialMultiTenant: true,
        tomorrowSchedule: true,
      },
    },
  };
}

export function loadPricingConfig(): PricingConfig {
  if (typeof window === 'undefined') {
    return createDefaultPricingConfig();
  }

  const raw = localStorage.getItem(PRICING_STORAGE_KEY);
  if (!raw) {
    return createDefaultPricingConfig();
  }

  try {
    const parsed = JSON.parse(raw) as PricingConfig;
    if (parsed.version !== 2) {
      return createDefaultPricingConfig();
    }

    return parsed;
  } catch {
    return createDefaultPricingConfig();
  }
}

export function savePricingConfig(config: PricingConfig): PricingConfig {
  const toSave: PricingConfig = {
    ...config,
    updatedAt: nowIso(),
  };

  if (typeof window !== 'undefined') {
    localStorage.setItem(PRICING_STORAGE_KEY, JSON.stringify(toSave));
  }

  return toSave;
}

export function resetPricingConfig(): PricingConfig {
  const defaults = createDefaultPricingConfig();

  if (typeof window !== 'undefined') {
    localStorage.setItem(PRICING_STORAGE_KEY, JSON.stringify(defaults));
  }

  return defaults;
}

export function loadEstimateRecords(): EstimateRecord[] {
  if (typeof window === 'undefined') {
    return [];
  }

  const raw = localStorage.getItem(QUOTE_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as EstimateRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveEstimateRecord(record: Omit<EstimateRecord, 'id' | 'quoteNumber' | 'createdAt' | 'utm'>): EstimateRecord {
  const normalized: EstimateRecord = {
    ...record,
    id: Math.random().toString(36).slice(2, 11),
    quoteNumber: quoteNumber(),
    createdAt: nowIso(),
    utm: getUtmParams(),
  };

  if (typeof window !== 'undefined') {
    const existing = loadEstimateRecords();
    const updated = [normalized, ...existing].slice(0, 300);
    localStorage.setItem(QUOTE_STORAGE_KEY, JSON.stringify(updated));
  }

  return normalized;
}

export function detectZoneFromPostalCode(postalCode: string): WindowZone {
  const normalized = postalCode.replace(/\s+/g, '').toUpperCase();

  if (normalized.startsWith('R5G') || normalized.startsWith('R5A') || normalized.startsWith('R0A')) {
    return 'zoneA';
  }

  if (normalized.startsWith('R0E') || normalized.startsWith('R0B') || normalized.startsWith('R5H')) {
    return 'zoneB';
  }

  if (normalized.startsWith('R2') || normalized.startsWith('R3')) {
    return 'zoneC';
  }

  return 'zoneD';
}

export function formatBookingMode(mode: BookingMode): string {
  if (mode === 'instant_book') {
    return 'Instant estimate and booking available';
  }

  if (mode === 'confirm_by_text') {
    return 'Estimate is likely accurate, we will confirm by text/call';
  }

  return 'On-site or phone quote required';
}

export function formatConfidence(confidence: ConfidenceLevel): string {
  if (confidence === 'green') {
    return 'Green';
  }

  if (confidence === 'yellow') {
    return 'Yellow';
  }

  return 'Red';
}

export function formatServiceLabel(serviceType: ServiceType): string {
  if (serviceType === 'window') {
    return 'Residential Window Cleaning';
  }

  if (serviceType === 'commercialWindow') {
    return 'Commercial Window Cleaning';
  }

  if (serviceType === 'carpet') {
    return 'Carpet Cleaning';
  }

  return 'Post-Construction Cleaning';
}

export function formatZoneLabel(zone: WindowZone): string {
  if (zone === 'zoneA') {
    return 'Zone A (Steinbach + 15km)';
  }
  if (zone === 'zoneB') {
    return 'Zone B (15km - 35km)';
  }
  if (zone === 'zoneC') {
    return 'Zone C (Winnipeg trips)';
  }

  return 'Zone D (Extended rural)';
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  }).format(value);
}
