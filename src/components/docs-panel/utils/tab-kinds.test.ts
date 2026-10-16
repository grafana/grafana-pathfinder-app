/**
 * Tests for docs-panel tab taxonomy helpers.
 */

import { createBrowseTab, getGuideStripTabs, isNonContentTab } from './tab-kinds';
import { closeTabState, projectPersistedTabs } from './tab-state-transitions';

it('keeps Browse as permanent chrome without fetching or persisting a guide', () => {
  const browse = createBrowseTab();
  expect(isNonContentTab(browse)).toBe(true);
  expect(getGuideStripTabs([browse])).toEqual([]);
  expect(projectPersistedTabs([browse])).toEqual([]);
  expect(closeTabState({ tabs: [browse], activeTabId: browse.id }, browse.id).changed).toBe(false);
});

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
