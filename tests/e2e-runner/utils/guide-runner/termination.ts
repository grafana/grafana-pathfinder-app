import type { Browser, BrowserContext, Frame, Page } from '@playwright/test';

import type {
  E2EErrorCode,
  E2EExecutionOutcome,
  ErrorClassification,
} from '../../../../src/cli/e2e/schemas/e2e-report.schema';

export interface GuideTermination {
  code: E2EErrorCode;
  message: string;
  outcome: E2EExecutionOutcome;
  classification: ErrorClassification;
  stepId?: string;
}

export class GuideTerminationError extends Error {
  constructor(readonly termination: GuideTermination) {
    super(`${termination.code}: ${termination.message}`);
    this.name = 'GuideTerminationError';
  }
}

export interface GuideTerminationController {
  readonly signal: AbortSignal;
  readonly termination: Promise<GuideTermination>;
  terminate(termination: Omit<GuideTermination, 'stepId'> & { stepId?: string }): boolean;
  setActiveStep(stepId: string | undefined): void;
  lastKnownUrl(): string;
  markExpectedTeardown(): void;
  dispose(): void;
}

export type GuideWorkOutcome<T> =
  { kind: 'completed'; value: T } | { kind: 'terminated'; termination: GuideTermination; drained: boolean };

async function settlesWithin(work: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.then(
        () => true,
        () => true
      ),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export function createGuideTerminationController(page: Page): GuideTerminationController {
  const abortController = new AbortController();
  let expectedTeardown = false;
  let activeStep: string | undefined;
  let lastKnownUrl = page.url();
  let terminal: GuideTermination | undefined;
  let resolveTermination!: (termination: GuideTermination) => void;
  const termination = new Promise<GuideTermination>((resolve) => {
    resolveTermination = resolve;
  });

  const context: BrowserContext = page.context();
  const browser: Browser | null = context.browser();

  const terminate = (input: Omit<GuideTermination, 'stepId'> & { stepId?: string }): boolean => {
    if (terminal || expectedTeardown) {
      return false;
    }
    terminal = { ...input, stepId: input.stepId ?? activeStep };
    abortController.abort(new GuideTerminationError(terminal));
    resolveTermination(terminal);
    return true;
  };

  const infrastructure = (code: E2EErrorCode, message: string) => {
    terminate({ code, message, outcome: 'infrastructure_error', classification: 'infrastructure' });
  };

  const onPageCrash = () => infrastructure('BROWSER_CRASHED', 'The browser page crashed.');
  const onPageClose = () => infrastructure('PAGE_CLOSED', 'The browser page closed during guide execution.');
  const onContextClose = () => infrastructure('CONTEXT_CLOSED', 'The browser context closed during guide execution.');
  const onBrowserDisconnected = () =>
    infrastructure('BROWSER_DISCONNECTED', 'The browser disconnected during guide execution.');
  const onFrameNavigated = (frame: Frame) => {
    if (frame === page.mainFrame()) {
      lastKnownUrl = frame.url();
    }
  };

  page.on('crash', onPageCrash);
  page.on('close', onPageClose);
  context.on('close', onContextClose);
  browser?.on('disconnected', onBrowserDisconnected);
  page.on('framenavigated', onFrameNavigated);

  return {
    signal: abortController.signal,
    termination,
    terminate,
    setActiveStep(stepId) {
      activeStep = stepId;
    },
    lastKnownUrl() {
      return lastKnownUrl;
    },
    markExpectedTeardown() {
      expectedTeardown = true;
    },
    dispose() {
      page.off('crash', onPageCrash);
      page.off('close', onPageClose);
      context.off('close', onContextClose);
      browser?.off('disconnected', onBrowserDisconnected);
      page.off('framenavigated', onFrameNavigated);
    },
  };
}

export async function raceGuideTermination<T>(work: Promise<T>, controller: GuideTerminationController): Promise<T> {
  return Promise.race([
    work,
    controller.termination.then((termination) => {
      throw new GuideTerminationError(termination);
    }),
  ]);
}

export async function arbitrateGuideWork<T>(
  work: Promise<T>,
  controller: GuideTerminationController,
  cancel: () => void | Promise<void>,
  drainTimeoutMs: number
): Promise<GuideWorkOutcome<T>> {
  const winner = await Promise.race([
    work.then((value) => ({ kind: 'completed' as const, value })),
    controller.termination.then((termination) => ({ kind: 'terminated' as const, termination })),
  ]);
  if (winner.kind === 'completed') {
    controller.markExpectedTeardown();
    return winner;
  }

  const drainStartedAt = Date.now();
  await settlesWithin(Promise.resolve().then(cancel), drainTimeoutMs);
  const remainingMs = Math.max(0, drainTimeoutMs - (Date.now() - drainStartedAt));
  const drained = await settlesWithin(work, remainingMs);
  return { ...winner, drained };
}
