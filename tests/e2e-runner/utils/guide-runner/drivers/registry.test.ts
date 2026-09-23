jest.mock('@playwright/test', () => ({
  expect: jest.fn(),
}));

import type { Locator, Page } from '@playwright/test';

import { STEP_TYPE_KIND_KEYS } from '../../../../../src/components/interactive-tutorial/step-type-registry';
import { getStepDriver, resolveLegacyStepKind, STEP_DRIVERS } from './registry';

function root(attributes: Record<string, string | null>): Locator {
  return {
    getAttribute: jest.fn((name: string) => Promise.resolve(attributes[name] ?? null)),
  } as unknown as Locator;
}

function inspectionPage(): Page {
  const control = {
    count: jest.fn().mockResolvedValue(0),
    isVisible: jest.fn().mockResolvedValue(false),
  };
  return {
    getByTestId: jest.fn().mockReturnValue(control),
  } as unknown as Page;
}

describe('STEP_DRIVERS', () => {
  it('registers every tracked step kind', () => {
    expect([...STEP_DRIVERS.keys()]).toEqual(STEP_TYPE_KIND_KEYS);
  });

  it('supports plain, multistep, guided, and codeblock behavior', () => {
    const supported = [...STEP_DRIVERS.values()].filter((driver) => driver.supported).map((driver) => driver.kind);
    const unsupported = [...STEP_DRIVERS.values()].filter((driver) => !driver.supported).map((driver) => driver.kind);

    expect(supported).toEqual(['plain', 'multistep', 'guided', 'codeblock']);
    expect(unsupported).toEqual(['quiz', 'terminal', 'terminal-connect', 'challenge', 'datasource-check']);
  });
});

describe('legacy driver inspection compatibility', () => {
  it('resolves an explicit guided target action as guided', async () => {
    await expect(resolveLegacyStepKind(root({ 'data-targetaction': 'guided' }))).resolves.toBe('guided');
  });

  it.each([
    ['missing', null],
    ['non-numeric', 'not-a-number'],
    ['zero', '0'],
  ])('uses one action for a guided total that is %s', async (_label, total) => {
    const result = await getStepDriver('guided').inspect(
      inspectionPage(),
      root({ 'data-test-substep-total': total }),
      'guided-1'
    );

    expect(result.actionCount).toBe(1);
  });

  it.each([
    ['missing', null],
    ['malformed', '{not-json'],
  ])('uses the default three actions for multistep data that is %s', async (_label, actions) => {
    const result = await getStepDriver('multistep').inspect(
      inspectionPage(),
      root({ 'data-internal-actions': actions }),
      'multistep-1'
    );

    expect(result.actionCount).toBe(3);
  });

  it.each([
    ['an empty array', '[]'],
    ['a non-array JSON value', '{}'],
  ])('uses zero actions for multistep data that is %s', async (_label, actions) => {
    const result = await getStepDriver('multistep').inspect(
      inspectionPage(),
      root({ 'data-internal-actions': actions }),
      'multistep-1'
    );

    expect(result.actionCount).toBe(0);
  });
});
