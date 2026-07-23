/**
 * Tests for content fetcher security validation and JSON-first fetching
 */
import { fetchContent, simpleMarkdownToHtml } from './content-fetcher';

const mockRecordContentFetch = jest.fn();
const mockRecordContentFetchFallback = jest.fn();
jest.mock('../lib/telemetry', () => ({
  ...jest.requireActual('../lib/telemetry'),
  recordContentFetch: (...args: unknown[]) => mockRecordContentFetch(...args),
  recordContentFetchFallback: (...args: unknown[]) => mockRecordContentFetchFallback(...args),
}));

// Mock AbortSignal.timeout for Node environments that don't support it
if (!AbortSignal.timeout) {
  (AbortSignal as any).timeout = jest.fn((ms: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  });
}

// JSON-first content fetching — tripwire for the content.json → unstyled.html
// fallback ladder. These pin the candidate ORDER and the null-signal fallthrough
// so the PR 7 consolidation (isolating the ladder into one strategy fn) is proven
// behavior-preserving. Replaces the prior `expect(true).toBe(true)` doc-tests.
describe('content.json → unstyled.html ladder', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const journeyUrl = 'https://grafana.com/docs/learning-paths/drilldown-logs/milestone-1/';
  const validGuide = {
    id: 'drilldown-logs-milestone-1',
    title: 'Milestone 1',
    blocks: [{ type: 'markdown', content: 'Hello' }],
  };

  // Records the order in which content URLs are requested.
  const installFetch = (handlers: Record<'page' | 'json' | 'html', () => unknown>): string[] => {
    const order: string[] = [];
    const htmlHeaders = new Headers();
    htmlHeaders.set('Content-Type', 'text/html; charset=utf-8');
    const jsonHeaders = new Headers();
    jsonHeaders.set('Content-Type', 'application/json');
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.endsWith('content.json')) {
        order.push('content.json');
        return Promise.resolve({ ok: true, text: async () => handlers.json(), url, headers: jsonHeaders });
      }
      if (url.endsWith('unstyled.html')) {
        order.push('unstyled.html');
        return Promise.resolve({ ok: true, text: async () => handlers.html(), url, headers: htmlHeaders });
      }
      order.push('page');
      return Promise.resolve({ ok: true, text: async () => handlers.page(), url, headers: htmlHeaders });
    });
    return order;
  };

  it('requests content.json before unstyled.html for learning-path URLs', async () => {
    const order = installFetch({
      page: () => '<html><body>styled</body></html>',
      json: () => 'null',
      html: () => '<html><head><title>M1</title></head><body>unstyled</body></html>',
    });

    await fetchContent(journeyUrl);

    const jsonIdx = order.indexOf('content.json');
    const htmlIdx = order.indexOf('unstyled.html');
    expect(jsonIdx).toBeGreaterThanOrEqual(0);
    expect(htmlIdx).toBeGreaterThanOrEqual(0);
    expect(jsonIdx).toBeLessThan(htmlIdx);

    expect(mockRecordContentFetchFallback).toHaveBeenCalledWith({
      url: journeyUrl,
      tierUsed: 'unstyled-html',
      errorType: 'content-json-unavailable',
    });
    expect(mockRecordContentFetch).toHaveBeenCalledWith({
      url: journeyUrl,
      tier: 'unstyled-html',
      durationMs: expect.any(Number),
      outcome: 'ok',
    });
  });

  it('uses content.json directly and never fetches unstyled.html when it returns a valid guide', async () => {
    const order = installFetch({
      page: () => '<html><body></body></html>',
      json: () => JSON.stringify(validGuide),
      html: () => '<html><body>should not be used</body></html>',
    });

    const result = await fetchContent(journeyUrl);

    expect(result.content?.isNativeJson).toBe(true);
    expect(order).not.toContain('unstyled.html');
    expect(mockRecordContentFetchFallback).not.toHaveBeenCalled();
    expect(mockRecordContentFetch).toHaveBeenCalledWith({
      url: journeyUrl,
      tier: 'content-json',
      durationMs: expect.any(Number),
      outcome: 'ok',
    });
  });

  it('falls through to unstyled.html when content.json returns the null signal', async () => {
    installFetch({
      page: () => '<html><body>styled</body></html>',
      json: () => 'null',
      html: () => '<html><head><title>M1</title></head><body>unstyled</body></html>',
    });

    const result = await fetchContent(journeyUrl);

    expect(result.content).not.toBeNull();
    expect(result.content?.isNativeJson).toBe(false);
  });

  it('does not fetch journey metadata after a null fallback when metadata is skipped', async () => {
    installFetch({
      page: () => '<html><body>styled</body></html>',
      json: () => 'null',
      html: () => '<html><head><title>M1</title></head><body>unstyled</body></html>',
    });

    await fetchContent(`${journeyUrl}content.json`, { skipJourneyMetadata: true });

    const fetchedUrls = (global.fetch as jest.Mock).mock.calls.map(([url]) => url as string);
    expect(fetchedUrls.some((url) => url.endsWith('/index.json'))).toBe(false);
  });

  it('skips content.json for regular docs pages that do not support it', async () => {
    const order = installFetch({
      page: () => '<html><body>styled</body></html>',
      json: () => 'null',
      html: () => '<html><head><title>Docs</title></head><body>unstyled</body></html>',
    });

    await fetchContent('https://grafana.com/docs/grafana/latest/panels/');

    expect(order).not.toContain('content.json');
    expect(order).toContain('unstyled.html');
  });

  // Generic interactive-learning URLs (matched by hostname, not by the
  // /tutorials/ or /milestone-N/ path patterns determineContentType looks
  // for) go through the same content.json ladder via a separate branch in
  // fetchRawHtml — the fallback telemetry must cover them too.
  it('records a content-fetch fallback for generic interactive-learning URLs when content.json is unavailable', async () => {
    const genericUrl = 'https://interactive-learning.grafana.net/guide/getting-started';
    const htmlHeaders = new Headers();
    htmlHeaders.set('Content-Type', 'text/html; charset=utf-8');

    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.endsWith('content.json')) {
        return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' });
      }
      if (url.endsWith('unstyled.html')) {
        return Promise.resolve({
          ok: true,
          text: async () => '<html><head><title>Guide</title></head><body>unstyled</body></html>',
          url,
          headers: htmlHeaders,
        });
      }
      return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' });
    });

    const result = await fetchContent(genericUrl);

    expect(result.content).not.toBeNull();
    expect(mockRecordContentFetchFallback).toHaveBeenCalledWith({
      url: genericUrl,
      tierUsed: 'unstyled-html',
      errorType: 'content-json-unavailable',
    });
  });

  it('records a terminal content-fetch fallback for generic interactive-learning URLs when both tiers fail', async () => {
    const genericUrl = 'https://interactive-learning.grafana.net/guide/missing';
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' });

    const result = await fetchContent(genericUrl);

    expect(result.content).toBeNull();
    expect(mockRecordContentFetchFallback).toHaveBeenCalledWith({
      url: genericUrl,
      tierUsed: 'unstyled-html',
      errorType: 'not-found',
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
  const journeyUrl = 'https://grafana.com/docs/learning-paths/drilldown-logs/milestone-1/';

  it('should fallback to unstyled.html when learning journey milestone content.json returns null', async () => {
    // Mock fetch to handle learning journey milestone requests:
    // This simulates the actual flow:
    // 1. Base URL is fetched - returns styled HTML (but code will try content.json first)
    // 2. content.json is fetched - returns null (server signal to use HTML)
    // 3. unstyled.html is fetched - returns the actual content
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
        // Base URL - returns styled HTML
        // (In reality, the fetchRawHtml function will try content.json first before falling back)
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
      blocks: [
        { type: 'markdown', content: 'Welcome to the first milestone.' },
        { type: 'markdown', content: 'In this guide, you will learn...' },
      ],
    };
    const journeyUrl = 'https://grafana.com/docs/learning-paths/drilldown-logs/milestone-1/';

    const jsonHeaders = new Headers();
    jsonHeaders.set('Content-Type', 'application/json');
    const htmlHeaders = new Headers();
    htmlHeaders.set('Content-Type', 'text/html');
    const notFoundHeaders = new Headers();
    notFoundHeaders.set('Content-Type', 'text/html');

    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.endsWith('content.json')) {
        return Promise.resolve({
          ok: true,
          text: async () => JSON.stringify(mockGuide),
          url,
          headers: jsonHeaders,
        });
      }
      if (url.endsWith('/milestone-1/') || url.endsWith('/milestone-1')) {
        return Promise.resolve({
          ok: true,
          text: async () => '<html><body></body></html>',
          url,
          headers: htmlHeaders,
        });
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        url,
        headers: notFoundHeaders,
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

      // Verify metadata.title is taken from the JSON guide title, not defaulting to 'Documentation'
      expect(result.content.metadata.title).toBe('Milestone 1: Getting Started with Logs');
    }

    // Verify fetch was called
    expect(global.fetch).toHaveBeenCalled();
  });

  it('should return error when learning journey milestone has null content.json and no unstyled.html', async () => {
    const milestoneUrl = 'https://grafana.com/docs/learning-paths/drilldown-logs/milestone-2/';

    const jsonHeaders = new Headers();
    jsonHeaders.set('Content-Type', 'application/json');

    const notFoundHeaders = new Headers();
    notFoundHeaders.set('Content-Type', 'text/html; charset=utf-8');

    // Mock fetch: null for content.json, 404 for unstyled.html
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => 'null',
        url: 'https://grafana.com/docs/learning-paths/drilldown-logs/milestone-2/content.json',
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

  it('classifies terminal ladder failure (both content.json and unstyled.html fail) instead of tier: other', async () => {
    jest.clearAllMocks();
    const milestoneUrl = 'https://grafana.com/docs/learning-paths/drilldown-logs/milestone-3/';

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: new Headers(),
    });

    const result = await fetchContent(milestoneUrl);

    expect(result.content).toBeNull();
    expect(mockRecordContentFetchFallback).toHaveBeenCalledWith({
      url: milestoneUrl,
      tierUsed: 'unstyled-html',
      errorType: 'not-found',
    });
    expect(mockRecordContentFetch).toHaveBeenCalledWith({
      url: milestoneUrl,
      tier: 'unstyled-html',
      durationMs: expect.any(Number),
      outcome: 'error',
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

// ---------------------------------------------------------------------------
// simpleMarkdownToHtml / inlineMarkdown — covers the double-encoding fix
// ---------------------------------------------------------------------------

describe('simpleMarkdownToHtml', () => {
  it('converts a plain paragraph', () => {
    expect(simpleMarkdownToHtml('Hello world')).toBe('<p>Hello world</p>');
  });

  it('converts headings', () => {
    expect(simpleMarkdownToHtml('## Heading')).toBe('<h2>Heading</h2>');
  });

  it('converts unordered list items', () => {
    const md = '- Item 1\n- Item 2';
    expect(simpleMarkdownToHtml(md)).toBe('<ul>\n<li>Item 1</li>\n<li>Item 2</li>\n</ul>');
  });

  it('converts markdown links to anchor tags', () => {
    const md = 'Visit [Grafana](https://grafana.com) for more info.';
    expect(simpleMarkdownToHtml(md)).toBe('<p>Visit <a href="https://grafana.com">Grafana</a> for more info.</p>');
  });

  it('does not double-encode ampersands in link hrefs', () => {
    const md = 'See [docs](https://example.com/page?a=1&b=2) here.';
    const html = simpleMarkdownToHtml(md);
    expect(html).toContain('href="https://example.com/page?a=1&amp;b=2"');
    expect(html).not.toContain('&amp;amp;');
  });

  it('does not double-encode ampersands in hrefs with multiple query params', () => {
    const md = '[link](https://example.com?x=1&y=2&z=3)';
    const html = simpleMarkdownToHtml(md);
    expect(html).toContain('href="https://example.com?x=1&amp;y=2&amp;z=3"');
    expect(html).not.toContain('&amp;amp;');
  });

  it('escapes HTML entities in plain text', () => {
    const md = 'Use <b> tags & "quotes" carefully.';
    const html = simpleMarkdownToHtml(md);
    expect(html).toContain('&lt;b&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
    expect(html).not.toContain('<b>');
  });

  it('escapes HTML entities in link labels', () => {
    const md = '[<script>alert(1)</script>](https://safe.com)';
    const html = simpleMarkdownToHtml(md);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('strips javascript: URLs from links', () => {
    const md = '[click](javascript:alert(1))';
    const html = simpleMarkdownToHtml(md);
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<a');
    expect(html).toContain('click');
  });
});

describe('fetchContent records a failed pathfinder_content_fetch measurement on every early-exit path', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('records outcome error for an invalid URL', async () => {
    await fetchContent('');
    expect(mockRecordContentFetch).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'error' }));
  });

  it('records outcome error for an untrusted source', async () => {
    await fetchContent('https://evil.com/docs/malicious/');
    expect(mockRecordContentFetch).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'error' }));
  });
});
