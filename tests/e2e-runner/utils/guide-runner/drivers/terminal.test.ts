jest.mock('@playwright/test', () => ({
  expect: (root: { getAttribute(name: string): Promise<string | null> }) => ({
    async toHaveAttribute(name: string, value: string) {
      if ((await root.getAttribute(name)) !== value) {
        throw new Error('Skip did not complete');
      }
    },
  }),
}));
jest.mock('../badge-celebrations', () => ({ dismissBadgeCelebrations: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../requirements', () => ({
  validateSession: jest.fn().mockResolvedValue({ valid: true }),
  handleRequirementsWithFix: jest.fn(),
}));
jest.mock('../artifacts', () => ({ captureFailureArtifacts: jest.fn().mockResolvedValue({}) }));

import type { Locator, Page } from '@playwright/test';
import { testIds } from '../../../../../src/constants/testIds';
import { executeStep } from '../execution';
import type { TestableStep } from '../types';
import { terminalCommandDriver, terminalConnectDriver, TERMINAL_CONNECTION_TIMEOUT_MS } from './terminal';

function setup(kind: 'terminal' | 'terminal-connect' = 'terminal') {
  let now = 0;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  const attributes: Record<string, string> = {
    'data-test-step-state': 'idle',
    'data-test-terminal-status': 'connected',
    'data-test-skippable': 'false',
  };
  const driver = kind === 'terminal' ? terminalCommandDriver : terminalConnectDriver;
  const exec = {
    count: jest.fn(async () => 1),
    click: jest.fn(async () => {
      attributes['data-test-step-state'] = 'completed';
    }),
  };
  const connect = {
    count: jest.fn(async () => 1),
    click: jest.fn(async () => {
      attributes['data-test-terminal-status'] = 'connected';
      if (kind === 'terminal-connect') {
        attributes['data-test-step-state'] = 'completed';
      }
    }),
  };
  const skip = {
    count: jest.fn(async () => 1),
    click: jest.fn(async () => {
      attributes['data-test-step-state'] = 'completed';
    }),
  };
  const absent = {
    count: jest.fn(async () => 0),
    click: jest.fn(async () => {
      throw new Error('Unexpected control');
    }),
  };
  const controls = new Map<string, unknown>([
    [testIds.interactive.terminalExecButton('step'), exec],
    [testIds.interactive.terminalConnectButton('step'), connect],
    [testIds.interactive.terminalSkipButton('step'), skip],
    [
      testIds.interactive.requirementCheck('step'),
      { count: async () => 1, textContent: async () => 'Sandbox unavailable' },
    ],
    [testIds.interactive.errorMessage('step'), { count: async () => 1, textContent: async () => 'Dispatch failed' }],
  ]);
  const root = {
    count: jest.fn(async () => 1),
    evaluate: jest.fn(async (): Promise<string | undefined> => undefined),
    waitFor: jest.fn(async () => undefined),
    evaluateAll: jest.fn(async (): Promise<{ state: string | null; connection: string | null } | null> => ({
      state: attributes['data-test-step-state'] ?? null,
      connection: attributes['data-test-terminal-status'] ?? null,
    })),
    getAttribute: jest.fn(async (name: string) => attributes[name] ?? null),
    getByTestId: jest.fn((id: string) => controls.get(id) ?? absent),
    scrollIntoViewIfNeeded: jest.fn(async () => undefined),
  };
  const toggle = { click: jest.fn(async () => undefined), and: jest.fn() };
  toggle.and.mockReturnValue(toggle);
  const section = {
    evaluateAll: jest.fn(async () => false),
    getByTestId: jest.fn(() => toggle),
    getByRole: jest.fn(() => toggle),
  };
  const page = {
    getByTestId: jest.fn((id: string) => {
      if (id === testIds.interactive.section('setup')) {
        return section;
      }
      if (id !== testIds.interactive.terminalStep('step') && id !== testIds.interactive.terminalConnectStep('step')) {
        throw new Error('Wrong terminal root');
      }
      return root;
    }),
    waitForTimeout: jest.fn(async (ms: number) => {
      now += ms;
    }),
    on: jest.fn(),
    off: jest.fn(),
    url: () => 'http://localhost:3000/',
    isClosed: () => false,
  } as unknown as Page;
  const step = async (): Promise<TestableStep> => ({
    stepKind: kind,
    stepId: 'step',
    index: 0,
    locator: root as unknown as Locator,
    ...(await driver.inspect(page, root as unknown as Locator, 'step')),
  });
  return { attributes, driver, root, page, step, exec, connect, skip, absent, section, toggle };
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

it('does not read or click the connection root again after observing connected completion', async () => {
  const f = setup('terminal-connect');
  f.attributes['data-test-terminal-status'] = 'disconnected';
  const step = await f.step();
  f.connect.click.mockImplementation(async () => {
    f.attributes['data-test-terminal-status'] = 'connected';
    f.attributes['data-test-step-state'] = 'completed';
    f.root.getAttribute.mockImplementation(async () => {
      throw new Error('Section collapsed after the connection wait');
    });
  });
  expect(await executeStep(f.page, step)).toMatchObject({ status: 'passed' });
  expect(f.connect.click).toHaveBeenCalledTimes(1);
  expect(f.skip.click).not.toHaveBeenCalled();
});

it.each(['terminal', 'terminal-connect'] as const)(
  'rejects a %s disconnect after startup without using the remaining startup grace',
  async (kind) => {
    const f = setup(kind);
    f.attributes['data-test-terminal-status'] = 'disconnected';
    f.connect.click.mockImplementation(async () => {
      (f.page.waitForTimeout as jest.Mock)
        .mockClear()
        .mockImplementationOnce(async () => {
          f.attributes['data-test-terminal-status'] = 'connecting';
        })
        .mockImplementationOnce(async () => {
          f.attributes['data-test-terminal-status'] = 'disconnected';
        });
    });
    expect(await executeStep(f.page, await f.step())).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('disconnected before completion'),
    });
    expect(f.page.waitForTimeout).toHaveBeenCalledTimes(2);
    expect(f.connect.click).toHaveBeenCalledTimes(1);
    expect(f.exec.click).not.toHaveBeenCalled();
  }
);

it('continues an existing pending connection without starting another', async () => {
  const f = setup('terminal-connect');
  f.attributes['data-test-terminal-status'] = 'connecting';
  f.root.evaluateAll.mockImplementationOnce(async () => {
    f.attributes['data-test-terminal-status'] = 'connected';
    return { state: 'idle', connection: 'connected' };
  });
  expect(await executeStep(f.page, await f.step())).toMatchObject({ status: 'passed' });
  expect(f.connect.click).not.toHaveBeenCalled();
  expect(f.skip.click).toHaveBeenCalledTimes(1);
});

it('fails detached command completion without a known parent section', async () => {
  const f = setup();
  f.root.evaluateAll.mockResolvedValueOnce(null);
  expect(await executeStep(f.page, await f.step())).toMatchObject({
    status: 'failed',
    error: expect.stringContaining('detached'),
  });
});

it.each(['completed', 'idle', 'disconnected'] as const)(
  're-expands once and verifies restored state: %s',
  async (restored) => {
    const f = setup();
    f.section.evaluateAll.mockResolvedValue(true);
    f.root.evaluateAll.mockResolvedValueOnce(null);
    f.exec.click.mockImplementation(async () => {
      f.attributes['data-test-step-state'] = restored === 'idle' ? 'idle' : 'completed';
      f.attributes['data-test-terminal-status'] = restored === 'disconnected' ? 'disconnected' : 'connected';
    });
    expect(await executeStep(f.page, { ...(await f.step()), sectionId: 'setup' }, { timeout: 600 })).toMatchObject({
      status: restored === 'completed' ? 'passed' : 'failed',
    });
    expect(f.toggle.click).toHaveBeenCalledTimes(1);
    expect(f.exec.click).toHaveBeenCalledTimes(1);
  }
);

it('synchronizes Skip after section collapse without requiring a connection', async () => {
  const f = setup();
  f.attributes['data-test-terminal-status'] = 'disconnected';
  f.root.evaluate.mockResolvedValue('setup');
  f.root.evaluateAll.mockResolvedValueOnce(null);
  f.section.evaluateAll.mockResolvedValue(true);
  await expect(f.driver.skip(f.page, 'step', 600)).resolves.toBeUndefined();
  expect(f.toggle.click).toHaveBeenCalledTimes(1);
  expect(f.skip.click).toHaveBeenCalledTimes(1);
  expect(f.exec.click).not.toHaveBeenCalled();
});

it('reserves a provisioning budget for both terminal kinds', async () => {
  const f = setup();
  expect(terminalConnectDriver.timeout(await f.step())).toBe(TERMINAL_CONNECTION_TIMEOUT_MS);
  expect(terminalCommandDriver.timeout(await f.step())).toBeGreaterThan(TERMINAL_CONNECTION_TIMEOUT_MS);
});

it.each(['terminal', 'terminal-connect'] as const)('connects through the %s product control', async (kind) => {
  const f = setup(kind);
  f.attributes['data-test-terminal-status'] = 'disconnected';
  expect(await executeStep(f.page, await f.step())).toMatchObject({ status: 'passed', stepKind: kind });
  expect(f.connect.click).toHaveBeenCalledTimes(1);
  expect(f.exec.click).toHaveBeenCalledTimes(kind === 'terminal' ? 1 : 0);
  expect(f.absent.click).not.toHaveBeenCalled();
});

it.each(['terminal', 'terminal-connect'] as const)(
  'waits for the delayed %s retry to leave its old error',
  async (kind) => {
    const f = setup(kind);
    f.attributes['data-test-terminal-status'] = 'error';
    f.attributes['data-test-step-state'] = 'error';
    f.connect.click.mockImplementation(async () => {
      (f.page.waitForTimeout as jest.Mock)
        .mockImplementationOnce(async () => {
          f.attributes['data-test-terminal-status'] = 'connecting';
          f.attributes['data-test-step-state'] = 'executing';
        })
        .mockImplementationOnce(async () => {
          f.attributes['data-test-terminal-status'] = 'connected';
          f.attributes['data-test-step-state'] = kind === 'terminal-connect' ? 'completed' : 'idle';
        });
    });
    expect(await executeStep(f.page, await f.step())).toMatchObject({ status: 'passed' });
    expect(f.connect.click).toHaveBeenCalledTimes(1);
    expect(f.exec.click).toHaveBeenCalledTimes(kind === 'terminal' ? 1 : 0);
  }
);

it('bounds a retry that never leaves its old error without clicking again', async () => {
  const f = setup('terminal-connect');
  f.attributes['data-test-terminal-status'] = 'error';
  f.attributes['data-test-step-state'] = 'error';
  f.connect.click.mockImplementation(async () => undefined);
  expect(await executeStep(f.page, await f.step(), { timeout: 5_000 })).toMatchObject({
    status: 'failed',
    error: 'Dispatch failed',
  });
  expect(Date.now()).toBeLessThan(5_000);
  expect(f.page.waitForTimeout).toHaveBeenCalled();
  expect(f.connect.click).toHaveBeenCalledTimes(1);
  expect(f.skip.click).not.toHaveBeenCalled();
});

it('does not suppress a new retry failure after observing connecting', async () => {
  const f = setup('terminal-connect');
  f.attributes['data-test-terminal-status'] = 'error';
  f.connect.click.mockImplementation(async () => {
    f.attributes['data-test-terminal-status'] = 'connecting';
    (f.page.waitForTimeout as jest.Mock).mockClear().mockImplementationOnce(async () => {
      f.attributes['data-test-terminal-status'] = 'error';
    });
  });
  expect(await executeStep(f.page, await f.step())).toMatchObject({ status: 'failed', error: 'Dispatch failed' });
  expect(f.page.waitForTimeout).toHaveBeenCalledTimes(1);
  expect(f.connect.click).toHaveBeenCalledTimes(1);
});

it('uses Continue for an already connected default sandbox', async () => {
  const f = setup('terminal-connect');
  expect(await executeStep(f.page, await f.step())).toMatchObject({ status: 'passed' });
  expect(f.skip.click).toHaveBeenCalledTimes(1);
  expect(f.connect.click).not.toHaveBeenCalled();
});

it.each([
  ['data-test-terminal-gcx', 'true', 'gcx'],
  ['data-test-terminal-unavailable', 'true', 'Sandbox unavailable'],
  ['data-test-terminal-vm-requested', 'true', 'requested sandbox'],
  ['data-test-step-state', 'requirements-unmet', 'Sandbox unavailable'],
])('refuses the prerequisite %s without connecting or continuing', async (name, value, error) => {
  const f = setup('terminal-connect');
  f.attributes[name] = value;
  expect(await executeStep(f.page, await f.step())).toMatchObject({
    status: 'failed',
    error: expect.stringContaining(error),
  });
  expect(f.connect.click).not.toHaveBeenCalled();
  expect(f.skip.click).not.toHaveBeenCalled();
});

it('refuses a pending connection for an explicit VM request', async () => {
  const f = setup('terminal-connect');
  f.attributes['data-test-terminal-status'] = 'connecting';
  f.attributes['data-test-terminal-vm-requested'] = 'true';
  expect(await executeStep(f.page, await f.step())).toMatchObject({
    status: 'failed',
    error: expect.stringContaining('requested sandbox'),
  });
  expect(f.connect.click).not.toHaveBeenCalled();
});

it('bounds an existing connection attempt without starting another', async () => {
  const f = setup('terminal-connect');
  f.attributes['data-test-terminal-status'] = 'connecting';
  expect(await executeStep(f.page, await f.step(), { timeout: 500 })).toMatchObject({
    status: 'failed',
    error: expect.stringContaining('before its deadline'),
  });
  expect(f.connect.click).not.toHaveBeenCalled();
  expect(f.skip.click).not.toHaveBeenCalled();
});

it('allows a lazily registered terminal to settle before reporting it unavailable', async () => {
  const f = setup();
  f.attributes['data-test-terminal-unavailable'] = 'true';
  (f.page.waitForTimeout as jest.Mock).mockImplementationOnce(async () => {
    f.attributes['data-test-terminal-unavailable'] = 'false';
  });
  expect(await executeStep(f.page, await f.step())).toMatchObject({ status: 'passed' });
});

it('rejects an older plugin contract', async () => {
  const f = setup();
  delete f.attributes['data-test-terminal-status'];
  expect(await executeStep(f.page, await f.step())).toMatchObject({
    status: 'failed',
    error: expect.stringContaining('DOM contract'),
  });
  expect(f.exec.click).not.toHaveBeenCalled();
});

it('waits for availability checking to settle', async () => {
  const f = setup();
  f.attributes['data-test-terminal-checking'] = 'true';
  (f.page.waitForTimeout as jest.Mock).mockImplementationOnce(async () => {
    f.attributes['data-test-terminal-checking'] = 'false';
  });
  expect(await executeStep(f.page, await f.step())).toMatchObject({ status: 'passed' });
  expect(f.page.waitForTimeout).toHaveBeenCalled();
});

it('bounds a checking state that never settles', async () => {
  const f = setup();
  f.attributes['data-test-terminal-checking'] = 'true';
  expect(await executeStep(f.page, await f.step(), { timeout: 500 })).toMatchObject({
    status: 'failed',
    error: expect.stringContaining('did not settle'),
  });
  expect(f.exec.click).not.toHaveBeenCalled();
});

it('reports a dispatch error instead of copying or retrying the command', async () => {
  const f = setup();
  f.exec.click.mockImplementation(async () => {
    f.attributes['data-test-step-state'] = 'error';
  });
  expect(await executeStep(f.page, await f.step())).toMatchObject({ status: 'failed', error: 'Dispatch failed' });
  expect(f.exec.click).toHaveBeenCalledTimes(1);
  expect(f.absent.click).not.toHaveBeenCalled();
});

it('reports a connection failure instead of continuing', async () => {
  const f = setup('terminal-connect');
  f.attributes['data-test-terminal-status'] = 'disconnected';
  f.connect.click.mockImplementation(async () => {
    f.attributes['data-test-terminal-status'] = 'error';
  });
  expect(await executeStep(f.page, await f.step())).toMatchObject({ status: 'failed', error: 'Dispatch failed' });
  expect(f.skip.click).not.toHaveBeenCalled();
});

it('requires synchronized Skip for a blocked optional command', async () => {
  const f = setup();
  f.attributes['data-test-skippable'] = 'true';
  f.attributes['data-test-step-state'] = 'requirements-unmet';
  expect(await executeStep(f.page, await f.step())).toMatchObject({
    status: 'skipped',
    skipReason: 'requirements_unmet',
  });
  expect(f.skip.click).toHaveBeenCalledTimes(1);
  expect(f.exec.click).not.toHaveBeenCalled();
});

it('does not report a skip if the product stays blocked', async () => {
  const f = setup();
  f.attributes['data-test-skippable'] = 'true';
  f.attributes['data-test-step-state'] = 'requirements-unmet';
  f.skip.click.mockImplementation(async () => undefined);
  expect(await executeStep(f.page, await f.step())).toMatchObject({
    status: 'failed',
    error: expect.stringContaining('Skip sync failed'),
  });
});
