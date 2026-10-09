jest.mock('@playwright/test', () => ({
  expect: () => ({
    toBeEnabled: jest.fn().mockResolvedValue(undefined),
  }),
}));

jest.mock('../badge-celebrations', () => ({
  dismissBadgeCelebrations: jest.fn().mockResolvedValue(undefined),
}));

import type { Locator, Page } from '@playwright/test';

import { startStepAction } from './shared';
import type { TestableStep } from '../types';

it('bounds action-button clicks with the step timeout and preserves actionability errors', async () => {
  const actionabilityError = new Error('element intercepts pointer events');
  const doItButton = {
    count: jest.fn().mockResolvedValue(1),
    click: jest.fn().mockRejectedValue(actionabilityError),
  } as unknown as Locator;
  const showMeButton = {
    count: jest.fn().mockResolvedValue(0),
  } as unknown as Locator;
  const page = {
    getByTestId: jest.fn((testId: string) => (testId.startsWith('interactive-do-it-') ? doItButton : showMeButton)),
  } as unknown as Page;
  const step = {
    stepId: 'blocked-step',
    hasDoItButton: true,
    hasShowMeButton: false,
  } as TestableStep;

  await expect(startStepAction({ page, step, timeout: 1234, verbose: false })).rejects.toBe(actionabilityError);

  expect(doItButton.click).toHaveBeenCalledWith({ timeout: 1234 });
});

it('accepts objective waiting when guided execution starts or a substep finishes', async () => {
  const { waitForGuidedExecutionStart, waitForSubstepAdvance } = await import('./guided');
  const stepLocator = {
    count: jest.fn().mockResolvedValue(1),
    getAttribute: jest.fn((name: string) => Promise.resolve(name === 'data-test-step-state' ? 'waiting' : '0')),
  } as unknown as Locator;
  const page = { waitForTimeout: jest.fn() } as unknown as Page;
  await waitForGuidedExecutionStart(page, stepLocator);
  await waitForSubstepAdvance(page, stepLocator, 0, 1000);
  expect(page.waitForTimeout).not.toHaveBeenCalled();
});

it('names the waiting objective when completion times out', async () => {
  const { waitForCompletion } = await import('./shared');
  const locator = {
    getAttribute: jest.fn().mockResolvedValue('waiting'),
    textContent: jest.fn().mockResolvedValue('Waiting for completion: Save a dashboard'),
  };
  const page = { getByTestId: jest.fn().mockReturnValue(locator) } as unknown as Page;
  await expect(waitForCompletion(page, 'step', 0)).rejects.toThrow(
    'Step step is waiting for completion after 0ms: Waiting for completion: Save a dashboard'
  );
  expect(locator.getAttribute).toHaveBeenCalledWith('data-test-step-state', { timeout: 2000 });
  expect(locator.textContent).toHaveBeenCalledWith({ timeout: 1000 });
});

it('still fails with the unmet-objective message when the waiting banner is missing', async () => {
  const { waitForCompletion } = await import('./shared');
  const locator = {
    getAttribute: jest.fn().mockResolvedValue('waiting'),
    textContent: jest.fn().mockRejectedValue(new Error('Timeout 1000ms exceeded')),
  };
  const page = { getByTestId: jest.fn().mockReturnValue(locator) } as unknown as Page;
  await expect(waitForCompletion(page, 'step', 0)).rejects.toThrow(
    'Step step is waiting for completion after 0ms: objectives remain unmet'
  );
});
