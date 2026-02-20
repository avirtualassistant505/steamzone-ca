import { describe, expect, it } from 'vitest';
import { normalizeAndValidateField } from '../src/quote/normalization';

describe('normalize_and_validate', () => {
  it('parses yes slang for booleans', () => {
    const result = normalizeAndValidateField('hardToReach', 'yep', { serviceType: 'window' });
    expect(result.ok).toBe(true);
    expect(result.normalized_value).toBe(true);
  });

  it('parses no slang for booleans', () => {
    const result = normalizeAndValidateField('afterHours', 'nah', { serviceType: 'commercialWindow' });
    expect(result.ok).toBe(true);
    expect(result.normalized_value).toBe(false);
  });

  it('parses scaled k-number values', () => {
    const result = normalizeAndValidateField('frontageFeet', '2k', {
      serviceType: 'commercialWindow',
      sizeMode: 'frontage',
    });
    expect(result.ok).toBe(true);
    expect(result.normalized_value).toBe(2000);
  });

  it('parses comma-formatted integers', () => {
    const result = normalizeAndValidateField('paneCount', '2,000', {
      serviceType: 'commercialWindow',
      sizeMode: 'paneCount',
    });
    expect(result.ok).toBe(true);
    expect(result.normalized_value).toBe(2000);
  });

  it('parses numbers with units', () => {
    const result = normalizeAndValidateField('stairsSteps', '14 steps', {
      serviceType: 'carpet',
    });
    expect(result.ok).toBe(true);
    expect(result.normalized_value).toBe(14);
  });

  it('parses dimensions by taking the leading value', () => {
    const result = normalizeAndValidateField('frontageFeet', '72x48x102', {
      serviceType: 'commercialWindow',
      sizeMode: 'frontage',
    });
    expect(result.ok).toBe(true);
    expect(result.normalized_value).toBe(72);
  });

  it('returns clarification for ranges', () => {
    const result = normalizeAndValidateField('paneCount', 'about 10-12 windows', {
      serviceType: 'commercialWindow',
      sizeMode: 'paneCount',
    });
    expect(result.ok).toBe(false);
    expect(result.needs_clarification).toBe(true);
    expect(result.error_message).toMatch(/ambiguous|range/i);
  });

  it('extracts structured room count from phrase', () => {
    const result = normalizeAndValidateField('rooms', '3 bedrooms and 2 baths', {
      serviceType: 'carpet',
      estimateMode: 'rooms',
    });
    expect(result.ok).toBe(true);
    expect(result.normalized_value).toBe(3);
  });

  it('normalizes Canadian postal codes', () => {
    const result = normalizeAndValidateField('postalCode', 'r5g2x3', {
      serviceType: 'window',
    });
    expect(result.ok).toBe(true);
    expect(result.normalized_value).toBe('R5G 2X3');
  });

  it('extracts emails from free text', () => {
    const result = normalizeAndValidateField('contact.email', 'my email is TEST.User+tag@example.com', {
      serviceType: 'window',
    });
    expect(result.ok).toBe(true);
    expect(result.normalized_value).toBe('test.user+tag@example.com');
  });

  it('asks clarification for same as last time', () => {
    const result = normalizeAndValidateField('projectType', 'same as last time', {
      serviceType: 'postConstruction',
    });
    expect(result.ok).toBe(false);
    expect(result.needs_clarification).toBe(true);
    expect(result.error_message).toMatch(/provide the value/i);
  });

  it('detects conflict when quantity is given without enabling parent option', () => {
    const result = normalizeAndValidateField('slidingQuantity', '2', {
      serviceType: 'window',
      slidingRemoval: 'none',
    });
    expect(result.ok).toBe(false);
    expect(result.needs_clarification).toBe(true);
    expect(result.error_message).toMatch(/sliding removal type/i);
  });

  it('maps fuzzy scope language to both', () => {
    const result = normalizeAndValidateField('scope', 'inside and outside', {
      serviceType: 'window',
    });
    expect(result.ok).toBe(true);
    expect(result.normalized_value).toBe('both');
  });

  it('fails invalid email format', () => {
    const result = normalizeAndValidateField('contact.email', 'this is not an email', {
      serviceType: 'window',
    });
    expect(result.ok).toBe(false);
    expect(result.needs_clarification).toBe(true);
  });
});
