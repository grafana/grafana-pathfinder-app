/**
 * Tests for docs-panel tab taxonomy helpers.
 */

import { getGuideStripTabs, hasOnlyNonContentTabs } from './tab-kinds';

describe('getGuideStripTabs', () => {
  it('keeps ordered strip tabs while excluding recommendations', () => {
    expect(
      getGuideStripTabs([
        { type: 'recommendations' },
        { type: 'editor' },
        { type: 'learning-journey' },
        { type: 'docs' },
      ])
    ).toEqual([{ type: 'editor' }, { type: 'learning-journey' }, { type: 'docs' }]);
  });
});

describe('hasOnlyNonContentTabs', () => {
  it('allows restore for chrome/editor state but blocks it when content is open', () => {
    expect(hasOnlyNonContentTabs([{ type: 'recommendations' }])).toBe(true);
    expect(hasOnlyNonContentTabs([{ type: 'recommendations' }, { type: 'editor' }])).toBe(true);
    expect(hasOnlyNonContentTabs([{ type: 'recommendations' }, { type: 'learning-journey' }])).toBe(false);
  });
});
