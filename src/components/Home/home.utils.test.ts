/**
 * Tests for home page utility functions.
 */

import { getGuideEstimate } from './home.utils';

describe('getGuideEstimate', () => {
  it('returns the estimated minutes for a known guide', () => {
    expect(getGuideEstimate('welcome-to-grafana')).toBe(5);
    expect(getGuideEstimate('first-dashboard')).toBe(10);
  });

  it('returns default of 5 for an unknown guide', () => {
    expect(getGuideEstimate('nonexistent-guide')).toBe(5);
  });
});
