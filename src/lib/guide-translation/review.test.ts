import { isEntryReviewed } from './review';

describe('isEntryReviewed', () => {
  it('counts an entry marked reviewed', () => {
    expect(isEntryReviewed({ content: '本文', reviewed: true })).toBe(true);
  });

  it.each([
    ['an entry marked not reviewed', { content: '本文', reviewed: false }],
    ['an entry with no mark', { content: '本文' }],
    ['a missing entry', undefined],
  ])('does not count %s', (_label, entry) => {
    expect(isEntryReviewed(entry)).toBe(false);
  });
});
