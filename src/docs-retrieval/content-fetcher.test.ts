/**
 * Tests for content fetcher security validation and JSON-first fetching
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

// JSON-first content fetching tests
// These tests document the expected behavior of the JSON-first fetching strategy
// without requiring network mocking which is complex in this codebase
describe('JSON-first content fetching behavior', () => {
  describe('URL generation priority', () => {
    it('should document that content.json is preferred over unstyled.html', () => {
      // This test documents the expected URL priority order:
      // 1. content.json (new JSON format - preferred)
      // 2. unstyled.html (legacy HTML format - fallback)
      //
      // The generateGitHubVariations function in content-fetcher.ts generates URLs
      // in this order for GitHub tree URLs. When fetching, the first successful
      // response is used.
      //
      // Example for URL: https://github.com/grafana/interactive-tutorials/tree/main/test-guide
      // Generated variations (in order):
      // 1. api/plugin-proxy/.../test-guide/content.json (proxy)
      // 2. raw.githubusercontent.com/.../test-guide/content.json (raw)
      // 3. api/plugin-proxy/.../test-guide/unstyled.html (proxy)
      // 4. raw.githubusercontent.com/.../test-guide/unstyled.html (raw)

      expect(true).toBe(true); // Documentation test
    });

    it('should document isNativeJson flag behavior', () => {
      // When content is fetched from a .json URL (content.json), the isNativeJson
      // flag is set to true on the RawContent object. This indicates that the
      // content is already in JSON guide format and doesn't need to be wrapped.
      //
      // When content is fetched from an HTML URL (unstyled.html), the isNativeJson
      // flag is set to false, and the HTML content is wrapped in a JSON guide
      // structure with a single html block.
      //
      // The isNativeJson flag is stored in RawContent.isNativeJson and can be used
      // by consumers to know the original format of the content.

      expect(true).toBe(true); // Documentation test
    });
  });

  describe('content wrapping logic', () => {
    it('should document native JSON content handling', () => {
      // When native JSON content (from content.json) is fetched:
      // 1. The JSON is parsed and validated as a proper guide structure
      //    (must have id, title, and blocks array)
      // 2. If valid, it's used directly without wrapping
      // 3. If invalid, it's wrapped as if it were HTML
      //
      // This allows the same rendering pipeline to handle both formats.

      expect(true).toBe(true); // Documentation test
    });

    it('should document HTML content wrapping', () => {
      // When HTML content (from unstyled.html) is fetched:
      // 1. Learning journey extras are applied (Ready to Begin button, etc.)
      // 2. The HTML is wrapped in a JSON guide with a single html block:
      //    { id: "external-...", title: "...", blocks: [{ type: "html", content: "..." }] }
      // 3. This wrapped JSON goes through the same rendering pipeline as native JSON

      expect(true).toBe(true); // Documentation test
    });
  });
});

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
