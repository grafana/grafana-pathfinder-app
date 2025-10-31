/**
 * Security tests for jsDelivr URL validation
 * Ensures jsDelivr has the SAME security scrutiny as raw.githubusercontent.com
 */

import { isAllowedJsDelivrUrl, browserNeedsCorsProxy } from './url-validator';

describe('isAllowedJsDelivrUrl - SECURITY TESTS', () => {
  const allowedRepos = [
    {
      repo: '/grafana/interactive-tutorials/',
      allowedRefs: ['main', 'v1.0.0'],
    },
  ];

  describe('Valid URLs (ALLOWED)', () => {
    it('should allow valid jsDelivr URL from allowed repo and ref', () => {
      const url = 'https://cdn.jsdelivr.net/gh/grafana/interactive-tutorials@main/tutorial.html';
      expect(isAllowedJsDelivrUrl(url, allowedRepos)).toBe(true);
    });

    it('should allow valid jsDelivr URL with version tag', () => {
      const url = 'https://cdn.jsdelivr.net/gh/grafana/interactive-tutorials@v1.0.0/tutorial.html';
      expect(isAllowedJsDelivrUrl(url, allowedRepos)).toBe(true);
    });

    it('should allow URLs with nested paths', () => {
      const url = 'https://cdn.jsdelivr.net/gh/grafana/interactive-tutorials@main/path/to/tutorial.html';
      expect(isAllowedJsDelivrUrl(url, allowedRepos)).toBe(true);
    });
  });

  describe('Protocol Security (BLOCKED)', () => {
    it('should block HTTP URLs', () => {
      const url = 'http://cdn.jsdelivr.net/gh/grafana/interactive-tutorials@main/tutorial.html';
      expect(isAllowedJsDelivrUrl(url, allowedRepos)).toBe(false);
    });

    it('should block javascript: protocol', () => {
      const url = 'javascript:alert(1)';
      expect(isAllowedJsDelivrUrl(url, allowedRepos)).toBe(false);
    });

    it('should block data: protocol', () => {
      const url = 'data:text/html,<script>alert(1)</script>';
      expect(isAllowedJsDelivrUrl(url, allowedRepos)).toBe(false);
    });
  });

  describe('Hostname Security (BLOCKED)', () => {
    it('should block domain hijacking attempts', () => {
      const url = 'https://cdn.jsdelivr.net.evil.com/gh/grafana/interactive-tutorials@main/tutorial.html';
      expect(isAllowedJsDelivrUrl(url, allowedRepos)).toBe(false);
    });

    it('should block subdomain attacks', () => {
      const url = 'https://evil.cdn.jsdelivr.net/gh/grafana/interactive-tutorials@main/tutorial.html';
      expect(isAllowedJsDelivrUrl(url, allowedRepos)).toBe(false);
    });

    it('should block similar domains', () => {
      const url = 'https://cdn-jsdelivr.net/gh/grafana/interactive-tutorials@main/tutorial.html';
      expect(isAllowedJsDelivrUrl(url, allowedRepos)).toBe(false);
    });
  });

  describe('Path Prefix Security (BLOCKED)', () => {
    it('should block npm packages', () => {
      const url = 'https://cdn.jsdelivr.net/npm/malicious-package@1.0.0/exploit.js';
      expect(isAllowedJsDelivrUrl(url, allowedRepos)).toBe(false);
    });

    it('should block WordPress plugins', () => {
      const url = 'https://cdn.jsdelivr.net/wp/plugins/malicious@1.0/exploit.php';
      expect(isAllowedJsDelivrUrl(url, allowedRepos)).toBe(false);
    });

    it('should block URLs without /gh/ prefix', () => {
      const url = 'https://cdn.jsdelivr.net/grafana/interactive-tutorials@main/tutorial.html';
      expect(isAllowedJsDelivrUrl(url, allowedRepos)).toBe(false);
    });
  });

  describe('Repository Allowlist Security (BLOCKED)', () => {
    it('should block URLs from non-allowed repositories', () => {
      const url = 'https://cdn.jsdelivr.net/gh/attacker/malicious-repo@main/exploit.html';
      expect(isAllowedJsDelivrUrl(url, allowedRepos)).toBe(false);
    });

    it('should block URLs from forked repositories', () => {
      const url = 'https://cdn.jsdelivr.net/gh/attacker/interactive-tutorials@main/exploit.html';
      expect(isAllowedJsDelivrUrl(url, allowedRepos)).toBe(false);
    });

    it('should block URLs from grafana org but different repo', () => {
      const url = 'https://cdn.jsdelivr.net/gh/grafana/grafana@main/file.html';
      expect(isAllowedJsDelivrUrl(url, allowedRepos)).toBe(false);
    });
  });

  describe('Ref/Branch Security (BLOCKED)', () => {
    it('should block PR branch URLs', () => {
      const url = 'https://cdn.jsdelivr.net/gh/grafana/interactive-tutorials@attacker-pr/exploit.html';
      expect(isAllowedJsDelivrUrl(url, allowedRepos)).toBe(false);
    });

    it('should block feature branches', () => {
      const url = 'https://cdn.jsdelivr.net/gh/grafana/interactive-tutorials@feature/evil/exploit.html';
      expect(isAllowedJsDelivrUrl(url, allowedRepos)).toBe(false);
    });

    it('should block develop branch', () => {
      const url = 'https://cdn.jsdelivr.net/gh/grafana/interactive-tutorials@develop/tutorial.html';
      expect(isAllowedJsDelivrUrl(url, allowedRepos)).toBe(false);
    });

    it('should block commit hashes', () => {
      const url = 'https://cdn.jsdelivr.net/gh/grafana/interactive-tutorials@45eae82874d8f9d/exploit.html';
      expect(isAllowedJsDelivrUrl(url, allowedRepos)).toBe(false);
    });
  });

  describe('URL Format Validation (BLOCKED)', () => {
    it('should block URLs without @ref', () => {
      const url = 'https://cdn.jsdelivr.net/gh/grafana/interactive-tutorials/tutorial.html';
      expect(isAllowedJsDelivrUrl(url, allowedRepos)).toBe(false);
    });

    it('should block URLs with insufficient path parts', () => {
      const url = 'https://cdn.jsdelivr.net/gh/grafana';
      expect(isAllowedJsDelivrUrl(url, allowedRepos)).toBe(false);
    });

    it('should block invalid URL strings', () => {
      expect(isAllowedJsDelivrUrl('not a url', allowedRepos)).toBe(false);
      expect(isAllowedJsDelivrUrl('', allowedRepos)).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty allowed repos array', () => {
      const url = 'https://cdn.jsdelivr.net/gh/grafana/interactive-tutorials@main/tutorial.html';
      expect(isAllowedJsDelivrUrl(url, [])).toBe(false);
    });

    it('should handle repo with no allowed refs', () => {
      const noRefsAllowed = [{ repo: '/grafana/interactive-tutorials/', allowedRefs: [] }];
      const url = 'https://cdn.jsdelivr.net/gh/grafana/interactive-tutorials@main/tutorial.html';
      expect(isAllowedJsDelivrUrl(url, noRefsAllowed)).toBe(false);
    });

    it('should be case-sensitive for refs', () => {
      const url = 'https://cdn.jsdelivr.net/gh/grafana/interactive-tutorials@Main/tutorial.html';
      expect(isAllowedJsDelivrUrl(url, allowedRepos)).toBe(false); // 'Main' != 'main'
    });
  });
});

describe('browserNeedsCorsProxy', () => {
  const originalUserAgent = navigator.userAgent;

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', {
      value: originalUserAgent,
      writable: true,
    });
  });

  it('should return true for Firefox', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/115.0',
      writable: true,
    });
    expect(browserNeedsCorsProxy()).toBe(true);
  });

  it('should return true for Safari', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15',
      writable: true,
    });
    expect(browserNeedsCorsProxy()).toBe(true);
  });

  it('should return false for Chrome', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      writable: true,
    });
    expect(browserNeedsCorsProxy()).toBe(false);
  });

  it('should return false for Chromium', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chromium/119.0.0.0 Chrome/119.0.0.0 Safari/537.36',
      writable: true,
    });
    expect(browserNeedsCorsProxy()).toBe(false);
  });

  it('should return false for Edge (Chromium-based)', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0',
      writable: true,
    });
    expect(browserNeedsCorsProxy()).toBe(false);
  });
});
