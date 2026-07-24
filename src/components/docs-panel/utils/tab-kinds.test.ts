/**
 * Tests for docs-panel tab taxonomy helpers.
 */

import {
  DEVTOOLS_TAB_ID,
  EDITOR_TAB_ID,
  RECOMMENDATIONS_TAB_ID,
  hasNoGuideStripTabs,
  hasOnlyNonContentTabs,
  isNonContentTab,
} from './tab-kinds';

describe('hasNoGuideStripTabs', () => {
  it('is true when only strip-excluded chrome is present', () => {
    expect(hasNoGuideStripTabs([{ id: RECOMMENDATIONS_TAB_ID }])).toBe(true);
    expect(hasNoGuideStripTabs([{ id: RECOMMENDATIONS_TAB_ID }, { id: DEVTOOLS_TAB_ID }])).toBe(true);
  });

  it('is false when editor or any guide tab is open', () => {
    expect(hasNoGuideStripTabs([{ id: RECOMMENDATIONS_TAB_ID }, { id: EDITOR_TAB_ID }])).toBe(false);
    expect(hasNoGuideStripTabs([{ id: RECOMMENDATIONS_TAB_ID }, { id: 'guide-1' }])).toBe(false);
  });
});

describe('hasOnlyNonContentTabs', () => {
  it('allows restore when only chrome and/or editor are present', () => {
    expect(hasOnlyNonContentTabs([{ id: RECOMMENDATIONS_TAB_ID }])).toBe(true);
    expect(hasOnlyNonContentTabs([{ id: RECOMMENDATIONS_TAB_ID }, { id: EDITOR_TAB_ID, type: 'editor' }])).toBe(true);
  });

  it('blocks restore when a content tab is open', () => {
    expect(hasOnlyNonContentTabs([{ id: RECOMMENDATIONS_TAB_ID }, { id: 'guide-1', type: 'learning-journey' }])).toBe(
      false
    );
  });
});

describe('isNonContentTab', () => {
  it('treats recommendations, devtools, and editor as non-content', () => {
    expect(isNonContentTab({ id: RECOMMENDATIONS_TAB_ID })).toBe(true);
    expect(isNonContentTab({ id: DEVTOOLS_TAB_ID, type: 'devtools' })).toBe(true);
    expect(isNonContentTab({ id: EDITOR_TAB_ID, type: 'editor' })).toBe(true);
  });

  it('treats docs / journey tabs as content', () => {
    expect(isNonContentTab({ id: 'guide-1', type: 'learning-journey' })).toBe(false);
    expect(isNonContentTab({ id: 'guide-1', type: 'docs' })).toBe(false);
  });
});
