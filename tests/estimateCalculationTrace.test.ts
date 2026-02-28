import { describe, expect, it } from 'vitest';
import { calculateEstimate, createDefaultCarpetInput, createDefaultPricingConfig } from '../server/estimateEngine';
import { buildEstimateCalculationTrace } from '../server/estimateCalculationTrace';

describe('estimateCalculationTrace', () => {
  it('captures carpet line-item math with expected subtotal trace', () => {
    const config = createDefaultPricingConfig();
    const input = {
      ...createDefaultCarpetInput(),
      postalCode: 'R5G 0H4',
      zone: 'zoneA' as const,
      estimateMode: 'rooms' as const,
      rooms: 6,
      condition: 'light' as const,
      stairsSteps: 2,
      hallways: 2,
      furnitureMoving: 'heavy' as const,
      advancedStainRemoval: true,
      odorElimination: false,
      petTreatment: true,
      stainProtector: true,
      unusualCondition: false,
      schedule: 'flexible' as const,
    };

    const result = calculateEstimate('carpet', input, config);
    const trace = buildEstimateCalculationTrace('carpet', input, config, result);

    expect(result.subtotal).toBe(610);
    expect(result.estimateLow).toBe(549);
    expect(result.estimateHigh).toBe(702);
    expect(trace.subtotalRaw).toBe(610);
    expect(trace.subtotalFinal).toBe(610);
    expect(trace.lineItems.some((item) => item.key === 'travel' && item.amount === 25)).toBe(true);
    expect(trace.lineItems.some((item) => item.key === 'stainProtector' && item.amount === 150)).toBe(true);
  });

  it('reflects zone fee differences in trace and totals', () => {
    const config = createDefaultPricingConfig();
    const baseInput = {
      ...createDefaultCarpetInput(),
      estimateMode: 'rooms' as const,
      rooms: 6,
      condition: 'light' as const,
      stairsSteps: 2,
      hallways: 2,
      furnitureMoving: 'heavy' as const,
      advancedStainRemoval: true,
      odorElimination: false,
      petTreatment: true,
      stainProtector: true,
    };

    const zoneAResult = calculateEstimate('carpet', { ...baseInput, zone: 'zoneA' }, config);
    const zoneATrace = buildEstimateCalculationTrace('carpet', { ...baseInput, zone: 'zoneA' }, config, zoneAResult);
    const zoneCResult = calculateEstimate('carpet', { ...baseInput, zone: 'zoneC' }, config);
    const zoneCTrace = buildEstimateCalculationTrace('carpet', { ...baseInput, zone: 'zoneC' }, config, zoneCResult);

    expect(zoneCResult.subtotal - zoneAResult.subtotal).toBe(70);
    expect(zoneCTrace.subtotalRaw - zoneATrace.subtotalRaw).toBe(70);

    const zoneATravel = zoneATrace.lineItems.find((item) => item.key === 'travel');
    const zoneCTravel = zoneCTrace.lineItems.find((item) => item.key === 'travel');
    expect(zoneATravel?.amount).toBe(25);
    expect(zoneCTravel?.amount).toBe(95);
  });
});
