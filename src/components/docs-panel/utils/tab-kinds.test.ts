/**
 * Tests for docs-panel tab taxonomy helpers.
 */

import { getGuideStripTabs } from './tab-kinds';

describe('getGuideStripTabs', () => {
  it('keeps ordered strip tabs while excluding recommendations', () => {
    expect(
      getGuideStripTabs([
        { type: 'recommendations' },
        { type: 'editor' },
        { type: 'learning-journey' },
        { type: 'devtools' },
        { type: 'docs' },
      ])
    ).toEqual([{ type: 'editor' }, { type: 'learning-journey' }, { type: 'devtools' }, { type: 'docs' }]);
  });
});
