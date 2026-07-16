import { describe, it, expect, beforeEach } from '@jest/globals';
import { resolveSelector } from './selector-resolver';

describe('selector-resolver', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('resolveSelector', () => {
    it('should resolve grafana: prefix to an embeddable :is() CSS selector', () => {
      const result = resolveSelector('grafana:components.RefreshPicker.runButtonV2');
      expect(result).toBe(
        ":is([data-testid='data-testid RefreshPicker run button'], [aria-label='data-testid RefreshPicker run button'])"
      );
    });

    it('should handle grafana: prefix with parameter', () => {
      const result = resolveSelector('grafana:components.Breadcrumbs.breadcrumb:Home');
      expect(result).toContain("[data-testid='data-testid Home breadcrumb']");
    });

    it('should return standard CSS selector unchanged', () => {
      const cssSelector = 'button[data-testid="my-button"]';
      const result = resolveSelector(cssSelector);
      expect(result).toBe(cssSelector);
    });

    it('should return standard CSS selector with class unchanged', () => {
      const cssSelector = 'button.primary-button';
      const result = resolveSelector(cssSelector);
      expect(result).toBe(cssSelector);
    });

    it('should return complex CSS selector unchanged', () => {
      const cssSelector = 'div.container > button:first-child';
      const result = resolveSelector(cssSelector);
      expect(result).toBe(cssSelector);
    });

    it('should handle empty selector', () => {
      const result = resolveSelector('');
      expect(result).toBe('');
    });

    it('should handle invalid grafana selector gracefully', () => {
      const invalidSelector = 'grafana:invalid.path';
      const result = resolveSelector(invalidSelector);
      // Should return original selector as fallback
      expect(result).toBe(invalidSelector);
    });

    it('should handle grafana: prefix without path', () => {
      const result = resolveSelector('grafana:');
      // toGrafanaSelector will be called with empty string, which will fail
      // Should return original selector as fallback
      expect(result).toBe('grafana:');
    });

    it('should handle colons in CSS selectors (not grafana prefix)', () => {
      const cssSelector = 'button:hover';
      const result = resolveSelector(cssSelector);
      expect(result).toBe(cssSelector);
    });

    it('splits path and parameter at the first colon so parameters may contain colons', () => {
      const result = resolveSelector('grafana:components.Breadcrumbs.breadcrumb:Prod: Overview');
      expect(result).toContain("[data-testid='data-testid Prod: Overview breadcrumb']");
    });

    it('quotes resolved values safely so the emitted CSS stays valid and matchable', () => {
      const result = resolveSelector("grafana:components.Breadcrumbs.breadcrumb:Mark's dashboard");
      // Single-quote-bearing values are double-quoted rather than escaped:
      // nwsapi (jsdom) drops matches for escaped quotes inside :is().
      expect(result).toContain('[data-testid="data-testid Mark\'s dashboard breadcrumb"]');

      const el = document.createElement('span');
      el.setAttribute('data-testid', "data-testid Mark's dashboard breadcrumb");
      document.body.appendChild(el);
      expect(Array.from(document.querySelectorAll(result))).toContain(el);
    });
  });

  describe('resolveSelector with panel: prefix', () => {
    it('resolves a panel title to a panel container selector', () => {
      expect(resolveSelector('panel:CPU Usage')).toBe(
        '[data-viz-panel-key]:has([data-testid*="Panel header CPU Usage"])'
      );
    });

    it('appends the child selector after the panel container', () => {
      expect(resolveSelector('panel:CPU Usage > .menu')).toBe(
        '[data-viz-panel-key]:has([data-testid*="Panel header CPU Usage"]) .menu'
      );
    });

    it('escapes double quotes in the panel title', () => {
      expect(resolveSelector('panel:He said "hi"')).toBe(
        '[data-viz-panel-key]:has([data-testid*="Panel header He said \\"hi\\""])'
      );
    });
  });
});
