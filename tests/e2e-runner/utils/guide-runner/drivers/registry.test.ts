jest.mock('@playwright/test', () => ({
  expect: jest.fn(),
}));

import { STEP_TYPE_KIND_KEYS } from '../../../../../src/components/interactive-tutorial/step-type-registry';
import { STEP_DRIVERS } from './registry';
import type { TestableStep } from '../types';

describe('STEP_DRIVERS', () => {
  it('registers every tracked step kind', () => {
    expect([...STEP_DRIVERS.keys()]).toEqual(STEP_TYPE_KIND_KEYS);
  });

  it('supports only the existing plain, multistep, and guided behavior', () => {
    const supported = [...STEP_DRIVERS.values()].filter((driver) => driver.supported).map((driver) => driver.kind);
    const unsupported = [...STEP_DRIVERS.values()].filter((driver) => !driver.supported).map((driver) => driver.kind);

    expect(supported).toEqual(['plain', 'multistep', 'guided']);
    expect(unsupported).toEqual(['quiz', 'terminal', 'terminal-connect', 'codeblock', 'challenge', 'datasource-check']);
  });

  it.each([30000, 45000, 60000, 120000])('inspects and uses the %ims guided substep timeout', async (timeout) => {
    const root = {
      getAttribute: jest.fn((name: string) => {
        const attributes: Record<string, string | null> = {
          'data-targetaction': 'guided',
          'data-reftarget': null,
          'data-test-substep-total': '2',
          'data-test-substep-timeout-ms': String(timeout),
        };
        return Promise.resolve(attributes[name] ?? null);
      }),
    };
    const control = {
      count: jest.fn().mockResolvedValue(1),
      isVisible: jest.fn().mockResolvedValue(false),
    };
    const page = {
      getByTestId: jest.fn().mockReturnValue(control),
    };
    const driver = STEP_DRIVERS.get('guided')!;

    const inspection = await driver.inspect(page as never, root as never, 'guided-step');
    const step = {
      ...inspection,
      stepKind: 'guided',
      stepId: 'guided-step',
      index: 0,
      locator: root,
    } as unknown as TestableStep;

    expect(inspection.guidedStepTimeoutMs).toBe(timeout);
    expect(driver.timeout(step)).toBe(30000 + 2 * timeout);
  });

  it('uses the 120 second runtime default when an older root omits the timeout attribute', async () => {
    const root = {
      getAttribute: jest.fn((name: string) => Promise.resolve(name === 'data-test-substep-total' ? '1' : null)),
    };
    const control = {
      count: jest.fn().mockResolvedValue(0),
      isVisible: jest.fn().mockResolvedValue(false),
    };
    const page = {
      getByTestId: jest.fn().mockReturnValue(control),
    };

    const inspection = await STEP_DRIVERS.get('guided')!.inspect(page as never, root as never, 'guided-step');

    expect(inspection.guidedStepTimeoutMs).toBe(120000);
  });

  it.each(['0', '-1', '1.5', 'NaN', 'Infinity'])('normalizes invalid timeout attribute %s', async (rawTimeout) => {
    const root = {
      getAttribute: jest.fn((name: string) => {
        if (name === 'data-test-substep-total') {
          return Promise.resolve('1');
        }
        return Promise.resolve(name === 'data-test-substep-timeout-ms' ? rawTimeout : null);
      }),
    };
    const control = {
      count: jest.fn().mockResolvedValue(0),
      isVisible: jest.fn().mockResolvedValue(false),
    };
    const page = { getByTestId: jest.fn().mockReturnValue(control) };

    const inspection = await STEP_DRIVERS.get('guided')!.inspect(page as never, root as never, 'guided-step');

    expect(inspection.guidedStepTimeoutMs).toBe(120000);
  });
});
