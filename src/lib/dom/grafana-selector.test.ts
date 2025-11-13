import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  toGrafanaSelector,
  findByGrafanaSelector,
  findOneByGrafanaSelector,
  existsByGrafanaSelector,
  navSelectors,
  selectors,
} from './grafana-selector';

describe('grafana-selector', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('toGrafanaSelector', () => {
    it('should convert a simple selector path to CSS selector', () => {
      // This tests that we can navigate the selector object and generate a CSS selector
      // The actual selectors come from @grafana/e2e-selectors
      const result = toGrafanaSelector('components.RefreshPicker.runButtonV2');
      expect(result).toContain('[data-testid="data-testid RefreshPicker run button"]');
      expect(result).toContain('[aria-label="data-testid RefreshPicker run button"]');
    });

    it('should throw error for empty selector path', () => {
      expect(() => toGrafanaSelector('')).toThrow('Selector path is required');
    });

    it('should throw error for invalid selector path', () => {
      expect(() => toGrafanaSelector('invalid.nonexistent.path')).toThrow('Selector not found');
    });

    it('should throw error for incomplete path', () => {
      expect(() => toGrafanaSelector('components')).toThrow('Invalid selector type');
    });
  });

  describe('findByGrafanaSelector', () => {
    it('should find elements by data-testid', () => {
      // Create a test element with the expected format from Grafana selectors
      document.body.innerHTML = `
        <button data-testid="data-testid RefreshPicker run button">Click me</button>
      `;

      const elements = findByGrafanaSelector('components.RefreshPicker.runButtonV2');
      expect(elements.length).toBe(1);
      expect(elements[0].tagName).toBe('BUTTON');
    });

    it('should find elements by aria-label', () => {
      document.body.innerHTML = `
        <button aria-label="data-testid RefreshPicker run button">Click me</button>
      `;

      const elements = findByGrafanaSelector('components.RefreshPicker.runButtonV2');
      expect(elements.length).toBe(1);
      expect(elements[0].tagName).toBe('BUTTON');
    });

    it('should return empty array if no elements found', () => {
      // Don't add any matching elements to the DOM
      const elements = findByGrafanaSelector('components.RefreshPicker.runButtonV2');
      expect(elements).toEqual([]);
    });
  });

  describe('findOneByGrafanaSelector', () => {
    it('should return first matching element', () => {
      document.body.innerHTML = `
        <button data-testid="data-testid RefreshPicker run button">First</button>
        <button data-testid="data-testid RefreshPicker run button">Second</button>
      `;

      const element = findOneByGrafanaSelector('components.RefreshPicker.runButtonV2');
      expect(element).not.toBeNull();
      expect(element?.textContent).toBe('First');
    });

    it('should return null if no elements found', () => {
      const element = findOneByGrafanaSelector('components.RefreshPicker.runButtonV2');
      expect(element).toBeNull();
    });
  });

  describe('existsByGrafanaSelector', () => {
    it('should return true if element exists', () => {
      document.body.innerHTML = `
        <button data-testid="data-testid RefreshPicker run button">Click me</button>
      `;

      expect(existsByGrafanaSelector('components.RefreshPicker.runButtonV2')).toBe(true);
    });

    it('should return false if element does not exist', () => {
      expect(existsByGrafanaSelector('components.RefreshPicker.runButtonV2')).toBe(false);
    });
  });

  describe('navSelectors', () => {
    it('should create selector by href', () => {
      const selector = navSelectors.menuItemByHref('/dashboards');
      expect(selector).toBe('a[data-testid="data-testid Nav menu item"][href="/dashboards"]');
    });

    it('should create selector by text', () => {
      const selector = navSelectors.menuItemByText('Dashboards');
      expect(selector).toBe('a[data-testid="data-testid Nav menu item"]:contains("Dashboards")');
    });
  });

  describe('selectors export', () => {
    it('should export Grafana selectors', () => {
      expect(selectors).toBeDefined();
      expect(selectors.components).toBeDefined();
      expect(selectors.pages).toBeDefined();
    });
  });
});
