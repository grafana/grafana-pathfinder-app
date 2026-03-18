/**
 * Tests for tab-validation utility functions.
 * Pure functions with zero dependencies - no mocking needed.
 */

import { isDocsLikeTab } from './tab-validation';

describe('isDocsLikeTab', () => {
  describe('returns true for docs-like types', () => {
    it('returns true for "docs" type', () => {
      expect(isDocsLikeTab('docs')).toBe(true);
    });

    it('returns true for "interactive" type', () => {
      expect(isDocsLikeTab('interactive')).toBe(true);
    });
  });

  describe('returns false for non-docs types', () => {
    it('returns false for "learning-journey" type', () => {
      expect(isDocsLikeTab('learning-journey')).toBe(false);
    });

    it('returns false for "devtools" type', () => {
      expect(isDocsLikeTab('devtools')).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isDocsLikeTab(undefined)).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isDocsLikeTab('')).toBe(false);
    });

    it('returns false for arbitrary string', () => {
      expect(isDocsLikeTab('something-else')).toBe(false);
    });
  });
});
