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

import { executeAllSteps, executeStep, hasAuthoritativeInfrastructureCode } from './execution';
import type { StepTestResult } from './types';
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
  it.each(['Network panel not found', 'Guide 401 example not found'])(
    'keeps diagnostic text \"%s\" as a mandatory guide failure',
    async (errorMessage) => {
      const locator = {
        count: jest.fn().mockRejectedValue(new Error(errorMessage)),
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
        abortReason: 'MANDATORY_FAILURE',
      });
      expect(result.results[0]).toMatchObject({
        status: 'failed',
        classification: 'infrastructure',
      });
      expect(result.results[0].errorCode).toBeUndefined();
    }
  );

  it('requires an authoritative code for infrastructure control flow', () => {
    const diagnosticOnly: StepTestResult = {
      stepId: 'diagnostic',
      status: 'failed',
      durationMs: 1,
      currentUrl: '/',
      consoleErrors: [],
      skippable: false,
      classification: 'infrastructure',
    };

    expect(hasAuthoritativeInfrastructureCode(diagnosticOnly)).toBe(false);
    expect(hasAuthoritativeInfrastructureCode({ ...diagnosticOnly, errorCode: 'BROWSER_CRASHED' })).toBe(true);
  });
});
