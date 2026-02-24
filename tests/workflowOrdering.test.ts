import { describe, expect, it } from 'vitest';
import {
  getRequiredVisibleFieldsInOrder,
} from '../src/quote/schema';

describe('deterministic workflow ordering', () => {
  it('matches schema order for residential windows', () => {
    const answers = {
      serviceType: 'window',
      slidingRemoval: 'threePanel',
      patioDoors: 'slideOnly',
      skylights: 'both',
    };
    const actual = getRequiredVisibleFieldsInOrder(answers).map((field) => field.key);
    expect(actual.indexOf('slidingRemoval')).toBeLessThan(actual.indexOf('slidingQuantity'));
    expect(actual.indexOf('patioDoors')).toBeLessThan(actual.indexOf('patioQuantity'));
    expect(actual.indexOf('skylights')).toBeLessThan(actual.indexOf('skylightQuantity'));
  });

  it('matches schema order for commercial windows', () => {
    const answers = {
      serviceType: 'commercialWindow',
      sizeMode: 'paneCount',
    };
    const actual = getRequiredVisibleFieldsInOrder(answers).map((field) => field.key);
    expect(actual.indexOf('buildingType')).toBeLessThan(actual.indexOf('storeys'));
    expect(actual.indexOf('storeys')).toBeLessThan(actual.indexOf('sizeMode'));
    expect(actual.indexOf('sizeMode')).toBeLessThan(actual.indexOf('paneCount'));
    expect(actual.indexOf('paneCount')).toBeLessThan(actual.indexOf('scope'));
    expect(actual.indexOf('scope')).toBeLessThan(actual.indexOf('frequency'));
  });

  it('matches schema order for carpet', () => {
    const answers = {
      serviceType: 'carpet',
      estimateMode: 'rooms',
    };
    const actual = getRequiredVisibleFieldsInOrder(answers).map((field) => field.key);
    expect(actual.indexOf('estimateMode')).toBeLessThan(actual.indexOf('rooms'));
    expect(actual.indexOf('rooms')).toBeLessThan(actual.indexOf('condition'));
    expect(actual.indexOf('condition')).toBeLessThan(actual.indexOf('stairsSteps'));
    expect(actual.indexOf('stairsSteps')).toBeLessThan(actual.indexOf('contact.fullName'));
  });

  it('matches schema order for post-construction', () => {
    const answers = {
      serviceType: 'postConstruction',
    };
    const actual = getRequiredVisibleFieldsInOrder(answers).map((field) => field.key);
    expect(actual.indexOf('projectType')).toBeLessThan(actual.indexOf('buildType'));
    expect(actual.indexOf('buildType')).toBeLessThan(actual.indexOf('sqftBracket'));
    expect(actual.indexOf('sqftBracket')).toBeLessThan(actual.indexOf('floors'));
    expect(actual.indexOf('stage')).toBeLessThan(actual.indexOf('dustLoad'));
  });
});
