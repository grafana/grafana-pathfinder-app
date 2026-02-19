/**
 * Tests for tab-translations utility functions.
 * Tests the translation mapping for tab titles.
 */

import { getTranslatedTitle } from './tab-translations';

// Mock @grafana/i18n t() function to return predictable values
jest.mock('@grafana/i18n', () => ({
  t: jest.fn((key: string, fallback: string) => `[translated:${key}]${fallback}`),
}));

describe('getTranslatedTitle', () => {
  describe('translates known system titles', () => {
    it('translates "Learning path" (lowercase p)', () => {
      const result = getTranslatedTitle('Learning path');
      expect(result).toBe('[translated:docsPanel.learningJourney]Learning path');
    });

    it('translates "Learning Path" (uppercase P)', () => {
      const result = getTranslatedTitle('Learning Path');
      expect(result).toBe('[translated:docsPanel.learningJourney]Learning Path');
    });

    it('translates legacy "Learning journey" (lowercase j) for backwards compatibility', () => {
      const result = getTranslatedTitle('Learning journey');
      expect(result).toBe('[translated:docsPanel.learningJourney]Learning path');
    });

    it('translates legacy "Learning Journey" (uppercase J) for backwards compatibility', () => {
      const result = getTranslatedTitle('Learning Journey');
      expect(result).toBe('[translated:docsPanel.learningJourney]Learning Path');
    });

    it('translates "Documentation"', () => {
      const result = getTranslatedTitle('Documentation');
      expect(result).toBe('[translated:docsPanel.documentation]Documentation');
    });
  });

  describe('preserves custom titles unchanged', () => {
    it('preserves custom title "My Custom Tab"', () => {
      const result = getTranslatedTitle('My Custom Tab');
      expect(result).toBe('My Custom Tab');
    });

    it('preserves custom title with similar but not exact text', () => {
      const result = getTranslatedTitle('Learning paths'); // plural
      expect(result).toBe('Learning paths');
    });

    it('preserves empty string', () => {
      const result = getTranslatedTitle('');
      expect(result).toBe('');
    });

    it('preserves arbitrary text', () => {
      const result = getTranslatedTitle('Getting Started with Prometheus');
      expect(result).toBe('Getting Started with Prometheus');
    });
  });
});
