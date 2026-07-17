import {
  normalizeJourneyUrl,
  setJourneyStepWeights,
  getJourneyStepWeights,
  clearJourneyStepWeights,
  resetJourneyWeightsForTests,
} from './journey-weights';

const JOURNEY = 'https://example.com/lj';

describe('journey step weights store', () => {
  beforeEach(() => {
    resetJourneyWeightsForTests();
  });

  it('normalizes trailing slashes', () => {
    expect(normalizeJourneyUrl('https://example.com/lj///')).toBe(JOURNEY);
    expect(normalizeJourneyUrl(JOURNEY)).toBe(JOURNEY);
  });

  it('returns null before weights resolve and the stored map after', () => {
    expect(getJourneyStepWeights(JOURNEY)).toBeNull();
    setJourneyStepWeights(`${JOURNEY}/`, new Map([['m1', 4]]));
    expect(getJourneyStepWeights(JOURNEY)?.get('m1')).toBe(4);
    expect(getJourneyStepWeights(`${JOURNEY}//`)?.get('m1')).toBe(4);
  });

  it('stores a copy so later mutation of the input map has no effect', () => {
    const input = new Map([['m1', 2]]);
    setJourneyStepWeights(JOURNEY, input);
    input.set('m1', 99);
    expect(getJourneyStepWeights(JOURNEY)?.get('m1')).toBe(2);
  });

  it('clears one journey or all journeys', () => {
    setJourneyStepWeights(JOURNEY, new Map([['m1', 2]]));
    setJourneyStepWeights('https://example.com/other', new Map([['m1', 3]]));
    clearJourneyStepWeights(JOURNEY);
    expect(getJourneyStepWeights(JOURNEY)).toBeNull();
    expect(getJourneyStepWeights('https://example.com/other')).not.toBeNull();
    clearJourneyStepWeights();
    expect(getJourneyStepWeights('https://example.com/other')).toBeNull();
  });
});
