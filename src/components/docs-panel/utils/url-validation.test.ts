import { isGrafanaDocsUrl, cleanDocsUrl } from './url-validation';

// Mock the constants
jest.mock('../../../constants', () => ({
  ALLOWED_GRAFANA_DOCS_HOSTNAMES: ['grafana.com', 'docs.grafana.com'],
}));

describe('url-validation', () => {
  describe('isGrafanaDocsUrl', () => {
    it('returns false for undefined', () => {
      expect(isGrafanaDocsUrl(undefined)).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isGrafanaDocsUrl('')).toBe(false);
    });

    it('returns false for non-string values', () => {
      expect(isGrafanaDocsUrl(null as any)).toBe(false);
      expect(isGrafanaDocsUrl(123 as any)).toBe(false);
    });

    it('returns false for bundled URLs', () => {
      expect(isGrafanaDocsUrl('bundled:some-guide')).toBe(false);
    });

    it('returns false for invalid URLs', () => {
      expect(isGrafanaDocsUrl('not-a-url')).toBe(false);
      expect(isGrafanaDocsUrl('://invalid')).toBe(false);
    });

    it('returns true for allowed Grafana domain', () => {
      expect(isGrafanaDocsUrl('https://grafana.com/docs/something')).toBe(true);
      expect(isGrafanaDocsUrl('https://docs.grafana.com/latest/intro')).toBe(true);
    });

    it('returns false for non-allowed domains', () => {
      expect(isGrafanaDocsUrl('https://evil.com/docs')).toBe(false);
      expect(isGrafanaDocsUrl('https://example.com')).toBe(false);
    });

    it('returns false for subdomains not in allowlist', () => {
      expect(isGrafanaDocsUrl('https://subdomain.grafana.com/docs')).toBe(false);
    });

    it('handles URLs with query params and fragments', () => {
      expect(isGrafanaDocsUrl('https://grafana.com/docs?foo=bar#section')).toBe(true);
    });
  });

  describe('cleanDocsUrl', () => {
    it('removes /unstyled.html suffix', () => {
      expect(cleanDocsUrl('https://grafana.com/docs/page/unstyled.html')).toBe('https://grafana.com/docs/page');
    });

    it('does not remove /unstyled.html when not at end', () => {
      expect(cleanDocsUrl('https://grafana.com/docs/unstyled.html/page')).toBe(
        'https://grafana.com/docs/unstyled.html/page'
      );
    });

    it('does not modify URLs without /unstyled.html', () => {
      const url = 'https://grafana.com/docs/page';
      expect(cleanDocsUrl(url)).toBe(url);
    });

    it('only removes the suffix pattern, not partial matches', () => {
      expect(cleanDocsUrl('https://grafana.com/unstyled.html.txt')).toBe('https://grafana.com/unstyled.html.txt');
    });

    it('handles multiple occurrences (removes all)', () => {
      expect(cleanDocsUrl('https://grafana.com/unstyled.html/foo/unstyled.html')).toBe(
        'https://grafana.com/unstyled.html/foo'
      );
    });
  });
});
