/**
 * Unit tests for selector detection utility
 */

import { isCssSelector } from './selector-detector';

describe('isCssSelector', () => {
  describe('CSS Selectors - should return true', () => {
    it('recognizes ID selectors', () => {
      expect(isCssSelector('#my-button')).toBe(true);
      expect(isCssSelector('#test-123')).toBe(true);
      expect(isCssSelector('#panel_editor')).toBe(true);
    });

    it('recognizes class selectors', () => {
      expect(isCssSelector('.btn-primary')).toBe(true);
      expect(isCssSelector('.my-class')).toBe(true);
      expect(isCssSelector('.test_class-name')).toBe(true);
    });

    it('recognizes attribute selectors', () => {
      expect(isCssSelector('[data-testid="save"]')).toBe(true);
      expect(isCssSelector('[role="button"]')).toBe(true);
      expect(isCssSelector('[aria-label="Close"]')).toBe(true);
      expect(isCssSelector('[href*="/dashboard"]')).toBe(true);
    });

    it('recognizes tag with attribute selectors', () => {
      expect(isCssSelector('button[data-testid="save"]')).toBe(true);
      expect(isCssSelector('div[role="button"]')).toBe(true);
      expect(isCssSelector('a[href="/dashboard"]')).toBe(true);
    });

    it('recognizes pseudo-class selectors', () => {
      expect(isCssSelector('button:hover')).toBe(true);
      expect(isCssSelector('input:focus')).toBe(true);
      expect(isCssSelector('div:first-child')).toBe(true);
      expect(isCssSelector(':focus')).toBe(true);
    });

    it('recognizes child combinator selectors', () => {
      expect(isCssSelector('div > button')).toBe(true);
      expect(isCssSelector('nav > ul > li')).toBe(true);
      expect(isCssSelector('parent > child')).toBe(true);
    });

    it('recognizes adjacent sibling combinator selectors', () => {
      expect(isCssSelector('div + button')).toBe(true);
      expect(isCssSelector('h1 + p')).toBe(true);
      expect(isCssSelector('label + input')).toBe(true);
    });

    it('recognizes general sibling combinator selectors', () => {
      expect(isCssSelector('div ~ button')).toBe(true);
      expect(isCssSelector('h1 ~ p')).toBe(true);
      expect(isCssSelector('label ~ input')).toBe(true);
    });

    it('recognizes complex selectors with combinators in the middle', () => {
      expect(isCssSelector('nav ul > li')).toBe(true);
      expect(isCssSelector('div span + button')).toBe(true);
      expect(isCssSelector('header section ~ footer')).toBe(true);
    });
  });

  describe('Plain Text - should return false', () => {
    it('recognizes simple button text', () => {
      expect(isCssSelector('Save Dashboard')).toBe(false);
      expect(isCssSelector('OK')).toBe(false);
      expect(isCssSelector('Cancel')).toBe(false);
      expect(isCssSelector('Submit')).toBe(false);
    });

    it('recognizes text with special characters', () => {
      expect(isCssSelector('Save & Test')).toBe(false);
      expect(isCssSelector('Add panel')).toBe(false);
      expect(isCssSelector('New dashboard')).toBe(false);
    });

    it('recognizes multi-word text', () => {
      expect(isCssSelector('Create New Dashboard')).toBe(false);
      expect(isCssSelector('Save and continue')).toBe(false);
      expect(isCssSelector('Apply changes')).toBe(false);
    });

    it('recognizes text with punctuation', () => {
      expect(isCssSelector('Save & Test')).toBe(false);
      expect(isCssSelector("Don't save")).toBe(false);
      expect(isCssSelector('Yes, delete it')).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('handles single tag names', () => {
      // Single tag names without any selectors are ambiguous
      // They could be button text or CSS selectors
      // We treat them as text (false) since they're more likely to be button labels
      expect(isCssSelector('button')).toBe(false);
      expect(isCssSelector('div')).toBe(false);
      expect(isCssSelector('span')).toBe(false);
    });

    it('handles empty strings', () => {
      expect(isCssSelector('')).toBe(false);
      expect(isCssSelector('   ')).toBe(false);
    });

    it('handles null/undefined gracefully', () => {
      expect(isCssSelector(null as any)).toBe(false);
      expect(isCssSelector(undefined as any)).toBe(false);
    });

    it('handles strings with leading/trailing whitespace', () => {
      expect(isCssSelector('  #my-button  ')).toBe(true);
      expect(isCssSelector('  .btn-primary  ')).toBe(true);
      expect(isCssSelector('  Save Dashboard  ')).toBe(false);
    });

    it('distinguishes between similar patterns', () => {
      // These look similar but have different meanings
      expect(isCssSelector('[data-testid="save"]')).toBe(true); // Selector
      expect(isCssSelector('Save [data-testid="save"]')).toBe(false); // Text with brackets

      expect(isCssSelector('.my-class')).toBe(true); // Class selector
      expect(isCssSelector('My .class')).toBe(false); // Text with dot

      expect(isCssSelector('#id')).toBe(true); // ID selector
      expect(isCssSelector('Issue #123')).toBe(false); // Text with hash
    });

    it('handles complex real-world selectors', () => {
      expect(isCssSelector('button[data-testid="panel-editor-save"]')).toBe(true);
      expect(isCssSelector('.css-1234abcd-Button')).toBe(true);
      expect(isCssSelector('#grafana-portal button.primary')).toBe(true);
      expect(isCssSelector('[aria-label="Add panel"] > span')).toBe(true);
    });

    it('handles complex real-world button text', () => {
      expect(isCssSelector('Add new panel')).toBe(false);
      expect(isCssSelector('Save dashboard')).toBe(false);
      expect(isCssSelector('Apply time range')).toBe(false);
      expect(isCssSelector('Create alert rule')).toBe(false);
    });
  });

  describe('Ambiguous Cases - documented behavior', () => {
    it('treats tag names as text by default', () => {
      // Single tag names are ambiguous, but we treat them as text
      // because CSS selectors should be more specific for reliability
      expect(isCssSelector('button')).toBe(false);
      expect(isCssSelector('input')).toBe(false);
      expect(isCssSelector('a')).toBe(false);
    });

    it('requires specific selector syntax for CSS', () => {
      // If you want to select by tag, use it with other syntax
      expect(isCssSelector('button:hover')).toBe(true); // Pseudo-class makes it clear
      expect(isCssSelector('button[role]')).toBe(true); // Attribute makes it clear
      expect(isCssSelector('div > button')).toBe(true); // Combinator makes it clear
    });
  });
});
