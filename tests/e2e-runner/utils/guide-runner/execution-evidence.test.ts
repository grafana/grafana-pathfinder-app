jest.mock('@playwright/test', () => ({ expect: jest.fn() }));
jest.mock('./requirements', () => ({
  handleRequirementsWithFix: jest.fn().mockResolvedValue({
    requirements: { requirementsMet: true, status: 'met' },
  }),
  validateSession: jest.fn().mockResolvedValue({ valid: true }),
}));

import type { Page } from '@playwright/test';

import { getStepDriver } from './drivers';
import { executeStep } from './execution';
import type { StepSubstepResult, TestableStep } from './types';

function fixture() {
  const locator = {
    count: jest.fn().mockResolvedValue(1),
    getAttribute: jest.fn().mockResolvedValue('idle'),
    scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
  };
  const page = {
    getByTestId: jest.fn(() => locator),
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    off: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
    url: jest.fn(() => 'http://localhost:3000/'),
  } as unknown as Page;
  const step: TestableStep = {
    stepId: 'guided',
    stepKind: 'guided',
    index: 0,
    actionCount: 3,
    skippable: false,
    hasDoItButton: true,
    hasShowMeButton: false,
    isPreCompleted: false,
    locator: locator as unknown as TestableStep['locator'],
  };
  return { page, step };
}

describe('executeStep substep evidence', () => {
  const substeps: StepSubstepResult[] = [
    { index: 0, action: 'button', status: 'completed', durationMs: 10 },
    { index: 1, action: 'hover', status: 'skipped', durationMs: 20 },
  ];

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('keeps earlier settlements when the driver throws', async () => {
    jest.spyOn(getStepDriver('guided'), 'execute').mockImplementation(async ({ onSubsteps }) => {
      onSubsteps?.(substeps);
      throw new Error('A later target was not actionable');
    });
    const { page, step } = fixture();

    const result = await executeStep(page, step);

    expect(result).toMatchObject({ status: 'failed', substeps, error: 'A later target was not actionable' });
    expect(result.substeps).toHaveLength(2);
  });

  it('keeps collected settlements when neither the driver nor its drain settles', async () => {
    jest.useFakeTimers();
    jest.spyOn(getStepDriver('guided'), 'execute').mockImplementation(({ onSubsteps }) => {
      onSubsteps?.([substeps[0]!]);
      onSubsteps?.(substeps);
      return new Promise(() => undefined);
    });
    const { page, step } = fixture();
    const pending = executeStep(page, step, { deadlineMs: 100 });

    await jest.advanceTimersByTimeAsync(1100);

    await expect(pending).resolves.toMatchObject({ status: 'failed', deadlineExceeded: true, substeps });
    expect(page.close).toHaveBeenCalledTimes(1);
  });

  it('uses the last corrected record without appending a duplicate', async () => {
    const corrected: StepSubstepResult[] = [{ ...substeps[0]!, status: 'error' }];
    jest.spyOn(getStepDriver('guided'), 'execute').mockImplementation(async ({ onSubsteps }) => {
      onSubsteps?.([substeps[0]!]);
      onSubsteps?.(corrected);
      throw new Error('Completion callback failed');
    });
    const { page, step } = fixture();

    expect(await executeStep(page, step)).toMatchObject({ status: 'failed', substeps: corrected });
  });

  it('does not add evidence to a legacy result', async () => {
    jest.spyOn(getStepDriver('guided'), 'execute').mockResolvedValue({ outcome: 'completed' });
    const { page, step } = fixture();

    expect(await executeStep(page, step)).not.toHaveProperty('substeps');
  });
});
