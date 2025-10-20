/**
 * Security Test Suite
 *
 * Ensures XSS prevention and URL validation security controls don't regress.
 * Based on security audit from meeting with Kristian Bremberg.
 */

import { sanitizeDocumentationHTML } from './docs-retrieval/html-sanitizer';
import { parseHTMLToComponents } from './docs-retrieval/html-parser';
import { parseUrlSafely, isGrafanaDocsUrl, isYouTubeDomain, isAllowedGitHubRawUrl } from './url-validator';

describe('Security: XSS Prevention with DOMPurify', () => {
  it('should strip script tags', () => {
    const malicious = '<div>Hello<script>alert("XSS")</script>World</div>';
    const result = sanitizeDocumentationHTML(malicious);

    expect(result).not.toContain('<script>');
    expect(result).not.toContain('alert(');
  });

  it('should strip event handlers', () => {
    const malicious = '<img src=x onerror="alert(\'XSS\')">';
    const result = sanitizeDocumentationHTML(malicious);

    expect(result).not.toContain('onerror');
    expect(result).not.toContain('alert(');
  });

  it('should strip javascript: URLs', () => {
    const malicious = '<a href="javascript:alert(\'XSS\')">Click</a>';
    const result = sanitizeDocumentationHTML(malicious);

    expect(result).not.toContain('javascript:');
  });

  it('should sandbox data: URLs in iframes', () => {
    const malicious = '<iframe src="data:text/html,<script>alert(\'XSS\')</script>"></iframe>';
    const result = sanitizeDocumentationHTML(malicious);

    // DOMPurify with ALLOW_UNKNOWN_PROTOCOLS preserves data: URLs
    // BUT our afterSanitizeAttributes hook adds sandbox="" which prevents script execution
    expect(result).toContain('sandbox=""'); // Most restrictive sandbox
    expect(result).toContain('referrerpolicy="no-referrer"');

    // Even though alert() might be in the src, it can't execute due to sandbox
  });

  it('should allow safe HTML with data attributes', () => {
    const safe = '<div class="interactive" data-targetaction="button" data-reftarget="Save">Click</div>';
    const result = sanitizeDocumentationHTML(safe);

    expect(result).toContain('data-targetaction');
    expect(result).toContain('data-reftarget');
    expect(result).toContain('class="interactive"');
  });

  it('should preserve complex CSS selectors in data attributes', () => {
    const complexSelector = '<span data-reftarget="div.text-xs:has(span:contains(\'Sort By\'))">Test</span>';
    const result = sanitizeDocumentationHTML(complexSelector);

    expect(result).toContain('data-reftarget');
    expect(result).toContain(':has(');
    expect(result).toContain(':contains(');
  });
});

describe('Security: URL Validation - Domain Hijacking Prevention', () => {
  describe('isGrafanaDocsUrl', () => {
    it('should accept valid Grafana docs URLs', () => {
      expect(isGrafanaDocsUrl('https://grafana.com/docs/grafana/latest/')).toBe(true);
      expect(isGrafanaDocsUrl('https://grafana.com/tutorials/alert-setup/')).toBe(true);
      expect(isGrafanaDocsUrl('https://grafana.com/docs/learning-journeys/linux/')).toBe(true);
    });

    it('should accept allowlisted Grafana subdomains', () => {
      expect(isGrafanaDocsUrl('https://www.grafana.com/docs/')).toBe(true);
    });

    it('should REJECT non-allowlisted subdomains', () => {
      expect(isGrafanaDocsUrl('https://docs.grafana.com/docs/')).toBe(false);
      expect(isGrafanaDocsUrl('https://evil.grafana.com/docs/')).toBe(false);
    });

    it('should REJECT domain hijacking attempts', () => {
      expect(isGrafanaDocsUrl('https://a-grafana.com/docs/')).toBe(false);
      expect(isGrafanaDocsUrl('https://grafana-com.evil.com/docs/')).toBe(false);
      expect(isGrafanaDocsUrl('https://grafana.com.evil.com/docs/')).toBe(false);
    });

    it('should REJECT path injection attempts', () => {
      expect(isGrafanaDocsUrl('https://evil.com/grafana.com/docs/')).toBe(false);
      expect(isGrafanaDocsUrl('https://evil.com/path/grafana.com/docs/')).toBe(false);
    });

    it('should REJECT non-docs paths on grafana.com', () => {
      expect(isGrafanaDocsUrl('https://grafana.com/pricing/')).toBe(false);
      expect(isGrafanaDocsUrl('https://grafana.com/blog/')).toBe(false);
    });

    it('should REJECT dangerous protocols', () => {
      expect(isGrafanaDocsUrl('javascript:alert("XSS")')).toBe(false);
      expect(isGrafanaDocsUrl('data:text/html,<script>alert("XSS")</script>')).toBe(false);
      expect(isGrafanaDocsUrl('file:///grafana.com/docs/')).toBe(false);
    });

    it('should handle invalid URLs gracefully', () => {
      expect(isGrafanaDocsUrl('not-a-url')).toBe(false);
      expect(isGrafanaDocsUrl('')).toBe(false);
      expect(isGrafanaDocsUrl(':::')).toBe(false);
    });
  });

  describe('isYouTubeDomain', () => {
    it('should accept valid YouTube domains', () => {
      expect(isYouTubeDomain('https://www.youtube.com/embed/abc123')).toBe(true);
      expect(isYouTubeDomain('https://youtube.com/watch?v=abc123')).toBe(true);
      expect(isYouTubeDomain('https://youtu.be/abc123')).toBe(true);
      expect(isYouTubeDomain('https://youtube-nocookie.com/embed/abc123')).toBe(true);
    });

    it('should REJECT YouTube domain hijacking', () => {
      expect(isYouTubeDomain('https://youtube.com.evil.com/embed/')).toBe(false);
      expect(isYouTubeDomain('https://a-youtube.com/embed/')).toBe(false);
      expect(isYouTubeDomain('https://evil.com/youtube.com/embed/')).toBe(false);
    });

    it('should REJECT dangerous protocols', () => {
      expect(isYouTubeDomain('javascript:youtube.com')).toBe(false);
      expect(isYouTubeDomain('data:text/html,youtube.com')).toBe(false);
    });
  });

  describe('isAllowedGitHubRawUrl', () => {
    const allowedPaths = ['/grafana/interactive-tutorials/'];

    it('should accept URLs from allowed repository', () => {
      const validUrl = 'https://raw.githubusercontent.com/grafana/interactive-tutorials/main/tutorial.html';
      expect(isAllowedGitHubRawUrl(validUrl, allowedPaths)).toBe(true);
    });

    it('should REJECT URLs from other repositories', () => {
      const otherRepo = 'https://raw.githubusercontent.com/evil/repo/main/tutorial.html';
      expect(isAllowedGitHubRawUrl(otherRepo, allowedPaths)).toBe(false);
    });

    it('should REJECT individual user repositories (meeting requirement)', () => {
      const userRepo1 = 'https://raw.githubusercontent.com/moxious/tutorials/main/test.html';
      const userRepo2 = 'https://raw.githubusercontent.com/Jayclifford345/tutorials/main/test.html';

      expect(isAllowedGitHubRawUrl(userRepo1, allowedPaths)).toBe(false);
      expect(isAllowedGitHubRawUrl(userRepo2, allowedPaths)).toBe(false);
    });

    it('should REJECT non-GitHub domains', () => {
      const nonGithub = 'https://evil.com/grafana/interactive-tutorials/main/test.html';
      expect(isAllowedGitHubRawUrl(nonGithub, allowedPaths)).toBe(false);
    });

    it('should require https protocol', () => {
      const httpUrl = 'http://raw.githubusercontent.com/grafana/interactive-tutorials/main/test.html';
      expect(isAllowedGitHubRawUrl(httpUrl, allowedPaths)).toBe(false);
    });
  });
});

describe('Security: Interactive Content Source Validation', () => {
  it('should accept interactive content from grafana.com', () => {
    const html = '<li class="interactive" data-targetaction="button" data-reftarget="Save">Click</li>';
    const baseUrl = 'https://grafana.com/docs/grafana/latest/';

    const result = parseHTMLToComponents(html, baseUrl);

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should accept interactive content from bundled sources', () => {
    const html = '<li class="interactive" data-targetaction="button" data-reftarget="Save">Click</li>';
    const baseUrl = 'bundled:prometheus-101';

    const result = parseHTMLToComponents(html, baseUrl);

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should accept interactive content from grafana/interactive-tutorials repo', () => {
    const html = '<li class="interactive" data-targetaction="button" data-reftarget="Save">Click</li>';
    const baseUrl = 'https://raw.githubusercontent.com/grafana/interactive-tutorials/main/test/unstyled.html';

    const result = parseHTMLToComponents(html, baseUrl);

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should REJECT interactive content from untrusted GitHub repos', () => {
    const html = '<li class="interactive" data-targetaction="button" data-reftarget="Save">Click</li>';
    const baseUrl = 'https://raw.githubusercontent.com/evil/malicious-tutorials/main/hack.html';

    const result = parseHTMLToComponents(html, baseUrl);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        type: 'html_sanitization',
        message: 'Interactive content from untrusted source rejected',
      })
    );
  });

  it('should REJECT interactive content from individual user repos (meeting requirement)', () => {
    const html = '<li class="interactive" data-targetaction="button" data-reftarget="Delete">Click</li>';

    // These were explicitly removed per meeting commitment
    const userRepo1 = 'https://raw.githubusercontent.com/moxious/tutorials/main/test.html';
    const userRepo2 = 'https://raw.githubusercontent.com/Jayclifford345/tutorials/main/test.html';

    const result1 = parseHTMLToComponents(html, userRepo1);
    const result2 = parseHTMLToComponents(html, userRepo2);

    expect(result1.isValid).toBe(false);
    expect(result2.isValid).toBe(false);
  });

  it('should REJECT interactive content from evil.com', () => {
    const html = '<li class="interactive" data-targetaction="navigate" data-reftarget="/admin/delete">Click</li>';
    const baseUrl = 'https://evil.com/grafana.com/docs/';

    const result = parseHTMLToComponents(html, baseUrl);

    expect(result.isValid).toBe(false);
  });

  it('should ALLOW interactive content from localhost in dev mode', () => {
    const html = '<li class="interactive" data-targetaction="button" data-reftarget="Test">Click</li>';
    const localhostUrls = [
      'http://localhost:5500/tutorial/unstyled.html',
      'http://127.0.0.1:8080/docs/test.html',
      'http://127.0.0.1/tutorial.html',
    ];

    // Reimport with mocked dev mode
    jest.isolateModules(() => {
      // Mock dev mode as enabled
      jest.doMock('./dev-mode', () => ({
        isDevModeEnabled: () => true,
        enableDevMode: jest.fn(),
        disableDevMode: jest.fn(),
        toggleDevMode: jest.fn(),
      }));

      const { parseHTMLToComponents: parseWithDevMode } = require('./docs-retrieval/html-parser');

      localhostUrls.forEach((url) => {
        const result = parseWithDevMode(html, url);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });
  });

  it('should ALLOW interactive content from any GitHub raw URL in dev mode', () => {
    const html = '<li class="interactive" data-targetaction="button" data-reftarget="Test">Click</li>';
    const personalRepoUrls = [
      'https://raw.githubusercontent.com/Jayclifford345/interactive-tutorials/main/test/unstyled.html',
      'https://raw.githubusercontent.com/moxious/tutorials/main/demo.html',
      'https://raw.githubusercontent.com/someuser/somerepo/branch/path/file.html',
    ];

    // Reimport with mocked dev mode
    jest.isolateModules(() => {
      // Mock dev mode as enabled
      jest.doMock('./dev-mode', () => ({
        isDevModeEnabled: () => true,
        enableDevMode: jest.fn(),
        disableDevMode: jest.fn(),
        toggleDevMode: jest.fn(),
      }));

      const { parseHTMLToComponents: parseWithDevMode } = require('./docs-retrieval/html-parser');

      personalRepoUrls.forEach((url) => {
        const result = parseWithDevMode(html, url);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });
  });

  it('should REJECT interactive content from localhost in production mode', () => {
    const html = '<li class="interactive" data-targetaction="button" data-reftarget="Test">Click</li>';
    const baseUrl = 'http://localhost:5500/tutorial/unstyled.html';

    // Dev mode is disabled by default in tests
    const result = parseHTMLToComponents(html, baseUrl);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        type: 'html_sanitization',
        message: 'Interactive content from untrusted source rejected',
      })
    );
  });

  it('should allow non-interactive content from any source (after DOMPurify)', () => {
    const html = '<p>This is regular content with <strong>formatting</strong></p>';
    const baseUrl = 'https://example.com/some-blog/';

    const result = parseHTMLToComponents(html, baseUrl);

    // Should succeed because there's no interactive content
    expect(result.isValid).toBe(true);
  });

  it('should allow testing mode bypass when explicitly enabled', () => {
    const html = '<li class="interactive" data-targetaction="button" data-reftarget="Test">Click</li>';
    const baseUrl = 'https://raw.githubusercontent.com/testuser/test-repo/main/test.html';

    // With bypass enabled (debug panel testing)
    const result = parseHTMLToComponents(html, baseUrl, true);

    expect(result.isValid).toBe(true);
  });
});

describe('Security: YouTube Iframe Validation', () => {
  it('should accept valid YouTube iframes after sanitization', () => {
    const iframe = '<iframe src="https://www.youtube.com/embed/abc123"></iframe>';
    const result = sanitizeDocumentationHTML(iframe);

    expect(result).toContain('<iframe');
    expect(result).toContain('youtube.com');
    expect(result).toContain('enablejsapi=1'); // Should be added automatically
    expect(result).toContain('referrerpolicy="no-referrer"');
  });

  it('should sandbox non-YouTube iframes', () => {
    const iframe = '<iframe src="https://example.com/embed/"></iframe>';
    const result = sanitizeDocumentationHTML(iframe);

    expect(result).toContain('<iframe');
    expect(result).toContain('sandbox=""'); // Most restrictive
    expect(result).toContain('referrerpolicy="no-referrer"');
  });

  it('should remove iframes without src', () => {
    const iframe = '<iframe></iframe>';
    const result = sanitizeDocumentationHTML(iframe);

    expect(result).not.toContain('<iframe');
  });

  it('should strip srcdoc attribute (XSS vector)', () => {
    const iframe = '<iframe srcdoc="<script>alert(\'XSS\')</script>"></iframe>';
    const result = sanitizeDocumentationHTML(iframe);

    expect(result).not.toContain('srcdoc');
  });
});

describe('Security: URL Parsing (not string matching)', () => {
  it('should correctly parse valid URLs', () => {
    const url = parseUrlSafely('https://grafana.com/docs/grafana/');

    expect(url).not.toBeNull();
    expect(url?.hostname).toBe('grafana.com');
    expect(url?.protocol).toBe('https:');
    expect(url?.pathname).toBe('/docs/grafana/');
  });

  it('should return null for invalid URLs', () => {
    expect(parseUrlSafely('not-a-url')).toBeNull();
    expect(parseUrlSafely(':::')).toBeNull();
    expect(parseUrlSafely('')).toBeNull();
  });

  it('should handle URLs with special characters', () => {
    const url = parseUrlSafely('https://grafana.com/docs/path?query=value#fragment');

    expect(url?.hostname).toBe('grafana.com');
    expect(url?.search).toBe('?query=value');
    expect(url?.hash).toBe('#fragment');
  });
});

describe('Security: Meeting Compliance - GitHub Repository Restriction', () => {
  it('should ONLY allow grafana/interactive-tutorials repository', () => {
    const allowedPaths = ['/grafana/interactive-tutorials/'];

    // This should be the ONLY accepted GitHub repo
    const validUrl = 'https://raw.githubusercontent.com/grafana/interactive-tutorials/main/tutorial.html';
    expect(isAllowedGitHubRawUrl(validUrl, allowedPaths)).toBe(true);
  });

  it('should REJECT individual user repositories (meeting commitment)', () => {
    const allowedPaths = ['/grafana/interactive-tutorials/'];

    // These were explicitly removed per meeting commitment
    const moxiousRepo = 'https://raw.githubusercontent.com/moxious/tutorials/main/test.html';
    const jaycliffRepo = 'https://raw.githubusercontent.com/Jayclifford345/tutorials/main/test.html';

    expect(isAllowedGitHubRawUrl(moxiousRepo, allowedPaths)).toBe(false);
    expect(isAllowedGitHubRawUrl(jaycliffRepo, allowedPaths)).toBe(false);
  });

  it('should REJECT other grafana repositories', () => {
    const allowedPaths = ['/grafana/interactive-tutorials/'];

    // Even other grafana repos should be rejected
    const grafanaMain = 'https://raw.githubusercontent.com/grafana/grafana/main/README.md';
    const grafanaOther = 'https://raw.githubusercontent.com/grafana/other-repo/main/file.html';

    expect(isAllowedGitHubRawUrl(grafanaMain, allowedPaths)).toBe(false);
    expect(isAllowedGitHubRawUrl(grafanaOther, allowedPaths)).toBe(false);
  });
});

describe('Security: Attribute Preservation', () => {
  it('should preserve all interactive data attributes', () => {
    const html = `
      <li class="interactive" 
          data-targetaction="button" 
          data-reftarget="Save Dashboard"
          data-requirements="exists-reftarget,is-admin"
          data-objectives="has-dashboard-named:MyDashboard"
          data-hint="You need admin permissions"
          data-skippable="true">
        Save the dashboard
      </li>
    `;

    const result = sanitizeDocumentationHTML(html);

    expect(result).toContain('data-targetaction="button"');
    expect(result).toContain('data-reftarget');
    expect(result).toContain('data-requirements');
    expect(result).toContain('data-objectives');
    expect(result).toContain('data-hint');
    expect(result).toContain('data-skippable');
  });

  it('should preserve journey navigation attributes', () => {
    const html = '<button data-journey-start="true" data-milestone-url="/milestone-1/">Start</button>';
    const result = sanitizeDocumentationHTML(html);

    expect(result).toContain('data-journey-start');
    expect(result).toContain('data-milestone-url');
  });
});

describe('Security: Path Traversal Prevention (From Security Audit Screenshots)', () => {
  it('should reject path traversal attempts in URLs', () => {
    // These are the EXACT attacks from the security audit screenshots
    const traversalAttempts = [
      'https://grafana.com/docs/../A/../B/../C/',
      'https://grafana.com/docs/../../evil/',
      'https://grafana.com/docs/../../../etc/passwd',
      'https://grafana.com/../admin/delete',
    ];

    // Browser's URL parser normalizes these, so we validate the result
    traversalAttempts.forEach((url) => {
      const parsed = parseUrlSafely(url);
      // URL parser normalizes paths, but we should still validate
      // If path goes outside /docs/, it should be rejected
      if (parsed) {
        const isValid = isGrafanaDocsUrl(url);
        // Path traversal outside /docs/ should fail validation
        // URL('https://grafana.com/docs/../evil/').pathname === '/evil/' (normalized)
        if (
          !parsed.pathname.startsWith('/docs/') &&
          !parsed.pathname.startsWith('/tutorials/') &&
          !parsed.pathname.includes('/learning-journeys/')
        ) {
          expect(isValid).toBe(false);
        }
      }
    });
  });

  it('should handle normalized paths correctly', () => {
    // URL parser normalizes, so these become different paths
    const url1 = parseUrlSafely('https://grafana.com/docs/../admin/');
    const url2 = parseUrlSafely('https://grafana.com/admin/');

    // After normalization, both should have same pathname
    expect(url1?.pathname).toBe('/admin/');
    expect(url2?.pathname).toBe('/admin/');

    // Both should be rejected (not /docs/)
    expect(isGrafanaDocsUrl('https://grafana.com/docs/../admin/')).toBe(false);
    expect(isGrafanaDocsUrl('https://grafana.com/admin/')).toBe(false);
  });
});

describe('Security: Regression Prevention', () => {
  it('should maintain protection against script injection', () => {
    const attacks = [
      '<img src=x onerror=alert(1)>',
      '<svg onload=alert(1)>',
      '<body onload=alert(1)>',
      '<iframe src=javascript:alert(1)>',
      '<object data=javascript:alert(1)>',
      '<embed src=javascript:alert(1)>',
    ];

    attacks.forEach((attack) => {
      const result = sanitizeDocumentationHTML(attack);
      expect(result).not.toContain('alert(');
      expect(result).not.toContain('javascript:');
      expect(result).not.toContain('onerror');
      expect(result).not.toContain('onload');
    });
  });

  it('should maintain URL validation prevents domain spoofing (FROM AUDIT SCREENSHOTS)', () => {
    const spoofAttempts = [
      'https://grafana.com@evil.com/docs/',
      'https://grafana.com.evil.com/docs/',
      'https://evil.com/grafana.com/docs/',
      'https://a-grafana.com/docs/', // EXACT attack from screenshot
      'http://a-grafana.com/docs/security-update.html', // EXACT attack from screenshot
    ];

    spoofAttempts.forEach((url) => {
      const result = isGrafanaDocsUrl(url);
      expect(result).toBe(false);

      // Also verify parseUrlSafely extracts the ACTUAL hostname
      const parsed = parseUrlSafely(url);
      if (parsed) {
        expect(parsed.hostname).not.toBe('grafana.com');
      }
    });
  });

  it('should block XSS via iframe from spoofed domains (SCREENSHOT ATTACK)', () => {
    // This is the exact attack from the screenshot:
    // a-grafana.com serves: <iframe src="javascript:alert('xss')">
    const maliciousContent =
      '<iframe xmlns="http://www.w3.org/1999/xhtml" src="javascript:alert(\'xss\')" width="400" height="250"/>';
    const result = sanitizeDocumentationHTML(maliciousContent);

    // DOMPurify should strip the javascript: URL
    expect(result).not.toContain('javascript:');
    expect(result).not.toContain('alert(');
  });
});
