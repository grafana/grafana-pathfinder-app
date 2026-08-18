import { JsonGuidedBlockSchema } from './json-guide.schema';

function block(stepTimeout: number) {
  return {
    type: 'guided',
    content: 'Guided timeout',
    steps: [{ action: 'noop' }],
    stepTimeout,
  };
}

describe('JsonGuidedBlockSchema stepTimeout', () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects %s', (stepTimeout) => {
    expect(JsonGuidedBlockSchema.safeParse(block(stepTimeout)).success).toBe(false);
  });

  it.each([30000, 45000, 60000, 120000])('accepts %ims', (stepTimeout) => {
    expect(JsonGuidedBlockSchema.safeParse(block(stepTimeout)).success).toBe(true);
  });
});
