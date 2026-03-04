/**
 * Tests for suggestion global state
 */

import { suggestionState, SUGGESTIONS_UPDATED_EVENT } from './suggestion';

describe('suggestionState', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  describe('getSuggestions', () => {
    it('should return empty array when no suggestions set', () => {
      expect(suggestionState.getSuggestions()).toEqual([]);
    });

    it('should return stored suggestions', () => {
      const suggestions = [
        { title: 'Guide A', url: '/docs/a', type: 'docs-page' as const },
        { title: 'Guide B', url: 'bundled:b', type: 'learning-journey' as const },
      ];
      suggestionState.setSuggestions(suggestions);

      expect(suggestionState.getSuggestions()).toEqual(suggestions);
    });

    it('should return empty array for corrupted sessionStorage data', () => {
      sessionStorage.setItem('grafana-pathfinder-app-suggestions', '{invalid json');

      expect(suggestionState.getSuggestions()).toEqual([]);
    });

    it('should return empty array for non-array sessionStorage data', () => {
      sessionStorage.setItem('grafana-pathfinder-app-suggestions', '"not-an-array"');

      expect(suggestionState.getSuggestions()).toEqual([]);
    });
  });

  describe('setSuggestions', () => {
    it('should persist suggestions to sessionStorage', () => {
      const suggestions = [{ title: 'Guide A', url: '/docs/a' }];
      suggestionState.setSuggestions(suggestions);

      const stored = JSON.parse(sessionStorage.getItem('grafana-pathfinder-app-suggestions')!);
      expect(stored).toEqual(suggestions);
    });

    it('should dispatch pathfinder-suggestions-updated event', () => {
      const handler = jest.fn();
      document.addEventListener(SUGGESTIONS_UPDATED_EVENT, handler);

      suggestionState.setSuggestions([{ title: 'Guide', url: '/docs/guide' }]);

      expect(handler).toHaveBeenCalledTimes(1);

      document.removeEventListener(SUGGESTIONS_UPDATED_EVENT, handler);
    });

    it('should replace previous suggestions', () => {
      suggestionState.setSuggestions([{ title: 'Old', url: '/old' }]);
      suggestionState.setSuggestions([{ title: 'New', url: '/new' }]);

      const result = suggestionState.getSuggestions();
      expect(result).toHaveLength(1);
      expect(result[0]!.title).toBe('New');
    });
  });

  describe('clearSuggestions', () => {
    it('should remove suggestions from sessionStorage', () => {
      suggestionState.setSuggestions([{ title: 'Guide', url: '/docs/guide' }]);

      suggestionState.clearSuggestions();

      expect(suggestionState.getSuggestions()).toEqual([]);
      expect(sessionStorage.getItem('grafana-pathfinder-app-suggestions')).toBeNull();
    });

    it('should dispatch pathfinder-suggestions-updated event', () => {
      const handler = jest.fn();
      document.addEventListener(SUGGESTIONS_UPDATED_EVENT, handler);

      suggestionState.clearSuggestions();

      expect(handler).toHaveBeenCalledTimes(1);

      document.removeEventListener(SUGGESTIONS_UPDATED_EVENT, handler);
    });
  });
});
