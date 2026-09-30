import { markCurrentGuide } from './mark-current-guide';

describe('markCurrentGuide', () => {
  it('marks only the first incomplete guide current', () => {
    const result = markCurrentGuide([{ completed: true }, { completed: false }, { completed: false }]);
    expect(result.map((g) => g.isCurrent)).toEqual([false, true, false]);
  });

  it('marks nothing current when every guide is completed', () => {
    expect(markCurrentGuide([{ completed: true }, { completed: true }]).map((g) => g.isCurrent)).toEqual([
      false,
      false,
    ]);
  });

  it('preserves extra fields and handles an empty list', () => {
    expect(markCurrentGuide([{ completed: false, id: 'a' }])).toEqual([{ completed: false, id: 'a', isCurrent: true }]);
    expect(markCurrentGuide([])).toEqual([]);
  });
});
