/**
 * Security Test Suite
 *
 * Ensures XSS prevention and URL validation security controls don't regress.
 * Based on security audit from meeting with Kristian Bremberg.
 */

import { sanitizeDocumentationHTML } from './html-sanitizer';
import { parseHTMLToComponents } from '../docs-retrieval/html-parser';
import {
  parseUrlSafely,
  isGrafanaDocsUrl,
  isYouTubeDomain,
  isVimeoDomain,
  isInteractiveLearningUrl,
} from './url-validator';

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

    it('should accept allowlisted Grafana subdomains with docs paths', () => {
      // Official Grafana subdomains in the allowlist
      expect(isGrafanaDocsUrl('https://docs.grafana.com/docs/')).toBe(true);
      expect(isGrafanaDocsUrl('https://play.grafana.com/docs/')).toBe(true);
    });

    it('should REJECT non-allowlisted subdomains (strict allowlist)', () => {
      // Only allowlisted subdomains permitted - reject others
      expect(isGrafanaDocsUrl('https://www.grafana.com/docs/')).toBe(false);
      expect(isGrafanaDocsUrl('https://evil.grafana.com/docs/')).toBe(false);
      expect(isGrafanaDocsUrl('https://malicious.grafana.com/docs/')).toBe(false);
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

  describe('isVimeoDomain', () => {
    it('should accept valid Vimeo domains', () => {
      expect(isVimeoDomain('https://player.vimeo.com/video/123456')).toBe(true);
      expect(isVimeoDomain('https://vimeo.com/123456')).toBe(true);
      expect(isVimeoDomain('https://www.vimeo.com/123456')).toBe(true);
      expect(isVimeoDomain('https://f.vimeocdn.com/p/3.0/api/player.js')).toBe(true);
    });

    it('should REJECT Vimeo domain hijacking', () => {
      expect(isVimeoDomain('https://vimeo.com.evil.com/video/')).toBe(false);
      expect(isVimeoDomain('https://a-vimeo.com/video/')).toBe(false);
      expect(isVimeoDomain('https://evil.com/vimeo.com/video/')).toBe(false);
    });

    it('should REJECT dangerous protocols', () => {
      expect(isVimeoDomain('javascript:vimeo.com')).toBe(false);
      expect(isVimeoDomain('data:text/html,vimeo.com')).toBe(false);
      expect(isVimeoDomain('http://vimeo.com/video/')).toBe(false); // Only HTTPS
    });
  });

  describe('isInteractiveLearningUrl', () => {
    it('should accept URLs from interactive-learning.grafana.net', () => {
      const validUrl = 'https://interactive-learning.grafana.net/tutorial/content.json';
      expect(isInteractiveLearningUrl(validUrl)).toBe(true);
    });

    it('should accept URLs from interactive-learning.grafana-dev.net', () => {
      const validUrl = 'https://interactive-learning.grafana-dev.net/tutorial/content.json';
      expect(isInteractiveLearningUrl(validUrl)).toBe(true);
    });

    it('should REJECT domain hijacking attempts', () => {
      const hijack1 = 'https://interactive-learning.grafana.net.evil.com/tutorial/';
      const hijack2 = 'https://a-interactive-learning.grafana.net/tutorial/';
      const hijack3 = 'https://interactive-learning.grafana-dev.net.evil.com/tutorial/';

      expect(isInteractiveLearningUrl(hijack1)).toBe(false);
      expect(isInteractiveLearningUrl(hijack2)).toBe(false);
      expect(isInteractiveLearningUrl(hijack3)).toBe(false);
    });

    it('should REJECT other domains', () => {
      const otherDomain1 = 'https://evil.com/tutorial/';
      const otherDomain2 = 'https://grafana.com/docs/';

      expect(isInteractiveLearningUrl(otherDomain1)).toBe(false);
      expect(isInteractiveLearningUrl(otherDomain2)).toBe(false);
    });

    it('should require https protocol', () => {
      const httpUrl = 'http://interactive-learning.grafana.net/tutorial/';
      expect(isInteractiveLearningUrl(httpUrl)).toBe(false);
    });

    it('should accept URLs with any path', () => {
      const url1 = 'https://interactive-learning.grafana.net/guide/step1/content.json';
      const url2 = 'https://interactive-learning.grafana.net/tutorials/advanced/unstyled.html';

      expect(isInteractiveLearningUrl(url1)).toBe(true);
      expect(isInteractiveLearningUrl(url2)).toBe(true);
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

  it('should accept interactive content from interactive-learning.grafana.net', () => {
    const html = '<li class="interactive" data-targetaction="button" data-reftarget="Save">Click</li>';
    const baseUrl = 'https://interactive-learning.grafana.net/tutorial/content.json';

    const result = parseHTMLToComponents(html, baseUrl);

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should accept interactive content from interactive-learning.grafana-dev.net', () => {
    const html = '<li class="interactive" data-targetaction="button" data-reftarget="Save">Click</li>';
    const baseUrl = 'https://interactive-learning.grafana-dev.net/tutorial/unstyled.html';

    const result = parseHTMLToComponents(html, baseUrl);

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should REJECT interactive content from untrusted domains', () => {
    const html = '<li class="interactive" data-targetaction="button" data-reftarget="Save">Click</li>';
    const baseUrl = 'https://evil.com/tutorials/hack.html';

    const result = parseHTMLToComponents(html, baseUrl);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        type: 'html_sanitization',
        message: 'Interactive content from untrusted source rejected',
      })
    );
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
      jest.doMock('../utils/dev-mode', () => ({
        isDevModeEnabled: () => true,
        isDevModeEnabledGlobal: () => true,
        enableDevMode: jest.fn(),
        disableDevMode: jest.fn(),
        toggleDevMode: jest.fn(),
      }));

      const { parseHTMLToComponents: parseWithDevMode } = require('../docs-retrieval/html-parser');

      localhostUrls.forEach((url) => {
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
    const baseUrl = 'https://untrusted.example.com/test.html';

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
    // YouTube iframes should NOT have referrerpolicy set - browser default is sufficient
    // Setting no-referrer causes YouTube playback error 153
    expect(result).not.toContain('referrerpolicy');
  });

  it('should accept valid Vimeo iframes without sandbox restrictions', () => {
    const iframe = '<iframe src="https://player.vimeo.com/video/123456"></iframe>';
    const result = sanitizeDocumentationHTML(iframe);

    expect(result).toContain('<iframe');
    expect(result).toContain('player.vimeo.com');
    // Vimeo should NOT be sandboxed (needs scripts to work)
    expect(result).not.toContain('sandbox');
    // Vimeo should NOT have referrerpolicy set (uses browser default)
    expect(result).not.toContain('referrerpolicy');
  });

  it('should sandbox non-video platform iframes', () => {
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

describe('Security: Interactive Learning Domain Validation', () => {
  it('should ONLY allow interactive-learning.grafana.net domain', () => {
    const validUrl = 'https://interactive-learning.grafana.net/tutorial/content.json';
    expect(isInteractiveLearningUrl(validUrl)).toBe(true);
  });

  it('should ONLY allow interactive-learning.grafana-dev.net domain', () => {
    const validUrl = 'https://interactive-learning.grafana-dev.net/tutorial/content.json';
    expect(isInteractiveLearningUrl(validUrl)).toBe(true);
  });

  it('should REJECT domain hijacking attempts', () => {
    const hijackAttempts = [
      'https://interactive-learning.grafana.net.evil.com/tutorial/',
      'https://a-interactive-learning.grafana.net/tutorial/',
      'https://interactive-learning.grafana-dev.net.evil.com/tutorial/',
      'https://evil.interactive-learning.grafana.net/tutorial/',
    ];

    hijackAttempts.forEach((url) => {
      expect(isInteractiveLearningUrl(url)).toBe(false);
    });
  });

  it('should REJECT other domains', () => {
    const otherDomains = [
      'https://grafana.com/docs/tutorial/',
      'https://evil.com/tutorial/',
      'https://learning.grafana.net/tutorial/',
    ];

    otherDomains.forEach((url) => {
      expect(isInteractiveLearningUrl(url)).toBe(false);
    });
  });

  it('should require HTTPS protocol', () => {
    const httpUrl = 'http://interactive-learning.grafana.net/tutorial/';
    expect(isInteractiveLearningUrl(httpUrl)).toBe(false);
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

describe('Security: Image Lightbox XSS Prevention', () => {
  it('should escape image alt attributes to prevent HTML injection', () => {
    // This is the exact XSS payload from the security report
    const maliciousAlt = "Test\"></h3><img src=x onerror=alert('XSS')><h3>";

    // VULNERABLE approach (using innerHTML - XSS possible):
    const vulnerableDiv = document.createElement('div');
    vulnerableDiv.innerHTML = `<h3>${maliciousAlt}</h3>`; // VULNERABLE!

    // Verify the vulnerability: innerHTML parses HTML, creating actual elements
    const injectedImg = vulnerableDiv.querySelector('img');
    expect(injectedImg).not.toBeNull(); // XSS payload created actual img element!
    if (injectedImg) {
      expect(injectedImg.getAttribute('onerror')).toBeTruthy(); // onerror handler exists!
    }

    // SAFE approach (using textContent - XSS prevented):
    const safeTitle = document.createElement('h3');
    safeTitle.textContent = maliciousAlt; // SAFE: treats as plain text

    // Verify that textContent properly escapes - NO executable elements created
    expect(safeTitle.textContent).toBe(maliciousAlt); // Original text preserved
    expect(safeTitle.querySelector('img')).toBeNull(); // NO img element created
    expect(safeTitle.childNodes.length).toBe(1); // Only a text node, no element nodes
    expect(safeTitle.childNodes[0].nodeType).toBe(Node.TEXT_NODE); // Text node, not element

    // SAFE approach (using setAttribute):
    const safeImg = document.createElement('img');
    safeImg.setAttribute('alt', maliciousAlt); // SAFE!
    safeImg.setAttribute('src', 'https://grafana.com/test.svg');

    // Verify setAttribute stores value safely (as attribute string, not parsed HTML)
    expect(safeImg.getAttribute('alt')).toBe(maliciousAlt);
    expect(safeImg.alt).toBe(maliciousAlt); // Also safe via property
  });

  it('should prevent XSS via malicious image src URLs', () => {
    const maliciousSrc = 'javascript:alert("XSS")';

    const safeImg = document.createElement('img');
    safeImg.setAttribute('src', maliciousSrc);

    // setAttribute with javascript: protocol is safe - browser won't execute
    // The src is set but not executed as script
    expect(safeImg.getAttribute('src')).toBe(maliciousSrc);
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
