jest.mock('@playwright/test', () => ({
  expect: jest.fn(),
}));

import { STEP_TYPE_KIND_KEYS } from '../../../../../src/components/interactive-tutorial/step-type-registry';
import { STEP_DRIVERS } from './registry';

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
});
