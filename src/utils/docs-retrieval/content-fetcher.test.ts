/**
 * Tests for content fetcher security validation
 */
import { fetchContent } from './content-fetcher';

// Mock AbortSignal.timeout for Node environments that don't support it
if (!AbortSignal.timeout) {
  (AbortSignal as any).timeout = jest.fn((ms: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  });
}

describe('fetchContent security validation', () => {
  describe('URL validation at entry point', () => {
    it('should allow grafana.com docs URLs', async () => {
      // Note: This will fail to fetch (no network in tests), but should pass validation
      const result = await fetchContent('https://grafana.com/docs/grafana/latest/');
      // Should not reject with security error
      expect(result.error).not.toContain('approved GitHub repositories');
    });

    it('should allow bundled content', async () => {
      // This might fail if bundled content doesn't exist, but should pass validation
      const result = await fetchContent('bundled:test-content');
      // Should not reject with security error
      expect(result.error).not.toContain('approved GitHub repositories');
    });

    it('should reject non-grafana.com URLs', async () => {
      const result = await fetchContent('https://evil.com/docs/malicious/');
      expect(result.content).toBeNull();
      expect(result.error).toContain('Only Grafana.com documentation');
      expect(result.errorType).toBe('other');
    });

    it('should reject domain hijacking attempts', async () => {
      const result = await fetchContent('https://grafana.com.evil.com/docs/');
      expect(result.content).toBeNull();
      expect(result.error).toContain('Only Grafana.com documentation');
    });

    it('should reject URLs with docs-like paths but wrong domain', async () => {
      const result = await fetchContent('https://example.com/tutorials/evil-tutorial/');
      expect(result.content).toBeNull();
      expect(result.error).toContain('Only Grafana.com documentation');
    });

    it('should allow grafana/interactive-tutorials GitHub URLs', async () => {
      const result = await fetchContent(
        'https://raw.githubusercontent.com/grafana/interactive-tutorials/main/test.html'
      );
      // Should not reject with security error
      expect(result.error).not.toContain('Only Grafana.com documentation');
    });

    it('should reject non-approved GitHub repos', async () => {
      const result = await fetchContent('https://raw.githubusercontent.com/evil-user/malicious-repo/main/test.html');
      expect(result.content).toBeNull();
      expect(result.error).toContain('Only Grafana.com documentation');
    });
  });
});
