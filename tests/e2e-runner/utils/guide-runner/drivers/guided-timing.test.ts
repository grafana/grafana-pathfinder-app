jest.mock('@playwright/test', () => ({ expect: jest.fn() }));
jest.mock('./shared', () => ({
  ...jest.requireActual('./shared'),
  startStepAction: jest.fn().mockResolvedValue({ outcome: 'started', action: 'do-it' }),
}));

import type { Locator, Page } from '@playwright/test';

import { DEFAULT_STEP_TIMEOUT_MS } from '../constants';
import type { TestableStep } from '../types';
import { executeGuidedStep } from './guided';
import { getStepDriver } from './registry';

function fixture(timeoutMs: number | undefined, actionCount: number, settles = true) {
  let elapsed = 0;
  const effectiveTimeout = timeoutMs ?? 120000;
  const interval = effectiveTimeout + 500;
  jest.spyOn(Date, 'now').mockImplementation(() => elapsed);
  const handle = {
    evaluate: jest.fn(async () => ({
      attached: true,
      state: settles && elapsed >= interval * actionCount ? 'completed' : 'executing',
      index: String(settles ? Math.min(actionCount - 1, Math.floor(elapsed / interval)) : 0),
      skippable: 'false',
      timeout: timeoutMs === undefined ? null : String(timeoutMs),
      formState: null,
      results: JSON.stringify(
        Array.from({ length: actionCount }, (_, index) => ({
          index,
          action: 'noop',
          status: 'completed',
          durationMs: effectiveTimeout,
        })).filter((record) => settles && elapsed >= record.index * interval + effectiveTimeout)
      ),
    })),
    dispose: jest.fn().mockResolvedValue(undefined),
  };
  const root = {
    count: jest.fn().mockResolvedValue(1),
    elementHandle: jest.fn().mockResolvedValue(handle),
  } as unknown as Locator;
  const comments = {
    filter: jest.fn(),
    first: jest.fn(() => ({ count: jest.fn().mockResolvedValue(0) })),
  };
  comments.filter.mockReturnValue(comments);
  const page = {
    getByTestId: jest.fn(() => root),
    locator: jest.fn(() => comments),
    waitForTimeout: jest.fn(async (durationMs: number) => {
      elapsed += durationMs;
    }),
  } as unknown as Page;
  const step: TestableStep = {
    stepId: 'guided',
    stepKind: 'guided',
    index: 0,
    actionCount,
    substepTimeoutMs: timeoutMs,
    skippable: false,
    hasDoItButton: true,
    hasShowMeButton: false,
    isPreCompleted: false,
    locator: root,
  };
  return { page, step, elapsed: () => elapsed };
}

describe('guided runtime timing', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([30000, 45000, 60000, undefined])(
    'allows the full %s budget plus 500ms pacing for every substep',
    async (timeoutMs) => {
      const { page, step, elapsed } = fixture(timeoutMs, 3);
      const timeout = getStepDriver('guided').timeout(step);

      const result = await executeGuidedStep({ page, step, timeout, verbose: false });

      expect(result.outcome).toBe('completed');
      expect(result.substeps).toHaveLength(3);
      expect(elapsed()).toBeGreaterThanOrEqual(((timeoutMs ?? 120000) + 500) * 3);
      expect(elapsed()).toBeLessThan(timeout);
    }
  );

  it.each([30000, 45000, 60000, undefined])(
    'bounds an unsettled substep by the effective %s timeout',
    async (timeoutMs) => {
      const { page, step, elapsed } = fixture(timeoutMs, 1, false);
      const timeout = getStepDriver('guided').timeout(step);

      await expect(executeGuidedStep({ page, step, timeout, verbose: false })).rejects.toThrow('did not settle');

      expect(elapsed()).toBe(timeoutMs ?? 120000);
    }
  );

  it('uses the live DOM timeout instead of stale discovery metadata for execution', async () => {
    const { page, step, elapsed } = fixture(60000, 1, false);
    step.substepTimeoutMs = 30000;

    await expect(
      executeGuidedStep({ page, step, timeout: DEFAULT_STEP_TIMEOUT_MS + 60000, verbose: false })
    ).rejects.toThrow('did not settle');

    expect(elapsed()).toBe(60000);
  });
});
