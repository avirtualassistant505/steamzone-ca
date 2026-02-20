import { describe, expect, it } from 'vitest';
import {
  calculateEstimate,
  createDefaultCarpetInput,
  createDefaultCommercialWindowInput,
  createDefaultPostConstructionInput,
  createDefaultPricingConfig,
  createDefaultWindowInput,
} from '../src/lib/estimateEngine';
import { computeDeterministicQuote } from '../src/quote/quoteEngine';

const contact = {
  fullName: 'Jane Test',
  address: '120 Parkside Crescent',
  phone: '(236) 506-6570',
  email: 'jane@example.com',
  consentToContact: true,
  marketingOptIn: false,
};

describe('quoteEngine', () => {
  it('matches residential window subtotal exactly', async () => {
    const answers = {
      serviceType: 'window',
      postalCode: 'R5G 2X3',
      zone: 'zoneA',
      storey: 'two',
      sizeBracket: '1500to2000',
      scope: 'both',
      screens: 'some',
      tracks: 'detailed',
      slidingRemoval: 'threePanel',
      slidingQuantity: 2,
      patioDoors: 'slideOnly',
      patioQuantity: 1,
      skylights: 'both',
      skylightQuantity: 1,
      railingGlass: 'none',
      frenchPanes: 'some',
      hardToReach: true,
      hardWaterRemoval: false,
      constructionDebris: false,
      sunroom: false,
      walkoutBasement: false,
      contact,
    };

    const quote = await computeDeterministicQuote(answers);

    const expectedInput = { ...createDefaultWindowInput(), ...answers, contact };
    const expected = calculateEstimate('window', expectedInput, createDefaultPricingConfig());
    expect(quote.total).toBe(expected.subtotal);
  });

  it('matches commercial window subtotal exactly', async () => {
    const answers = {
      serviceType: 'commercialWindow',
      postalCode: 'R2M 1A1',
      zone: 'zoneC',
      buildingType: 'storefront',
      storeys: 'ground',
      sizeMode: 'paneCount',
      paneCount: 20,
      frontageFeet: 0,
      glassDoors: 2,
      scope: 'both',
      frequency: 'monthly',
      liftRequired: false,
      afterHours: true,
      overspray: false,
      hardWater: true,
      contact,
    };

    const quote = await computeDeterministicQuote(answers);
    const expectedInput = { ...createDefaultCommercialWindowInput(), ...answers, contact };
    const expected = calculateEstimate('commercialWindow', expectedInput, createDefaultPricingConfig());
    expect(quote.total).toBe(expected.subtotal);
  });

  it('matches carpet subtotal for room-based estimate', async () => {
    const answers = {
      serviceType: 'carpet',
      postalCode: 'R5A 0A1',
      zone: 'zoneA',
      estimateMode: 'rooms',
      rooms: 4,
      sqftBracket: '1000to1500',
      condition: 'moderate',
      stairsSteps: 10,
      hallways: 1,
      advancedStainRemoval: true,
      odorElimination: false,
      petTreatment: false,
      stainProtector: true,
      furnitureMoving: 'light',
      unusualCondition: false,
      schedule: 'asap',
      contact,
    };

    const quote = await computeDeterministicQuote(answers);
    const expectedInput = { ...createDefaultCarpetInput(), ...answers, contact };
    const expected = calculateEstimate('carpet', expectedInput, createDefaultPricingConfig());
    expect(quote.total).toBe(expected.subtotal);
  });

  it('matches carpet subtotal for sqft estimate', async () => {
    const answers = {
      serviceType: 'carpet',
      postalCode: 'R0A 1B0',
      zone: 'zoneB',
      estimateMode: 'sqft',
      rooms: 0,
      sqftBracket: '1500to2000',
      condition: 'heavy',
      stairsSteps: 0,
      hallways: 0,
      advancedStainRemoval: false,
      odorElimination: true,
      petTreatment: true,
      stainProtector: true,
      furnitureMoving: 'none',
      unusualCondition: false,
      schedule: 'flexible',
      contact,
    };

    const quote = await computeDeterministicQuote(answers);
    const expectedInput = { ...createDefaultCarpetInput(), ...answers, contact };
    const expected = calculateEstimate('carpet', expectedInput, createDefaultPricingConfig());
    expect(quote.total).toBe(expected.subtotal);
  });

  it('matches post-construction subtotal exactly', async () => {
    const answers = {
      serviceType: 'postConstruction',
      postalCode: 'R3C 1A1',
      zone: 'zoneC',
      projectType: 'commercial',
      buildType: 'newBuild',
      sqftBracket: '2500to5000',
      floors: 2,
      stage: 'final',
      dustLoad: 'medium',
      interiorWindows: 'medium',
      scraping: 'some',
      insideCabinets: true,
      appliances: false,
      floorDetailing: 'small',
      specialDetailing: true,
      multiTenantAccess: false,
      schedule: 'nextWeek',
      contact,
    };

    const quote = await computeDeterministicQuote(answers);
    const expectedInput = { ...createDefaultPostConstructionInput(), ...answers, contact };
    const expected = calculateEstimate('postConstruction', expectedInput, createDefaultPricingConfig());
    expect(quote.total).toBe(expected.subtotal);
  });

  it('always returns CAD and v1 output format', async () => {
    const quote = await computeDeterministicQuote({
      serviceType: 'window',
      postalCode: 'R5G 2X3',
      zone: 'zoneA',
      storey: 'bungalow',
      sizeBracket: 'under1000',
      scope: 'exterior',
      screens: 'none',
      tracks: 'basic',
      slidingRemoval: 'none',
      patioDoors: 'none',
      skylights: 'none',
      railingGlass: 'none',
      frenchPanes: 'none',
      contact,
    });

    expect(quote.currency).toBe('CAD');
    expect(quote.version).toBe('v1');
    expect(quote.quote_id).toMatch(/^Q-/);
  });

  it('includes low/high line items derived from deterministic result', async () => {
    const answers = {
      serviceType: 'window',
      postalCode: 'R5G 2X3',
      zone: 'zoneA',
      storey: 'bungalow',
      sizeBracket: '1000to1500',
      scope: 'both',
      screens: 'some',
      tracks: 'basic',
      slidingRemoval: 'none',
      patioDoors: 'none',
      skylights: 'none',
      railingGlass: 'none',
      frenchPanes: 'none',
      contact,
    };

    const quote = await computeDeterministicQuote(answers);
    const low = quote.line_items.find((line) => line.label === 'Low estimate');
    const high = quote.line_items.find((line) => line.label === 'High estimate');

    expect(low).toBeTruthy();
    expect(high).toBeTruthy();
    expect((low?.amount ?? 0) <= (high?.amount ?? 0)).toBe(true);
  });

  it('throws for missing serviceType', async () => {
    await expect(
      computeDeterministicQuote({
        postalCode: 'R5G 2X3',
      })
    ).rejects.toThrow(/serviceType/i);
  });
});
