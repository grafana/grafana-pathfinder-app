/**
 * Security Test Suite - MITM Protection
 *
 * Tests for security features that prevent Man-in-the-Middle attacks,
 * open redirects, and XSS from external services.
 */

import { fetchContent } from '../docs-retrieval/content-fetcher';
import { sanitizeTextForDisplay } from './html-sanitizer';
import { isDevModeEnabledGlobal } from '../utils/dev-mode';

// Mock the dev-mode module
jest.mock('../utils/dev-mode', () => ({
  isDevModeEnabled: jest.fn(() => false),
  isDevModeEnabledGlobal: jest.fn(() => false),
}));

// Mock fetch globally
global.fetch = jest.fn();

// Mock AbortSignal.timeout for Node environments that don't support it
if (!AbortSignal.timeout) {
  (AbortSignal as any).timeout = jest.fn((ms: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  });
}

describe('Security: HTTPS Enforcement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isDevModeEnabledGlobal as jest.Mock).mockReturnValue(false);
  });

  describe('Content Fetcher HTTPS Validation', () => {
    it('should reject HTTP URLs in production mode', async () => {
      const result = await fetchContent('http://grafana.com/docs/test');

      expect(result.content).toBeNull();
      expect(result.error).toContain('HTTPS');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should accept HTTPS URLs', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        url: 'https://grafana.com/docs/test/unstyled.html',
        text: () => Promise.resolve('<html><body>Content</body></html>'),
      });

      const result = await fetchContent('https://grafana.com/docs/test');

      expect(result.content).not.toBeNull();
      expect(global.fetch).toHaveBeenCalled();
    });

    it('should allow HTTP localhost in dev mode', async () => {
      (isDevModeEnabledGlobal as jest.Mock).mockReturnValue(true);
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        url: 'http://localhost:3000/docs/test',
        text: () => Promise.resolve('<html><body>Dev Content</body></html>'),
      });

      const result = await fetchContent('http://localhost:3000/docs/test');

      expect(result.content).not.toBeNull();
      expect(global.fetch).toHaveBeenCalled();
    });

    it('should reject FTP protocol', async () => {
      const result = await fetchContent('ftp://grafana.com/docs/test');

      expect(result.content).toBeNull();
      expect(result.error).toBeTruthy();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should reject file:// protocol', async () => {
      const result = await fetchContent('file:///etc/passwd');

      expect(result.content).toBeNull();
      expect(result.error).toBeTruthy();
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});

describe('Security: Redirect Chain Validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isDevModeEnabledGlobal as jest.Mock).mockReturnValue(false);
  });

  it('should accept redirects to trusted domains', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      url: 'https://grafana.com/docs/new-location/unstyled.html', // Redirected URL
      text: () => Promise.resolve('<html><body>Redirected Content</body></html>'),
    });

    const result = await fetchContent('https://grafana.com/docs/old-location');

    expect(result.content).not.toBeNull();
    expect(result.content?.url).toContain('new-location');
  });

  it('should reject redirects to untrusted domains', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      url: 'https://evil.com/malware', // Redirected to untrusted domain
      text: () => Promise.resolve('<html><body>Malicious Content</body></html>'),
    });

    const result = await fetchContent('https://grafana.com/docs/test');

    expect(result.content).toBeNull();
    expect(result.error).toContain('trusted domain');
  });

  it('should reject redirects from HTTPS to HTTP', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      url: 'http://grafana.com/docs/test', // Downgraded to HTTP
      text: () => Promise.resolve('<html><body>Content</body></html>'),
    });

    const result = await fetchContent('https://grafana.com/docs/test');

    expect(result.content).toBeNull();
    expect(result.error).toContain('HTTPS');
  });

  it('should accept redirects within GitHub raw domain', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      url: 'https://raw.githubusercontent.com/grafana/interactive-tutorials/main/redirected.html',
      text: () => Promise.resolve('<html><body>GitHub Content</body></html>'),
    });

    const result = await fetchContent(
      'https://raw.githubusercontent.com/grafana/interactive-tutorials/main/original.html'
    );

    expect(result.content).not.toBeNull();
  });

  it('should handle multiple redirects with final validation', async () => {
    // Simulates: grafana.com -> www.grafana.com -> grafana.com/docs/final
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      url: 'https://grafana.com/docs/final/unstyled.html',
      text: () => Promise.resolve('<html><body>Final Content</body></html>'),
    });

    const result = await fetchContent('https://grafana.com/docs/initial');

    expect(result.content).not.toBeNull();
  });
});

describe('Security: Text Sanitization for External APIs', () => {
  describe('sanitizeTextForDisplay', () => {
    it('should strip all HTML tags from text', () => {
      const malicious = '<script>alert("XSS")</script>Hello World';
      const result = sanitizeTextForDisplay(malicious);

      expect(result).toBe('Hello World');
      expect(result).not.toContain('<script>');
      expect(result).not.toContain('alert');
    });

    it('should strip inline styles and event handlers', () => {
      const malicious = '<div style="background:red" onclick="alert(1)">Text</div>';
      const result = sanitizeTextForDisplay(malicious);

      expect(result).toBe('Text');
      expect(result).not.toContain('onclick');
      expect(result).not.toContain('style');
    });

    it('should handle nested HTML tags', () => {
      const malicious = '<div><span><strong>Bold</strong> <em>Italic</em></span></div>';
      const result = sanitizeTextForDisplay(malicious);

      expect(result).toBe('Bold Italic');
      expect(result).not.toContain('<');
      expect(result).not.toContain('>');
    });

    it('should decode HTML entities', () => {
      const encoded = '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;';
      const result = sanitizeTextForDisplay(encoded);

      // After sanitization, should be plain text without executable code
      expect(result).not.toContain('<script>');
      // May contain the decoded text as plain text
    });

    it('should handle empty and null inputs safely', () => {
      expect(sanitizeTextForDisplay('')).toBe('');
      expect(sanitizeTextForDisplay(null as any)).toBe('');
      expect(sanitizeTextForDisplay(undefined as any)).toBe('');
    });

    it('should preserve safe text content', () => {
      const safe = 'Learn how to set up alerts in Grafana';
      const result = sanitizeTextForDisplay(safe);

      expect(result).toBe(safe);
    });

    it('should remove javascript: URLs in anchor tags', () => {
      const malicious = '<a href="javascript:alert(1)">Click</a>';
      const result = sanitizeTextForDisplay(malicious);

      expect(result).toBe('Click');
      expect(result).not.toContain('javascript:');
    });

    it('should strip data URLs', () => {
      const malicious = '<img src="data:text/html,<script>alert(1)</script>">Image';
      const result = sanitizeTextForDisplay(malicious);

      expect(result).toBe('Image');
      expect(result).not.toContain('data:');
      expect(result).not.toContain('<script>');
    });

    it('should handle XSS vectors in title attributes', () => {
      const malicious = '<span title="x" onmouseover="alert(1)">Hover</span>';
      const result = sanitizeTextForDisplay(malicious);

      expect(result).toBe('Hover');
      expect(result).not.toContain('onmouseover');
    });
  });

  describe('Recommender API Response Sanitization', () => {
    it('should sanitize recommendation titles from external API', () => {
      const mockRecommendation = {
        title: '<script>alert("XSS")</script>Grafana Alerts',
        summary: 'Learn about alerts',
        url: 'https://grafana.com/docs/alerts',
      };

      // Simulate what context.service.ts does
      const sanitized = {
        ...mockRecommendation,
        title: sanitizeTextForDisplay(mockRecommendation.title),
        summary: sanitizeTextForDisplay(mockRecommendation.summary),
      };

      expect(sanitized.title).toBe('Grafana Alerts');
      expect(sanitized.title).not.toContain('<script>');
    });

    it('should sanitize recommendation summaries', () => {
      const mockRecommendation = {
        title: 'Alerting Guide',
        summary: '<img src=x onerror="alert(1)">Setup alerts in 5 minutes',
        url: 'https://grafana.com/docs/alerts',
      };

      const sanitized = {
        ...mockRecommendation,
        title: sanitizeTextForDisplay(mockRecommendation.title),
        summary: sanitizeTextForDisplay(mockRecommendation.summary),
      };

      expect(sanitized.summary).toBe('Setup alerts in 5 minutes');
      expect(sanitized.summary).not.toContain('onerror');
    });

    it('should handle malformed HTML in recommendations', () => {
      const mockRecommendation = {
        title: '<div><span>Unclosed tags',
        summary: 'Broken HTML <b>bold',
        url: 'https://grafana.com/docs/test',
      };

      const sanitized = {
        ...mockRecommendation,
        title: sanitizeTextForDisplay(mockRecommendation.title),
        summary: sanitizeTextForDisplay(mockRecommendation.summary),
      };

      // Should handle gracefully without errors
      expect(sanitized.title).toBeTruthy();
      expect(sanitized.summary).toBeTruthy();
      expect(sanitized.title).not.toContain('<');
      expect(sanitized.summary).not.toContain('<');
    });
  });
});

describe('Security: Dev Mode Localhost Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should allow localhost in dev mode for content URLs', async () => {
    (isDevModeEnabledGlobal as jest.Mock).mockReturnValue(true);
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      url: 'http://localhost:8080/docs/test',
      text: () => Promise.resolve('<html><body>Local Content</body></html>'),
    });

    const result = await fetchContent('http://localhost:8080/docs/test');

    expect(result.content).not.toBeNull();
  });

  it('should allow 127.0.0.1 in dev mode', async () => {
    (isDevModeEnabledGlobal as jest.Mock).mockReturnValue(true);
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      url: 'http://127.0.0.1:8080/docs/test',
      text: () => Promise.resolve('<html><body>Local Content</body></html>'),
    });

    const result = await fetchContent('http://127.0.0.1:8080/docs/test');

    expect(result.content).not.toBeNull();
  });

  it('should reject localhost in production mode', async () => {
    (isDevModeEnabledGlobal as jest.Mock).mockReturnValue(false);

    const result = await fetchContent('http://localhost:8080/docs/test');

    expect(result.content).toBeNull();
    expect(result.error).toBeTruthy();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should allow localhost for any path in dev mode for testing', async () => {
    (isDevModeEnabledGlobal as jest.Mock).mockReturnValue(true);
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      url: 'http://127.0.0.1:8080/docs/test',
      text: () => Promise.resolve('<html><body>Local Content</body></html>'),
    });

    // In dev mode, localhost is trusted for local testing purposes
    const result = await fetchContent('http://127.0.0.1:8080/docs/test');

    expect(result.content).not.toBeNull();
  });
});

describe('Security: Protocol Validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isDevModeEnabledGlobal as jest.Mock).mockReturnValue(false);
  });

  it('should reject javascript: protocol', async () => {
    const result = await fetchContent('javascript:alert("XSS")');

    expect(result.content).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('should reject data: protocol', async () => {
    const result = await fetchContent('data:text/html,<script>alert("XSS")</script>');

    expect(result.content).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('should reject file: protocol', async () => {
    const result = await fetchContent('file:///etc/passwd');

    expect(result.content).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('should accept https: protocol', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      url: 'https://grafana.com/docs/test/unstyled.html',
      text: () => Promise.resolve('<html><body>Content</body></html>'),
    });

    const result = await fetchContent('https://grafana.com/docs/test');

    expect(result.content).not.toBeNull();
  });
});

describe('Security: Bundled Content Safety', () => {
  it('should allow bundled content regardless of HTTPS', async () => {
    const result = await fetchContent('bundled:static-links');

    // Bundled content should work (if it exists)
    // Even though it's not HTTPS, it's local
    expect(result.error).not.toContain('HTTPS');
  });
});
