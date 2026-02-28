import type {
  CarpetEstimateInput,
  CommercialWindowEstimateInput,
  EstimateCalculationLineItem,
  EstimateCalculationTrace,
  EstimateResult,
  PostConstructionEstimateInput,
  PricingConfig,
  ServiceType,
  SkylightOption,
  WindowEstimateInput,
  WindowZone,
} from './estimateEngine.js';

type EstimateInput =
  | WindowEstimateInput
  | CommercialWindowEstimateInput
  | CarpetEstimateInput
  | PostConstructionEstimateInput;

const CARPET_SQFT_ESTIMATES: Record<CarpetEstimateInput['sqftBracket'], number> = {
  under500: 425,
  '500to1000': 750,
  '1000to1500': 1250,
  '1500to2000': 1750,
  over2000: 2300,
};

function roundTrace(value: number): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  return Math.round(value * 10000) / 10000;
}

function toLineItem(key: string, label: string, amount: number, formula?: string): EstimateCalculationLineItem {
  return {
    key,
    label,
    amount: roundTrace(amount),
    ...(formula ? { formula } : {}),
  };
}

function ensureFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`Non-finite value in calculation trace for ${label}.`);
  }
  return value;
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

function baseTrace(
  serviceType: ServiceType,
  zone: WindowZone,
  config: PricingConfig,
  result: EstimateResult,
  lineItems: EstimateCalculationLineItem[],
  subtotalRaw: number,
  minimumCharge: number,
  factors: Record<string, number | string | boolean>
): EstimateCalculationTrace {
  const normalizedRaw = ensureFinite(subtotalRaw, 'subtotalRaw');
  const normalizedMin = ensureFinite(minimumCharge, 'minimumCharge');
  const normalizedSubtotal = ensureFinite(result.subtotal, 'result.subtotal');

  return {
    version: 'v1',
    serviceType,
    zone,
    pricingVersion: config.version,
    estimateRange: {
      lowMultiplier: roundTrace(config.estimateRange.lowMultiplier),
      highMultiplier: roundTrace(config.estimateRange.highMultiplier),
    },
    lineItems,
    subtotalRaw: roundTrace(normalizedRaw),
    minimumCharge: roundTrace(normalizedMin),
    minimumApplied: normalizedSubtotal > normalizedRaw,
    subtotalFinal: roundTrace(normalizedSubtotal),
    estimateLow: roundTrace(ensureFinite(result.estimateLow, 'result.estimateLow')),
    estimateHigh: roundTrace(ensureFinite(result.estimateHigh, 'result.estimateHigh')),
    duration: {
      rawHours: roundTrace(ensureFinite(result.durationLowHours + (result.durationHighHours - result.durationLowHours) / 2, 'durationMid')),
      lowHours: roundTrace(ensureFinite(result.durationLowHours, 'result.durationLowHours')),
      highHours: roundTrace(ensureFinite(result.durationHighHours, 'result.durationHighHours')),
    },
    factors,
  };
}

function withDurationRaw(trace: EstimateCalculationTrace, durationRawHours: number): EstimateCalculationTrace {
  const normalized = ensureFinite(durationRawHours, 'durationRawHours');
  return {
    ...trace,
    duration: {
      ...trace.duration,
      rawHours: roundTrace(normalized),
    },
  };
}

function baseTraceWithDuration(
  serviceType: ServiceType,
  zone: WindowZone,
  config: PricingConfig,
  result: EstimateResult,
  lineItems: EstimateCalculationLineItem[],
  subtotalRaw: number,
  minimumCharge: number,
  durationRawHours: number,
  factors: Record<string, number | string | boolean>
): EstimateCalculationTrace {
  const trace = baseTrace(serviceType, zone, config, result, lineItems, subtotalRaw, minimumCharge, factors);
  return withDurationRaw(trace, durationRawHours);
}

function buildWindowTrace(input: WindowEstimateInput, config: PricingConfig, result: EstimateResult): EstimateCalculationTrace {
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
  const sunroomCost = input.sunroom ? config.window.addOns.sunroom : 0;
  const walkoutCost = input.walkoutBasement ? config.window.addOns.walkout : 0;
  const hardToReachCost = input.hardToReach ? basePaneCost * (config.window.addOns.hardToReachPercent / 100) : 0;
  const hardWaterCost = input.hardWaterRemoval ? config.window.addOns.hardWaterRemoval : 0;
  const constructionDebrisCost = input.constructionDebris ? config.window.addOns.constructionDebris : 0;
  const travel = travelFee(input.zone, config);

  const subtotalRaw =
    travel +
    basePaneCost +
    screensCost +
    tracksCost +
    slidingCost +
    patioCost +
    skylightCost +
    railingCost +
    frenchCost +
    sunroomCost +
    walkoutCost +
    hardToReachCost +
    hardWaterCost +
    constructionDebrisCost;

  const durationRawHours =
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

  const lineItems: EstimateCalculationLineItem[] = [
    toLineItem('travel', 'Travel fee', travel, `zone=${input.zone}`),
    toLineItem('basePaneCost', 'Base pane cost', basePaneCost, `${paneEstimate} * ${config.window.perPaneRate} * ${storeyMultiplier} * ${scopeMultiplier}`),
    toLineItem('screens', 'Screens add-on', screensCost),
    toLineItem('tracks', 'Tracks & sills add-on', tracksCost),
    toLineItem('sliding', 'Sliding window add-on', slidingCost),
    toLineItem('patio', 'Patio door add-on', patioCost),
    toLineItem('skylight', 'Skylight add-on', skylightCost),
    toLineItem('railing', 'Railing glass add-on', railingCost),
    toLineItem('french', 'French pane add-on', frenchCost),
    toLineItem('sunroom', 'Sunroom add-on', sunroomCost),
    toLineItem('walkout', 'Walkout basement add-on', walkoutCost),
    toLineItem('hardToReach', 'Hard-to-reach premium', hardToReachCost),
    toLineItem('hardWater', 'Hard water removal add-on', hardWaterCost),
    toLineItem('constructionDebris', 'Construction debris add-on', constructionDebrisCost),
  ];

  return baseTraceWithDuration('window', input.zone, config, result, lineItems, subtotalRaw, config.window.minimumCharge, durationRawHours, {
    paneEstimate,
    storeyMultiplier,
    scopeMultiplier,
    screensOption: input.screens,
    tracksOption: input.tracks,
    lowMultiplier: config.estimateRange.lowMultiplier,
    highMultiplier: config.estimateRange.highMultiplier,
  });
}

function buildCommercialTrace(
  input: CommercialWindowEstimateInput,
  config: PricingConfig,
  result: EstimateResult
): EstimateCalculationTrace {
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

  const afterHoursMultiplier = input.afterHours ? 1 + config.commercialWindow.addOns.afterHoursPercent / 100 : 1;
  const laborAfterHours = labor * afterHoursMultiplier;
  const oversprayCost = input.overspray ? paneEstimate * config.commercialWindow.addOns.oversprayPerPane : 0;
  const hardWaterCost = input.hardWater ? paneEstimate * config.commercialWindow.addOns.hardWaterPerPane : 0;
  const travel = travelFee(input.zone, config);
  const preDiscount = laborAfterHours + oversprayCost + hardWaterCost + travel;
  const recurringDiscount = config.commercialWindow.recurringDiscountPercent[input.frequency] / 100;
  const discountAmount = preDiscount * recurringDiscount;
  const subtotalRaw = preDiscount - discountAmount;

  const durationRawHours =
    config.commercialWindow.duration.baseHours +
    (paneEstimate * config.commercialWindow.duration.minutesPerPane) / 60 +
    (input.glassDoors * config.commercialWindow.duration.minutesPerDoor) / 60 +
    (input.afterHours ? config.commercialWindow.duration.afterHoursExtraHours : 0);

  const lineItems: EstimateCalculationLineItem[] = [
    toLineItem('labor', 'Labor base', labor),
    toLineItem('afterHours', 'After-hours multiplier impact', laborAfterHours - labor, `${afterHoursMultiplier}x`),
    toLineItem('overspray', 'Overspray add-on', oversprayCost),
    toLineItem('hardWater', 'Hard water add-on', hardWaterCost),
    toLineItem('travel', 'Travel fee', travel, `zone=${input.zone}`),
    toLineItem('discount', 'Recurring discount', -discountAmount, `${Math.round(recurringDiscount * 100)}%`),
  ];

  return baseTraceWithDuration(
    'commercialWindow',
    input.zone,
    config,
    result,
    lineItems,
    subtotalRaw,
    config.commercialWindow.minimumCharge,
    durationRawHours,
    {
      paneEstimate,
      buildingType: input.buildingType,
      scope: input.scope,
      frequency: input.frequency,
      afterHoursMultiplier,
      recurringDiscountPercent: Math.round(recurringDiscount * 100),
      lowMultiplier: config.estimateRange.lowMultiplier,
      highMultiplier: config.estimateRange.highMultiplier,
    }
  );
}

function buildCarpetTrace(input: CarpetEstimateInput, config: PricingConfig, result: EstimateResult): EstimateCalculationTrace {
  const estimatedSqft =
    input.estimateMode === 'sqft' ? CARPET_SQFT_ESTIMATES[input.sqftBracket] : Math.max(350, input.rooms * 180);
  const basePrice =
    input.estimateMode === 'rooms'
      ? roomPackageBasePrice(input.rooms, config.carpet.roomPackages)
      : estimatedSqft * config.carpet.baseRatePerSqft;
  const conditionMultiplier = config.carpet.conditionMultipliers[input.condition];
  const baseAfterCondition = basePrice * conditionMultiplier;
  const stairsCost = input.stairsSteps * config.carpet.stairsPerStep;
  const hallwayCost = input.hallways * config.carpet.hallwayPrice;
  const furnitureCost =
    input.furnitureMoving === 'heavy'
      ? config.carpet.addOns.furnitureHeavy
      : input.furnitureMoving === 'light'
        ? config.carpet.addOns.furnitureLight
        : 0;
  const stainRemovalCost = input.advancedStainRemoval ? config.carpet.addOns.advancedStainRemoval : 0;
  const odorCost = input.odorElimination ? config.carpet.addOns.odorElimination : 0;
  const petCost = input.petTreatment ? config.carpet.addOns.petTreatment : 0;
  const protectorCost = input.stainProtector
    ? input.estimateMode === 'sqft'
      ? estimatedSqft * config.carpet.addOns.protectorPerSqft
      : input.rooms * config.carpet.addOns.protectorPerRoom
    : 0;
  const travel = travelFee(input.zone, config);
  const subtotalRaw = baseAfterCondition + stairsCost + hallwayCost + furnitureCost + stainRemovalCost + odorCost + petCost + protectorCost + travel;

  const durationRawHours =
    config.carpet.duration.baseHours +
    (input.estimateMode === 'rooms'
      ? (input.rooms * config.carpet.duration.minutesPerRoom) / 60
      : ((estimatedSqft / 100) * config.carpet.duration.minutesPer100Sqft) / 60) +
    (input.stairsSteps * config.carpet.duration.minutesPerStair) / 60 +
    (input.hallways * config.carpet.duration.minutesPerHallway) / 60 +
    (input.advancedStainRemoval ? config.carpet.duration.stainHours : 0) +
    (input.odorElimination ? config.carpet.duration.odorHours : 0) +
    (input.stainProtector ? config.carpet.duration.protectorHours : 0);

  const lineItems: EstimateCalculationLineItem[] = [
    toLineItem('base', 'Base cleaning price', basePrice, input.estimateMode === 'rooms' ? `room package (${input.rooms})` : `${estimatedSqft} * ${config.carpet.baseRatePerSqft}`),
    toLineItem('conditionMultiplier', 'Condition multiplier impact', baseAfterCondition - basePrice, `${conditionMultiplier}x`),
    toLineItem('stairs', 'Stairs add-on', stairsCost, `${input.stairsSteps} * ${config.carpet.stairsPerStep}`),
    toLineItem('hallways', 'Hallways add-on', hallwayCost, `${input.hallways} * ${config.carpet.hallwayPrice}`),
    toLineItem('furniture', 'Furniture moving add-on', furnitureCost, input.furnitureMoving),
    toLineItem('advancedStainRemoval', 'Advanced stain removal', stainRemovalCost),
    toLineItem('odorElimination', 'Odor elimination', odorCost),
    toLineItem('petTreatment', 'Pet treatment', petCost),
    toLineItem('stainProtector', 'Stain protector', protectorCost),
    toLineItem('travel', 'Travel fee', travel, `zone=${input.zone}`),
  ];

  return baseTraceWithDuration('carpet', input.zone, config, result, lineItems, subtotalRaw, config.carpet.minimumCharge, durationRawHours, {
    estimateMode: input.estimateMode,
    rooms: input.rooms,
    estimatedSqft,
    conditionMultiplier,
    furnitureMoving: input.furnitureMoving,
    lowMultiplier: config.estimateRange.lowMultiplier,
    highMultiplier: config.estimateRange.highMultiplier,
  });
}

function buildPostConstructionTrace(
  input: PostConstructionEstimateInput,
  config: PricingConfig,
  result: EstimateResult
): EstimateCalculationTrace {
  const estimatedSqft = config.postConstruction.sizeSqftEstimates[input.sqftBracket];
  const stageRate = config.postConstruction.stageRates[input.stage];
  const dustMultiplier = config.postConstruction.dustMultipliers[input.dustLoad];
  const base = estimatedSqft * stageRate * dustMultiplier;
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
  const specialHours = input.specialDetailing ? config.postConstruction.addOns.specialDetailingEstimatedHours[input.sqftBracket] : 0;
  const specialCost = specialHours * config.postConstruction.addOns.specialDetailingHourly;
  const travel = travelFee(input.zone, config);
  const subtotalRaw = base + interiorWindowsCost + floorDetailingCost + scrapingCost + cabinetsCost + appliancesCost + specialCost + travel;

  const durationRawHours =
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

  const lineItems: EstimateCalculationLineItem[] = [
    toLineItem('base', 'Base stage + dust cost', base, `${estimatedSqft} * ${stageRate} * ${dustMultiplier}`),
    toLineItem('interiorWindows', 'Interior windows add-on', interiorWindowsCost),
    toLineItem('floorDetailing', 'Floor detailing add-on', floorDetailingCost),
    toLineItem('scraping', 'Scraping add-on', scrapingCost),
    toLineItem('insideCabinets', 'Inside cabinets add-on', cabinetsCost),
    toLineItem('appliances', 'Appliances add-on', appliancesCost),
    toLineItem('specialDetailing', 'Special detailing add-on', specialCost),
    toLineItem('travel', 'Travel fee', travel, `zone=${input.zone}`),
  ];

  return baseTraceWithDuration('postConstruction', input.zone, config, result, lineItems, subtotalRaw, config.postConstruction.minimumCharge, durationRawHours, {
    estimatedSqft,
    stage: input.stage,
    dustLoad: input.dustLoad,
    stageRate,
    dustMultiplier,
    specialHours,
    lowMultiplier: config.estimateRange.lowMultiplier,
    highMultiplier: config.estimateRange.highMultiplier,
  });
}

export function buildEstimateCalculationTrace(
  serviceType: ServiceType,
  input: EstimateInput,
  config: PricingConfig,
  result: EstimateResult
): EstimateCalculationTrace {
  if (serviceType === 'window') {
    return buildWindowTrace(input as WindowEstimateInput, config, result);
  }

  if (serviceType === 'commercialWindow') {
    return buildCommercialTrace(input as CommercialWindowEstimateInput, config, result);
  }

  if (serviceType === 'carpet') {
    return buildCarpetTrace(input as CarpetEstimateInput, config, result);
  }

  return buildPostConstructionTrace(input as PostConstructionEstimateInput, config, result);
}
