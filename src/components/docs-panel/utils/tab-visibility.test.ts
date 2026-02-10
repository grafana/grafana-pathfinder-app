/**
 * Tests for tab-visibility pure utility.
 * No mocking; tests partition of tabs into visible vs overflow by width.
 */

import { computeTabVisibility } from './tab-visibility';
import type { LearningJourneyTab } from '../../../types/content-panel.types';

function tab(id: string, title: string): LearningJourneyTab {
  return {
    id,
    title,
    baseUrl: '',
    currentUrl: '',
    content: null,
    isLoading: false,
    error: null,
  };
}

describe('computeTabVisibility', () => {
  const recs = tab('recommendations', 'Recommendations');
  const myLearning = tab('my-learning', 'My learning');
  const guide1 = tab('guide-1', 'Guide 1');
  const guide2 = tab('guide-2', 'Guide 2');
  const guide3 = tab('guide-3', 'Guide 3');

  describe('when only permanent tabs exist', () => {
    it('returns all tabs as visible and no overflow', () => {
      const tabs = [recs, myLearning];
      const result = computeTabVisibility(tabs, 500, 'recommendations');
      expect(result.visibleTabs).toEqual(tabs);
      expect(result.overflowedTabs).toEqual([]);
    });
  });

  describe('when container width is zero', () => {
    it('returns all tabs visible and no overflow', () => {
      const tabs = [recs, myLearning, guide1];
      const result = computeTabVisibility(tabs, 0, 'guide-1');
      expect(result.visibleTabs).toEqual(tabs);
      expect(result.overflowedTabs).toEqual([]);
    });
  });

  describe('with one guide tab', () => {
    it('always shows the guide tab in visible', () => {
      const tabs = [recs, myLearning, guide1];
      const result = computeTabVisibility(tabs, 200, 'guide-1');
      expect(result.visibleTabs).toContainEqual(guide1);
      expect(result.overflowedTabs).toEqual([]);
    });
  });

  describe('with multiple guide tabs and limited width', () => {
    it('splits visible and overflow by available width', () => {
      const tabs = [recs, myLearning, guide1, guide2, guide3];
      // reserved 130; available e.g. 200 -> 70 for tabs; 84 per tab -> 0 fit, but we force at least 1
      const result = computeTabVisibility(tabs, 200, 'guide-1');
      expect(result.visibleTabs).toEqual([recs, myLearning, guide1]);
      expect(result.overflowedTabs).toEqual([guide2, guide3]);
    });

    it('keeps active tab in visible when it would be in overflow', () => {
      const tabs = [recs, myLearning, guide1, guide2, guide3];
      const result = computeTabVisibility(tabs, 200, 'guide-3');
      expect(result.visibleTabs).toContainEqual(guide3);
      expect(result.overflowedTabs).not.toContainEqual(guide3);
      // With width for only 1 guide tab, visible is active only; rest overflow
      expect(result.visibleTabs).toEqual([recs, myLearning, guide3]);
      expect(result.overflowedTabs).toEqual([guide1, guide2]);
    });
  });

  describe('with enough width for all guide tabs', () => {
    it('shows all tabs in visible and no overflow', () => {
      const tabs = [recs, myLearning, guide1, guide2, guide3];
      const result = computeTabVisibility(tabs, 600, 'guide-1');
      expect(result.visibleTabs).toEqual(tabs);
      expect(result.overflowedTabs).toEqual([]);
    });
  });

  describe('permanent tabs order', () => {
    it('keeps recommendations and my-learning at start of visible', () => {
      const tabs = [recs, myLearning, guide1];
      const result = computeTabVisibility(tabs, 300, 'guide-1');
      expect(result.visibleTabs[0]).toEqual(recs);
      expect(result.visibleTabs[1]).toEqual(myLearning);
      expect(result.visibleTabs[2]).toEqual(guide1);
    });
  });
});
