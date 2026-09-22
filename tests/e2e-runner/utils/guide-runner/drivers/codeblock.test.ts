jest.mock('@playwright/test', () => ({
  expect: (locator: { isEnabled(): Promise<boolean>; getAttribute(name: string): Promise<string | null> }) => ({
    async toBeEnabled() {
      if (!(await locator.isEnabled())) {
        throw new Error('Insert is disabled');
      }
    },
    async toHaveAttribute(name: string, value: string) {
      if ((await locator.getAttribute(name)) !== value) {
        throw new Error('Step did not complete');
      }
    },
  }),
}));
jest.mock('../badge-celebrations', () => ({ dismissBadgeCelebrations: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../requirements', () => ({
  validateSession: jest.fn().mockResolvedValue({ valid: true }),
  handleRequirementsWithFix: jest.fn().mockResolvedValue({ requirements: { requirementsMet: true, status: 'met' } }),
}));
jest.mock('../artifacts', () => ({
  captureFailureArtifacts: jest.fn().mockResolvedValue({ dom: '/artifacts/failure.html' }),
}));

import type { Locator, Page } from '@playwright/test';

import { testIds } from '../../../../../src/constants/testIds';
import { captureFailureArtifacts } from '../artifacts';
import { executeAllSteps, executeStep } from '../execution';
import type { TestableStep } from '../types';
import { codeblockDriver } from './codeblock';

const STEP_ID = 'insert-query';

function setup(
  options: { state?: string; skippable?: boolean; insertPresent?: boolean; insertEnabled?: boolean } = {}
) {
  let now = 0;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  const dom = { state: options.state ?? 'idle', attached: true, error: '', explanation: 'Complete previous step' };
  const root = {
    count: jest.fn(async () => (dom.attached ? 1 : 0)),
    getAttribute: jest.fn(async (name: string) => {
      if (!dom.attached) {
        throw new Error('Codeblock root is missing');
      }
      return name === 'data-test-step-state'
        ? dom.state
        : name === 'data-test-skippable'
          ? String(!!options.skippable)
          : null;
    }),
    scrollIntoViewIfNeeded: jest.fn(async () => {
      if (!dom.attached) {
        throw new Error('Codeblock root is missing');
      }
    }),
  };
  const insert = {
    count: jest.fn(async () => (options.insertPresent === false ? 0 : 1)),
    isEnabled: jest.fn(async () => options.insertEnabled !== false),
    waitFor: jest.fn(async () => {
      if (options.insertPresent === false) {
        throw new Error('Insert control is missing');
      }
    }),
    click: jest.fn(async () => {
      dom.state = 'completed';
    }),
  };
  const skip = {
    count: jest.fn(async () => (options.skippable && dom.state === 'requirements-unmet' ? 1 : 0)),
    click: jest.fn(async () => {
      dom.state = 'completed';
    }),
  };
  const absent = { count: jest.fn().mockResolvedValue(0), click: jest.fn() };
  const controls = new Map<string, unknown>([
    [testIds.codeBlock.step(STEP_ID), root],
    [testIds.codeBlock.insertButton(STEP_ID), insert],
    [testIds.codeBlock.showMeButton(STEP_ID), absent],
    [testIds.interactive.skipButton(STEP_ID), skip],
    [
      testIds.interactive.errorMessage(STEP_ID),
      {
        count: jest.fn(async () => (dom.error ? 1 : 0)),
        textContent: jest.fn(async () => dom.error),
      },
    ],
    [
      testIds.interactive.requirementCheck(STEP_ID),
      {
        count: jest.fn(async () => (dom.state === 'requirements-unmet' ? 1 : 0)),
        textContent: jest.fn(async () => dom.explanation),
      },
    ],
  ]);
  const page = {
    getByTestId: jest.fn((id: string) => {
      if (id === testIds.interactive.step(STEP_ID)) {
        throw new Error('Codeblock execution used a plain step root');
      }
      return controls.get(id) ?? absent;
    }),
    waitForTimeout: jest.fn(async (ms: number) => {
      now += ms;
    }),
    on: jest.fn(),
    off: jest.fn(),
    url: jest.fn(() => 'http://localhost:3000/explore'),
    isClosed: jest.fn(() => false),
  } as unknown as Page;
  const step = async (): Promise<TestableStep> => ({
    stepKind: 'codeblock',
    stepId: STEP_ID,
    index: 0,
    locator: root as unknown as Locator,
    ...(await codeblockDriver.inspect(page, root as unknown as Locator, STEP_ID)),
  });
  return { dom, page, root, insert, skip, absent, step };
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

it('uses Insert and the codeblock root throughout shared execution', async () => {
  const fixture = setup();
  const result = await executeStep(fixture.page, await fixture.step());

  expect(result).toMatchObject({ stepId: STEP_ID, stepKind: 'codeblock', status: 'passed' });
  expect(fixture.root.scrollIntoViewIfNeeded).toHaveBeenCalled();
  expect(fixture.insert.click).toHaveBeenCalledTimes(1);
  expect(fixture.absent.click).not.toHaveBeenCalled();
});

it('does not insert a pre-completed codeblock again', async () => {
  const fixture = setup({ state: 'completed' });
  const result = await executeStep(fixture.page, await fixture.step());

  expect(result).toMatchObject({ status: 'skipped', skipReason: 'pre_completed' });
  expect(fixture.insert.click).not.toHaveBeenCalled();
});

it('accepts explicit completion between discovery and execution', async () => {
  const fixture = setup();
  const step = await fixture.step();
  fixture.dom.state = 'completed';

  expect(await executeStep(fixture.page, step)).toMatchObject({ status: 'passed' });
  expect(fixture.insert.click).not.toHaveBeenCalled();
});

it('retains skippability before the requirements Skip control appears', async () => {
  const fixture = setup({ skippable: true });
  const step = await fixture.step();
  expect(step.skippable).toBe(true);
  fixture.dom.state = 'requirements-unmet';

  expect(await executeStep(fixture.page, step)).toMatchObject({ status: 'skipped', skipReason: 'requirements_unmet' });
  expect(fixture.skip.click).toHaveBeenCalledTimes(1);
  expect(fixture.dom.state).toBe('completed');
  expect(fixture.insert.click).not.toHaveBeenCalled();
});

it('fails when Skip does not complete the product step', async () => {
  const fixture = setup({ skippable: true, state: 'requirements-unmet' });
  fixture.skip.click.mockImplementation(async () => undefined);

  expect(await executeStep(fixture.page, await fixture.step())).toMatchObject({
    status: 'failed',
    error: expect.stringContaining('Skip sync failed'),
  });
});

it('reports the requirement explanation for a mandatory blocked codeblock', async () => {
  const fixture = setup({ state: 'requirements-unmet' });

  expect(await executeStep(fixture.page, await fixture.step())).toMatchObject({
    status: 'failed',
    error: 'Requirements not met: Complete previous step',
  });
  expect(fixture.insert.click).not.toHaveBeenCalled();
});

it('waits for requirements checking before inserting', async () => {
  const fixture = setup({ state: 'checking' });
  (fixture.page.waitForTimeout as jest.Mock).mockImplementationOnce(async () => {
    fixture.dom.state = 'idle';
  });
  const result = await codeblockDriver.checkRequirements({
    page: fixture.page,
    step: await fixture.step(),
    timeout: 1000,
    verbose: false,
  });
  expect(result.requirements).toMatchObject({ requirementsMet: true, isChecking: false });
  expect(fixture.page.waitForTimeout).toHaveBeenCalled();
});

it('fails a requirements check that never settles', async () => {
  const fixture = setup({ state: 'checking' });

  expect(await executeStep(fixture.page, await fixture.step(), { timeout: 500 })).toMatchObject({
    status: 'failed',
    error: expect.stringContaining('requirements did not settle'),
  });
});

it.each([{ insertPresent: false }, { insertEnabled: false }])(
  'does not fall back to Show me when Insert is unavailable: %j',
  async (options) => {
    const fixture = setup(options);

    expect(await executeStep(fixture.page, await fixture.step(), { timeout: 500 })).toMatchObject({ status: 'failed' });
    expect(fixture.insert.click).not.toHaveBeenCalled();
    expect(fixture.absent.click).not.toHaveBeenCalled();
  }
);

it('reports the insertion error and captures failure artifacts', async () => {
  const fixture = setup();
  fixture.insert.click.mockImplementation(async () => {
    fixture.dom.state = 'error';
    fixture.dom.error = 'Target Monaco editor was not found';
  });

  expect(await executeStep(fixture.page, await fixture.step(), { artifactsDir: '/artifacts' })).toMatchObject({
    status: 'failed',
    error: 'Target Monaco editor was not found',
    artifacts: { dom: '/artifacts/failure.html' },
  });
  expect(captureFailureArtifacts).toHaveBeenCalledWith(fixture.page, STEP_ID, [], '/artifacts');
});

it('does not treat detachment before execution as completion', async () => {
  const fixture = setup();
  const step = await fixture.step();
  fixture.dom.attached = false;

  expect(await executeStep(fixture.page, step)).toMatchObject({ status: 'failed' });
  expect(fixture.insert.click).not.toHaveBeenCalled();
});

it.each(['executing', 'detached'])('fails without explicit completion after Insert: %s', async (state) => {
  const fixture = setup();
  fixture.insert.click.mockImplementation(async () => {
    fixture.dom.state = state;
    fixture.dom.attached = state !== 'detached';
  });

  expect(await executeStep(fixture.page, await fixture.step(), { timeout: 500 })).toMatchObject({
    status: 'failed',
    error: expect.stringContaining('did not reach completed state'),
  });
});

it('stops before the following step when mandatory insertion fails', async () => {
  const fixture = setup();
  fixture.insert.click.mockImplementation(async () => {
    fixture.dom.state = 'error';
    fixture.dom.error = 'Insertion failed';
  });
  const step = await fixture.step();
  const result = await executeAllSteps(fixture.page, [step, { ...step, stepId: 'run-query', stepKind: 'plain' }]);

  expect(result).toMatchObject({
    aborted: true,
    abortReason: 'MANDATORY_FAILURE',
    results: [
      { status: 'failed', stepKind: 'codeblock' },
      { status: 'not_reached', stepKind: 'plain' },
    ],
  });
});
