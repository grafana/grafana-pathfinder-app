/**
 * Security tests for data proxy URL handling
 * Ensures data proxy maintains same security validation as direct GitHub access
 */

import { convertGitHubRawToProxyUrl, isDataProxyUrl, extractGitHubRawUrl } from './data-proxy';

// Mock constants
jest.mock('../constants', () => ({
  ALLOWED_GITHUB_REPOS: [
    {
      repo: '/grafana/interactive-tutorials/',
      allowedRefs: ['main', 'v1.0.0'],
    },
  ],
}));

describe('Data Proxy URL Utilities', () => {
  describe('convertGitHubRawToProxyUrl', () => {
    describe('Valid conversions', () => {
      it('should convert valid GitHub raw URL to proxy URL', () => {
        const url = 'https://raw.githubusercontent.com/grafana/interactive-tutorials/main/tutorial.html';
        const result = convertGitHubRawToProxyUrl(url);
        expect(result).toBe('api/plugin-proxy/grafana-pathfinder-app/github-raw/tutorial.html');
      });

      it('should convert URL with nested path', () => {
        const url =
          'https://raw.githubusercontent.com/grafana/interactive-tutorials/main/explore-drilldowns-101/unstyled.html';
        const result = convertGitHubRawToProxyUrl(url);
        expect(result).toBe('api/plugin-proxy/grafana-pathfinder-app/github-raw/explore-drilldowns-101/unstyled.html');
      });

      it('should convert URL with version tag', () => {
        const url = 'https://raw.githubusercontent.com/grafana/interactive-tutorials/v1.0.0/tutorial.html';
        const result = convertGitHubRawToProxyUrl(url);
        expect(result).toBe('api/plugin-proxy/grafana-pathfinder-app/github-raw/tutorial.html');
      });
    });

    describe('Security validation - Protocol attacks', () => {
      it('should handle HTTP URLs (protocol validation done in enforceHttps)', () => {
        // Note: convertGitHubRawToProxyUrl doesn't validate protocol - that's done in enforceHttps()
        const url = 'http://raw.githubusercontent.com/grafana/interactive-tutorials/main/tutorial.html';
        // Should convert successfully - protocol check is elsewhere
        expect(convertGitHubRawToProxyUrl(url)).toBe(
          'api/plugin-proxy/grafana-pathfinder-app/github-raw/tutorial.html'
        );
      });

      it('should reject javascript: URLs', () => {
        const url = 'javascript:alert(1)';
        expect(convertGitHubRawToProxyUrl(url)).toBe(null);
      });

      it('should reject data: URLs', () => {
        const url = 'data:text/html,<script>alert(1)</script>';
        expect(convertGitHubRawToProxyUrl(url)).toBe(null);
      });
    });

    describe('Security validation - Domain attacks', () => {
      it('should reject domain hijacking attempts', () => {
        const url = 'https://raw.githubusercontent.com.evil.com/grafana/interactive-tutorials/main/exploit.html';
        expect(convertGitHubRawToProxyUrl(url)).toBe(null);
      });

      it('should reject subdomain hijacking', () => {
        const url = 'https://evil.raw.githubusercontent.com/grafana/interactive-tutorials/main/exploit.html';
        expect(convertGitHubRawToProxyUrl(url)).toBe(null);
      });

      it('should reject similar-looking domains', () => {
        const url = 'https://raw-githubusercontent.com/grafana/interactive-tutorials/main/exploit.html';
        expect(convertGitHubRawToProxyUrl(url)).toBe(null);
      });
    });

    describe('Security validation - Repository validation', () => {
      it('should reject URLs from non-allowed repositories', () => {
        const url = 'https://raw.githubusercontent.com/attacker/malicious-repo/main/exploit.html';
        expect(convertGitHubRawToProxyUrl(url)).toBe(null);
      });

      it('should reject URLs from other grafana repos', () => {
        const url = 'https://raw.githubusercontent.com/grafana/grafana/main/file.html';
        expect(convertGitHubRawToProxyUrl(url)).toBe(null);
      });

      it('should reject non-grafana owner with same repo name', () => {
        const url = 'https://raw.githubusercontent.com/attacker/interactive-tutorials/main/exploit.html';
        expect(convertGitHubRawToProxyUrl(url)).toBe(null);
      });
    });

    describe('Security validation - Branch/ref validation', () => {
      it('should reject URLs with non-allowed refs', () => {
        const url = 'https://raw.githubusercontent.com/grafana/interactive-tutorials/develop/file.html';
        expect(convertGitHubRawToProxyUrl(url)).toBe(null);
      });

      it('should reject PR branches', () => {
        const url = 'https://raw.githubusercontent.com/grafana/interactive-tutorials/pr-123/exploit.html';
        expect(convertGitHubRawToProxyUrl(url)).toBe(null);
      });

      it('should reject arbitrary commit hashes', () => {
        const url = 'https://raw.githubusercontent.com/grafana/interactive-tutorials/abc123def456/exploit.html';
        expect(convertGitHubRawToProxyUrl(url)).toBe(null);
      });

      it('should be case-sensitive for refs', () => {
        const url = 'https://raw.githubusercontent.com/grafana/interactive-tutorials/Main/file.html';
        expect(convertGitHubRawToProxyUrl(url)).toBe(null); // 'Main' != 'main'
      });
    });

    describe('Edge cases', () => {
      it('should reject invalid URLs', () => {
        expect(convertGitHubRawToProxyUrl('not a url')).toBe(null);
        expect(convertGitHubRawToProxyUrl('')).toBe(null);
      });

      it('should reject URLs with insufficient path parts', () => {
        const url = 'https://raw.githubusercontent.com/grafana/interactive-tutorials';
        expect(convertGitHubRawToProxyUrl(url)).toBe(null);
      });

      it('should reject github.com URLs (not raw)', () => {
        const url = 'https://github.com/grafana/interactive-tutorials/blob/main/tutorial.html';
        expect(convertGitHubRawToProxyUrl(url)).toBe(null);
      });
    });
  });

  describe('isDataProxyUrl', () => {
    it('should identify relative proxy URLs', () => {
      const url = 'api/plugin-proxy/grafana-pathfinder-app/github-raw/tutorial.html';
      expect(isDataProxyUrl(url)).toBe(true);
    });

    it('should identify absolute path proxy URLs', () => {
      const url = '/api/plugin-proxy/grafana-pathfinder-app/github-raw/tutorial.html';
      expect(isDataProxyUrl(url)).toBe(true);
    });

    it('should identify full URL proxy URLs (http)', () => {
      const url = 'http://localhost:3000/api/plugin-proxy/grafana-pathfinder-app/github-raw/tutorial.html';
      expect(isDataProxyUrl(url)).toBe(true);
    });

    it('should identify full URL proxy URLs (https)', () => {
      const url = 'https://example.com/api/plugin-proxy/grafana-pathfinder-app/github-raw/tutorial.html';
      expect(isDataProxyUrl(url)).toBe(true);
    });

    it('should reject non-proxy URLs', () => {
      expect(isDataProxyUrl('https://raw.githubusercontent.com/grafana/repo/main/file.html')).toBe(false);
      expect(isDataProxyUrl('https://grafana.com/docs/grafana/')).toBe(false);
      expect(isDataProxyUrl('http://localhost:3000/other-api/endpoint')).toBe(false);
    });

    it('should reject proxy URLs for different plugins', () => {
      const url = 'api/plugin-proxy/other-plugin-id/github-raw/tutorial.html';
      expect(isDataProxyUrl(url)).toBe(false);
    });

    it('should reject empty or invalid inputs', () => {
      expect(isDataProxyUrl('')).toBe(false);
      expect(isDataProxyUrl('not a url')).toBe(false);
    });
  });

  describe('extractGitHubRawUrl', () => {
    it('should extract GitHub URL from proxy URL', () => {
      const proxyUrl = 'api/plugin-proxy/grafana-pathfinder-app/github-raw/explore-drilldowns-101/unstyled.html';
      const result = extractGitHubRawUrl(proxyUrl);
      expect(result).toBe(
        'https://raw.githubusercontent.com/grafana/interactive-tutorials/main/explore-drilldowns-101/unstyled.html'
      );
    });

    it('should extract from absolute path proxy URL', () => {
      const proxyUrl = '/api/plugin-proxy/grafana-pathfinder-app/github-raw/tutorial.html';
      const result = extractGitHubRawUrl(proxyUrl);
      expect(result).toBe('https://raw.githubusercontent.com/grafana/interactive-tutorials/main/tutorial.html');
    });

    it('should extract from full URL proxy URL', () => {
      const proxyUrl = 'http://localhost:3000/api/plugin-proxy/grafana-pathfinder-app/github-raw/tutorial.html';
      const result = extractGitHubRawUrl(proxyUrl);
      // extractGitHubRawUrl uses isDataProxyUrl which should handle full URLs
      expect(result).toBe('https://raw.githubusercontent.com/grafana/interactive-tutorials/main/tutorial.html');
    });

    it('should return null for non-proxy URLs', () => {
      expect(extractGitHubRawUrl('https://raw.githubusercontent.com/grafana/repo/main/file.html')).toBe(null);
      expect(extractGitHubRawUrl('https://grafana.com/docs/')).toBe(null);
    });

    it('should return null for wrong route', () => {
      const proxyUrl = 'api/plugin-proxy/grafana-pathfinder-app/other-route/file.html';
      expect(extractGitHubRawUrl(proxyUrl)).toBe(null);
    });
  });

  describe('Integration - Round trip conversion', () => {
    it('should maintain path integrity through conversion and extraction', () => {
      const originalUrl =
        'https://raw.githubusercontent.com/grafana/interactive-tutorials/main/explore-drilldowns-101/unstyled.html';
      const proxyUrl = convertGitHubRawToProxyUrl(originalUrl);
      const extractedUrl = extractGitHubRawUrl(proxyUrl!);
      expect(extractedUrl).toBe(originalUrl);
    });
  });
});
