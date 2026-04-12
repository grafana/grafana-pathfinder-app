import { mainAreaLearningState } from './main-area-learning-state';

describe('mainAreaLearningState', () => {
  afterEach(() => {
    mainAreaLearningState.setIsActive(false);
  });

  it('returns false by default', () => {
    expect(mainAreaLearningState.getIsActive()).toBe(false);
  });

  it('returns true after setIsActive(true)', () => {
    mainAreaLearningState.setIsActive(true);
    expect(mainAreaLearningState.getIsActive()).toBe(true);
  });

  it('returns false after setIsActive(false)', () => {
    mainAreaLearningState.setIsActive(true);
    mainAreaLearningState.setIsActive(false);
    expect(mainAreaLearningState.getIsActive()).toBe(false);
  });
});
