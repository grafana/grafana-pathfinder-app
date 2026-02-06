/**
 * Unit tests for guide-runner discovery (Phase 5).
 *
 * Covers guided step detection: when the DOM has data-targetaction="guided"
 * and data-test-substep-total, discovered metadata has isGuided and guidedStepCount.
 */

jest.mock('@playwright/test', () => ({
  Page: jest.fn(),
  Locator: jest.fn(),
  expect: jest.fn(),
  test: jest.fn(),
}));

import type { Locator } from '@playwright/test';
import { extractGuidedInfo } from './discovery';

function createMockLocator(attributes: Record<string, string | null>): Locator {
  return {
    getAttribute: jest.fn().mockImplementation((name: string) => Promise.resolve(attributes[name] ?? null)),
  } as unknown as Locator;
}

describe('extractGuidedInfo', () => {
  it('returns isGuided: true and guidedStepCount from data-test-substep-total when targetAction is guided', async () => {
    const stepElement = createMockLocator({
      'data-test-substep-total': '3',
    });

    const result = await extractGuidedInfo(stepElement, 'guided');

    expect(result).toEqual({ isGuided: true, guidedStepCount: 3 });
  });

  it('returns isGuided: false and guidedStepCount 1 when targetAction is not guided', async () => {
    const stepElement = createMockLocator({
      'data-test-substep-total': '5',
    });

    const result = await extractGuidedInfo(stepElement, 'button');

    expect(result).toEqual({ isGuided: false, guidedStepCount: 1 });
  });

  it('returns isGuided: false for multistep targetAction', async () => {
    const stepElement = createMockLocator({
      'data-test-substep-total': '2',
    });

    const result = await extractGuidedInfo(stepElement, 'multistep');

    expect(result).toEqual({ isGuided: false, guidedStepCount: 1 });
  });

  it('falls back to guidedStepCount 1 when data-test-substep-total is missing for guided', async () => {
    const stepElement = createMockLocator({});

    const result = await extractGuidedInfo(stepElement, 'guided');

    expect(result).toEqual({ isGuided: true, guidedStepCount: 1 });
  });

  it('falls back to guidedStepCount 1 when data-test-substep-total is invalid for guided', async () => {
    const stepElement = createMockLocator({
      'data-test-substep-total': 'not-a-number',
    });

    const result = await extractGuidedInfo(stepElement, 'guided');

    expect(result).toEqual({ isGuided: true, guidedStepCount: 1 });
  });

  it('falls back to guidedStepCount 1 when data-test-substep-total is zero for guided', async () => {
    const stepElement = createMockLocator({
      'data-test-substep-total': '0',
    });

    const result = await extractGuidedInfo(stepElement, 'guided');

    expect(result).toEqual({ isGuided: true, guidedStepCount: 1 });
  });

  it('parses data-test-substep-total as integer for guided', async () => {
    const stepElement = createMockLocator({
      'data-test-substep-total': '7',
    });

    const result = await extractGuidedInfo(stepElement, 'guided');

    expect(result).toEqual({ isGuided: true, guidedStepCount: 7 });
  });
});
