import { getGuidedStepTimeout } from './interactive-config';
import { MAX_GUIDED_STEP_TIMEOUT_MS } from '../types/interactive-actions.types';
import { JsonGuidedBlockSchema } from '../types/json-guide.schema';

const timeoutSchema = JsonGuidedBlockSchema.shape.stepTimeout;

describe('guided timeout policy', () => {
  it.each([undefined, 1, 30_000, 120_000, MAX_GUIDED_STEP_TIMEOUT_MS])(
    'accepts an authored timeout of %s',
    (timeout) => {
      expect(timeoutSchema.safeParse(timeout).success).toBe(true);
    }
  );

  it.each([0, -1, 0.5, NaN, Infinity, 600_001, 2_147_483_647])('rejects an authored timeout of %s', (timeout) => {
    expect(timeoutSchema.safeParse(timeout).success).toBe(false);
  });

  it.each([600_001, 2_147_483_647, Number.MAX_VALUE])('clamps legacy runtime timeout %s', (timeout) => {
    const effective = getGuidedStepTimeout(timeout);
    expect(effective).toBe(MAX_GUIDED_STEP_TIMEOUT_MS);
    expect(effective + 10_000).toBeLessThan(2_147_483_647);
  });

  it.each([undefined, 0, -1, NaN, Infinity])('defaults invalid runtime timeout %s', (timeout) => {
    expect(getGuidedStepTimeout(timeout)).toBe(120_000);
  });
});
