import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  toGrafanaSelector,
  findByGrafanaSelector,
  findOneByGrafanaSelector,
  existsByGrafanaSelector,
  findGrafanaSelectorPath,
} from './grafana-selector';

function elementWith(attrs: Record<string, string>): HTMLElement {
  const el = document.createElement('button');
  for (const [name, value] of Object.entries(attrs)) {
    el.setAttribute(name, value);
  }
  return el;
}

describe('grafana-selector', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('toGrafanaSelector', () => {
    it('should convert a simple selector path to CSS selector', () => {
      // This tests that we can navigate the selector object and generate a CSS selector
      // The actual selectors come from @grafana/e2e-selectors
      const result = toGrafanaSelector('components.RefreshPicker.runButtonV2');
      expect(result).toContain("[data-testid='data-testid RefreshPicker run button']");
      expect(result).toContain("[aria-label='data-testid RefreshPicker run button']");
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
      expect(elements[0]!.tagName).toBe('BUTTON');
    });

    it('should find elements by aria-label', () => {
      document.body.innerHTML = `
        <button aria-label="data-testid RefreshPicker run button">Click me</button>
      `;

      const elements = findByGrafanaSelector('components.RefreshPicker.runButtonV2');
      expect(elements.length).toBe(1);
      expect(elements[0]!.tagName).toBe('BUTTON');
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

  describe('findGrafanaSelectorPath (reverse lookup)', () => {
    it('maps a component data-testid back to its grafana: components path', () => {
      const el = elementWith({ 'data-testid': 'data-testid RefreshPicker run button' });
      const path = findGrafanaSelectorPath(el);

      expect(path).not.toBeNull();
      expect(path!.startsWith('grafana:components.')).toBe(true);
      // Round-trips: resolving the returned path yields the element's value.
      expect(toGrafanaSelector(path!.replace('grafana:', ''))).toContain('data-testid RefreshPicker run button');
    });

    it('maps a page-level data-testid back to its grafana: pages path', () => {
      const el = elementWith({ 'data-testid': 'data-testid Username input field' });
      const path = findGrafanaSelectorPath(el);

      expect(path).not.toBeNull();
      expect(path!.startsWith('grafana:pages.')).toBe(true);
      expect(toGrafanaSelector(path!.replace('grafana:', ''))).toContain('data-testid Username input field');
    });

    it('falls back to aria-label when there is no data-testid', () => {
      const el = elementWith({ 'aria-label': 'data-testid RefreshPicker run button' });
      const path = findGrafanaSelectorPath(el);

      expect(path).not.toBeNull();
      expect(toGrafanaSelector(path!.replace('grafana:', ''))).toContain('data-testid RefreshPicker run button');
    });

    it('reverses a parameterized selector and extracts the parameter', () => {
      const el = elementWith({ 'data-testid': 'data-testid Home breadcrumb' });
      const path = findGrafanaSelectorPath(el);

      expect(path).toBe('grafana:components.Breadcrumbs.breadcrumb:Home');
    });

    it('returns null for an unknown selector value', () => {
      const el = elementWith({ 'data-testid': 'totally-not-a-grafana-selector-xyz' });
      expect(findGrafanaSelectorPath(el)).toBeNull();
    });

    it('returns null when the element has no testid or aria-label', () => {
      const el = elementWith({ class: 'plain' });
      expect(findGrafanaSelectorPath(el)).toBeNull();
    });
  });
});
