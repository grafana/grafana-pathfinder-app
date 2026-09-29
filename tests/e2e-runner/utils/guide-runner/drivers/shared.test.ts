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
