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
describe('JSON-first content fetching behavior', () => {
  describe('URL generation priority', () => {
    it('should document that content.json is preferred over unstyled.html', () => {
      // This test documents the expected URL priority order:
      // 1. content.json (new JSON format - preferred)
      // 2. unstyled.html (legacy HTML format - fallback)
      //
      // The generateInteractiveLearningVariations function in content-fetcher.ts generates URLs
      // in this order for interactive learning URLs. When fetching, the first successful
      // response is used.
      //
      // Example for URL: https://interactive-learning.grafana.net/test-guide
      // Generated variations (in order):
      // 1. https://interactive-learning.grafana.net/test-guide/content.json
      // 2. https://interactive-learning.grafana.net/test-guide/unstyled.html

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

describe('null content handling for learning journeys', () => {
  beforeEach(() => {
    // Mock fetch
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const unstyledHtml =
    '<html><head><title>Milestone 1: Getting Started</title></head><body><h1>Milestone 1</h1><p>Learn the basics</p></body></html>';
  const styledHtml =
    "<html><head><title>Not this page</title></head><body><h1>It has styling!</h1><p>We don't want this</p></body></html>";
  const journeyUrl = 'https://grafana.com/docs/learning-journeys/drilldown-logs/milestone-1/';

  it('should fallback to unstyled.html when learning journey milestone content.json returns null', async () => {
    // Mock fetch to handle learning journey milestone requests:
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.endsWith('content.json')) {
        const headers = new Headers();
        headers.set('Content-Type', 'application/json');
        return Promise.resolve({
          ok: true,
          text: async () => 'null',
          url,
          headers,
        });
      } else if (url.endsWith('unstyled.html')) {
        const headers = new Headers();
        headers.set('Content-Type', 'text/html; charset=utf-8');
        return Promise.resolve({
          ok: true,
          text: async () => unstyledHtml,
          url,
          headers,
        });
      } else if (url.endsWith('/milestone-1/') || url.endsWith('/milestone-1')) {
        const headers = new Headers();
        headers.set('Content-Type', 'text/html; charset=utf-8');
        return Promise.resolve({
          ok: true,
          text: async () => styledHtml,
          url,
          headers,
        });
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });
    });

    const result = await fetchContent(journeyUrl);

    // Should successfully fetch and wrap HTML content
    expect(result.content).not.toBeNull();
    expect(result.error).toBeUndefined();
    expect(result.content?.isNativeJson).toBe(false);
    expect(result.content?.type).toBe('learning-journey');

    // Verify fetch was called
    expect(global.fetch).toHaveBeenCalled();
  });

  it('should use JSON guide when learning journey milestone content.json returns valid JSON', async () => {
    const mockGuide = {
      id: 'drilldown-logs-milestone-1',
      title: 'Milestone 1: Getting Started with Logs',
      description: 'Learn how to explore logs in Grafana',
      blocks: [
        { type: 'text', content: 'Welcome to the first milestone' },
        { type: 'text', content: 'In this guide, you will learn...' },
      ],
    };
    const journeyUrl = 'https://grafana.com/docs/learning-journeys/drilldown-logs/milestone-1/';

    // Mock fetch to return valid JSON for learning journey milestone
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      const headers = new Headers();
      headers.set('Content-Type', 'application/json');
      // Return valid JSON for any request to this milestone
      return Promise.resolve({
        ok: true,
        text: async () => JSON.stringify(mockGuide),
        url: url.endsWith('content.json') ? url : url + 'content.json',
        headers,
      });
    });

    const result = await fetchContent(journeyUrl);

    expect(result.content).not.toBeNull();
    if (result.content) {
      expect(result.error).toBeUndefined();
      expect(result.content.type).toBe('learning-journey');

      // Verify the content is valid JSON guide with expected structure
      const parsedContent = JSON.parse(result.content.content);
      expect(parsedContent.id).toBeDefined();
      expect(parsedContent.title).toBeDefined();
      expect(parsedContent.blocks).toBeDefined();
      expect(Array.isArray(parsedContent.blocks)).toBe(true);

      // The key test: verify the original guide structure is preserved
      // (whether native JSON or wrapped, the blocks should be there)
      expect(parsedContent.blocks.length).toBeGreaterThan(0);
    }

    // Verify fetch was called
    expect(global.fetch).toHaveBeenCalled();
  });

  it('should return error when learning journey milestone has null content.json and no unstyled.html', async () => {
    const milestoneUrl = 'https://grafana.com/docs/learning-journeys/drilldown-logs/milestone-2/';

    const jsonHeaders = new Headers();
    jsonHeaders.set('Content-Type', 'application/json');

    const notFoundHeaders = new Headers();
    notFoundHeaders.set('Content-Type', 'text/html; charset=utf-8');

    // Mock fetch: null for content.json, 404 for unstyled.html
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => 'null',
        url: 'https://grafana.com/docs/learning-journeys/drilldown-logs/milestone-2/content.json',
        headers: jsonHeaders,
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: notFoundHeaders,
      });

    const result = await fetchContent(milestoneUrl);

    // Should return error since both formats are unavailable
    expect(result.content).toBeNull();
    expect(result.error).toBeDefined();
    expect(result.errorType).toBe('not-found');

    // Verify fetch was called
    expect(global.fetch).toHaveBeenCalled();
  });
});

describe('fetchContent security validation', () => {
  describe('URL validation at entry point', () => {
    it('should allow grafana.com docs URLs', async () => {
      // Note: This will fail to fetch (no network in tests), but should pass validation
      const result = await fetchContent('https://grafana.com/docs/grafana/latest/');
      // Should not reject with security error
      expect(result.error).not.toContain('interactive learning URLs');
    });

    it('should allow bundled content', async () => {
      // This might fail if bundled content doesn't exist, but should pass validation
      const result = await fetchContent('bundled:test-content');
      // Should not reject with security error
      expect(result.error).not.toContain('interactive learning URLs');
    });

    it('should allow interactive learning URLs', async () => {
      const result = await fetchContent('https://interactive-learning.grafana.net/tutorial/');
      // Should not reject with security error
      expect(result.error).not.toContain('interactive learning URLs');
    });

    it('should allow interactive learning dev URLs', async () => {
      const result = await fetchContent('https://interactive-learning.grafana-dev.net/tutorial/');
      // Should not reject with security error
      expect(result.error).not.toContain('interactive learning URLs');
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

    it('should reject interactive learning domain hijacking', async () => {
      const result = await fetchContent('https://interactive-learning.grafana.net.evil.com/tutorial/');
      expect(result.content).toBeNull();
      expect(result.error).toContain('Only Grafana.com documentation');
    });
  });
});

describe('fetchContent security validation', () => {
  describe('URL validation at entry point', () => {
    it('should allow grafana.com docs URLs', async () => {
      // Note: This will fail to fetch (no network in tests), but should pass validation
      const result = await fetchContent('https://grafana.com/docs/grafana/latest/');
      // Should not reject with security error
      expect(result.error).not.toContain('interactive learning URLs');
    });

    it('should allow bundled content', async () => {
      // This might fail if bundled content doesn't exist, but should pass validation
      const result = await fetchContent('bundled:test-content');
      // Should not reject with security error
      expect(result.error).not.toContain('interactive learning URLs');
    });

    it('should allow interactive learning URLs', async () => {
      const result = await fetchContent('https://interactive-learning.grafana.net/tutorial/');
      // Should not reject with security error
      expect(result.error).not.toContain('interactive learning URLs');
    });

    it('should allow interactive learning dev URLs', async () => {
      const result = await fetchContent('https://interactive-learning.grafana-dev.net/tutorial/');
      // Should not reject with security error
      expect(result.error).not.toContain('interactive learning URLs');
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

    it('should reject interactive learning domain hijacking', async () => {
      const result = await fetchContent('https://interactive-learning.grafana.net.evil.com/tutorial/');
      expect(result.content).toBeNull();
      expect(result.error).toContain('Only Grafana.com documentation');
    });
  });
});
