/** @jest-environment node */

import { resolveSelector } from './selector-resolver';

describe('E2E selector resolver', () => {
  it('resolves Grafana selectors without browser imports', () => {
    expect(resolveSelector('grafana:components.RefreshPicker.runButtonV2')).toContain(
      "[data-testid='data-testid RefreshPicker run button']"
    );
  });
});
