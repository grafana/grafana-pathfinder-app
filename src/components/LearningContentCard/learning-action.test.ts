import { getLearningAction } from './learning-action';

describe('getLearningAction', () => {
  it.each([
    ['docs', 0, 'read'],
    ['docs', 100, 'read'],
    ['guide', 0, 'start'],
    ['path', 40, 'resume'],
    ['guide', 100, 'review'],
  ] as const)('maps a %s at %i%% to %s', (kind, percent, action) => {
    expect(getLearningAction(kind, percent)).toBe(action);
  });
});
