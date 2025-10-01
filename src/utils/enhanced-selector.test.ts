/**
 * Tests for enhanced selector functionality
 */

import { querySelectorAllEnhanced } from './enhanced-selector';

describe('Enhanced Selector', () => {
  beforeEach(() => {
    // Clear the document body before each test
    document.body.innerHTML = '';
  });

  describe('Standard CSS selectors', () => {
    it('should handle :nth-child() correctly', () => {
      // Create a test DOM structure
      document.body.innerHTML = `
        <div class="parent">
          <span>First child</span>
          <div data-testid="uplot-main-div">Second child - first uplot</div>
          <div data-testid="uplot-main-div">Third child - second uplot</div>
          <div data-testid="uplot-main-div">Fourth child - third uplot</div>
        </div>
      `;

      // :nth-child(3) means "the element that is the 3rd child of its parent"
      const result = querySelectorAllEnhanced('div[data-testid="uplot-main-div"]:nth-child(3)');

      expect(result.elements.length).toBe(1);
      expect(result.elements[0].textContent).toContain('Third child - second uplot');
    });

    it('should handle :nth-of-type() correctly', () => {
      document.body.innerHTML = `
        <div class="parent">
          <span>Not a div</span>
          <div data-testid="uplot-main-div">First div - first uplot</div>
          <div data-testid="uplot-main-div">Second div - second uplot</div>
          <div data-testid="uplot-main-div">Third div - third uplot</div>
        </div>
      `;

      // :nth-of-type(3) means "the element that is the 3rd div child of its parent"
      const result = querySelectorAllEnhanced('div[data-testid="uplot-main-div"]:nth-of-type(3)');

      expect(result.elements.length).toBe(1);
      expect(result.elements[0].textContent).toContain('Third div - third uplot');
    });

    it('should demonstrate the limitation of :nth-child with multiple parents', () => {
      document.body.innerHTML = `
        <div class="parent1">
          <div data-testid="uplot-main-div">Parent1 - uplot1</div>
        </div>
        <div class="parent2">
          <div data-testid="uplot-main-div">Parent2 - uplot1</div>
        </div>
        <div class="parent3">
          <span>First child</span>
          <div data-testid="uplot-main-div">Parent3 - uplot1 (2nd child)</div>
          <div data-testid="uplot-main-div">Parent3 - uplot2 (3rd child)</div>
        </div>
      `;

      // This will only match the element in parent3 that is the 3rd child
      const result = querySelectorAllEnhanced('div[data-testid="uplot-main-div"]:nth-child(3)');

      expect(result.elements.length).toBe(1);
      expect(result.elements[0].textContent).toContain('Parent3 - uplot2');
    });
  });

  describe('Complex selectors', () => {
    it('should handle :contains() selector', () => {
      document.body.innerHTML = `
        <div data-testid="container">
          <div>First item</div>
          <div>Second item with target text</div>
          <div>Third item</div>
        </div>
      `;

      const result = querySelectorAllEnhanced('div:contains("target text")');

      expect(result.elements.length).toBeGreaterThan(0);
      expect(result.usedFallback).toBe(true);
    });

    it('should handle :has() selector', () => {
      document.body.innerHTML = `
        <div class="card">
          <p>Has paragraph</p>
        </div>
        <div class="card">
          <span>No paragraph</span>
        </div>
      `;

      const result = querySelectorAllEnhanced('div.card:has(p)');

      expect(result.elements.length).toBe(1);
      expect(result.elements[0].textContent).toContain('Has paragraph');
    });

    it('should handle :nth-match() selector to get nth occurrence globally', () => {
      document.body.innerHTML = `
        <div class="parent1">
          <div data-testid="uplot-main-div">First uplot</div>
        </div>
        <div class="parent2">
          <div data-testid="uplot-main-div">Second uplot</div>
        </div>
        <div class="parent3">
          <div data-testid="uplot-main-div">Third uplot</div>
          <div data-testid="uplot-main-div">Fourth uplot</div>
        </div>
      `;

      // Get the 3rd occurrence of the element across the entire document
      const result = querySelectorAllEnhanced('div[data-testid="uplot-main-div"]:nth-match(3)');

      expect(result.elements.length).toBe(1);
      expect(result.elements[0].textContent).toContain('Third uplot');
      expect(result.usedFallback).toBe(true);
    });

    it('should handle :nth-match() with insufficient elements', () => {
      document.body.innerHTML = `
        <div data-testid="uplot-main-div">First</div>
        <div data-testid="uplot-main-div">Second</div>
      `;

      // Try to get the 5th element when only 2 exist
      const result = querySelectorAllEnhanced('div[data-testid="uplot-main-div"]:nth-match(5)');

      expect(result.elements.length).toBe(0);
      expect(result.effectiveSelector).toContain('wanted 5, found 2');
    });

    it('should handle :nth-match(1) to get first occurrence', () => {
      document.body.innerHTML = `
        <div class="parent1">
          <div data-testid="uplot-main-div">First</div>
        </div>
        <div class="parent2">
          <div data-testid="uplot-main-div">Second</div>
        </div>
      `;

      const result = querySelectorAllEnhanced('div[data-testid="uplot-main-div"]:nth-match(1)');

      expect(result.elements.length).toBe(1);
      expect(result.elements[0].textContent).toContain('First');
    });
  });

  describe('Edge cases', () => {
    it('should return empty array for non-existent selector', () => {
      document.body.innerHTML = '<div id="test">Test</div>';

      const result = querySelectorAllEnhanced('div[data-testid="non-existent"]');

      expect(result.elements.length).toBe(0);
      expect(result.usedFallback).toBe(false);
    });

    it('should handle invalid selector gracefully', () => {
      const result = querySelectorAllEnhanced('div[[[invalid');

      expect(result.elements.length).toBe(0);
    });
  });
});
