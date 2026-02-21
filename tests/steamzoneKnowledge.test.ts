import { describe, expect, it } from 'vitest';
import { searchSteamZoneKnowledge } from '../src/estimate/core/steamzoneKnowledge';

describe('steamzone knowledge search', () => {
  it('returns the business address for address-related queries', () => {
    const matches = searchSteamZoneKnowledge('What is your business address?');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]?.answer).toMatch(/120 Parkside Crescent/i);
  });

  it('prefers the current business phone number', () => {
    const matches = searchSteamZoneKnowledge('What is your phone number?');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]?.answer).toMatch(/\(236\)\s*506-6570/);
  });

  it('returns no confident match for unsupported ownership questions', () => {
    const matches = searchSteamZoneKnowledge('Who owns this company?');
    expect(matches.length).toBe(0);
  });
});
