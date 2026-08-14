jest.mock('@playwright/test', () => ({
  Page: jest.fn(),
  Locator: jest.fn(),
  test: jest.fn(),
  expect: jest.fn(),
}));

jest.mock('./requirements', () => ({
  validateSession: jest.fn().mockResolvedValue(true),
  handleRequirementsWithFix: jest.fn(),
}));

jest.mock('./badge-celebrations', () => ({
  dismissBadgeCelebrations: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./artifacts', () => ({
  captureFailureArtifacts: jest.fn().mockResolvedValue(undefined),
  captureSuccessArtifacts: jest.fn().mockResolvedValue(undefined),
  capturePreStepArtifacts: jest.fn().mockResolvedValue(undefined),
  captureFinalScreenshot: jest.fn().mockResolvedValue(undefined),
}));

import { executeAllSteps, executeStep } from './execution';
import { captureFailureArtifacts } from './artifacts';
import type { TestableStep } from './types';

describe('infrastructure guide outcome', () => {
  it('closes the page and keeps STEP_TIMEOUT authoritative for a hanging operation', async () => {
    jest.useFakeTimers();
    let rejectCount!: (error: Error) => void;
    const locator = {
      count: jest.fn(
        () =>
          new Promise<number>((_resolve, reject) => {
            rejectCount = reject;
          })
      ),
    };
    const page = {
      getByTestId: jest.fn(() => locator),
      on: jest.fn(),
      off: jest.fn(),
      url: jest.fn(() => 'http://localhost:3000/'),
      close: jest.fn().mockImplementation(async () => {
        rejectCount(new Error('Target page has been closed'));
      }),
    };
    const step: TestableStep = {
      stepId: 'hanging-step',
      index: 0,
      skippable: false,
      hasDoItButton: true,
      hasShowMeButton: false,
      isPreCompleted: false,
      isMultistep: false,
      internalActionCount: 0,
      isGuided: false,
      locator: locator as never,
    };

    try {
      const resultPromise = executeStep(page as never, step, { timeout: 100, artifactsDir: '/tmp/artifacts' });
      await jest.advanceTimersByTimeAsync(100);

      await expect(resultPromise).resolves.toMatchObject({
        status: 'failed',
        errorCode: 'STEP_TIMEOUT',
        classification: 'unknown',
      });
      expect(page.close).toHaveBeenCalledWith({ runBeforeUnload: false });
      expect(captureFailureArtifacts).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
  it('does not convert an infrastructure step failure to MANDATORY_FAILURE', async () => {
    const locator = {
      count: jest.fn().mockRejectedValue(new Error('Target crashed')),
    };
    const page = {
      getByTestId: jest.fn(() => locator),
      on: jest.fn(),
      off: jest.fn(),
      url: jest.fn(() => 'http://localhost:3000/'),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const step: TestableStep = {
      stepId: 'crashed-step',
      index: 0,
      skippable: false,
      hasDoItButton: true,
      hasShowMeButton: false,
      isPreCompleted: false,
      isMultistep: false,
      internalActionCount: 0,
      isGuided: false,
      locator: locator as never,
    };

    const result = await executeAllSteps(page as never, [step]);

    expect(result).toMatchObject({
      aborted: true,
      outcome: 'infrastructure_error',
      errorCode: 'BROWSER_CRASHED',
    });
    expect(result.abortReason).toBeUndefined();
    expect(result.results[0]).toMatchObject({
      status: 'failed',
      classification: 'infrastructure',
      errorCode: 'BROWSER_CRASHED',
    });
  });
});
