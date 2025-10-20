/**
 * Tests for centralized URL validation functions
 */
import {
  isGitHubUrl,
  isGitHubRawUrl,
  isAnyGitHubUrl,
  isGrafanaDocsUrl,
  isGrafanaDomain,
  isLocalhostUrl,
  isAllowedContentUrl,
  isAllowedGitHubRawUrl,
  validateTutorialUrl,
} from './url-validator';

// Mock the dev-mode module
jest.mock('./dev-mode', () => ({
  isDevModeEnabled: jest.fn(() => false),
  enableDevMode: jest.fn(),
  disableDevMode: jest.fn(),
  toggleDevMode: jest.fn(),
}));

import { isDevModeEnabled } from './dev-mode';

describe('Grafana URL validators', () => {
  describe('isGrafanaDomain', () => {
    it('should return true for grafana.com URLs', () => {
      expect(isGrafanaDomain('https://grafana.com')).toBe(true);
      expect(isGrafanaDomain('https://grafana.com/anything')).toBe(true);
    });

    it('should accept allowlisted Grafana subdomains', () => {
      // Allowlisted official Grafana domains
      expect(isGrafanaDomain('https://docs.grafana.com')).toBe(true);
      expect(isGrafanaDomain('https://play.grafana.com')).toBe(true);
    });

    it('should reject non-allowlisted subdomains (strict allowlist)', () => {
      // Only allowlisted domains are permitted - reject others
      expect(isGrafanaDomain('https://www.grafana.com')).toBe(false);
      expect(isGrafanaDomain('https://evil.grafana.com')).toBe(false);
      expect(isGrafanaDomain('https://attacker.grafana.com')).toBe(false);
      expect(isGrafanaDomain('https://malicious.grafana.com')).toBe(false);
    });

    it('should return false for domain hijacking attempts', () => {
      expect(isGrafanaDomain('https://a-grafana.com')).toBe(false);
      expect(isGrafanaDomain('https://grafana.com.evil.com')).toBe(false);
    });

    it('should return false for invalid URLs', () => {
      expect(isGrafanaDomain('not a url')).toBe(false);
      expect(isGrafanaDomain('')).toBe(false);
    });
  });

  describe('isGrafanaDocsUrl', () => {
    it('should return true for valid Grafana docs URLs', () => {
      expect(isGrafanaDocsUrl('https://grafana.com/docs/grafana/latest/')).toBe(true);
      expect(isGrafanaDocsUrl('https://grafana.com/tutorials/getting-started/')).toBe(true);
      expect(isGrafanaDocsUrl('https://grafana.com/docs/learning-journeys/drilldown-logs/')).toBe(true);
    });

    it('should return false for grafana.com URLs that are not docs', () => {
      expect(isGrafanaDocsUrl('https://grafana.com/pricing')).toBe(false);
      expect(isGrafanaDocsUrl('https://grafana.com/blog')).toBe(false);
    });

    it('should return false for domain hijacking attempts', () => {
      expect(isGrafanaDocsUrl('https://grafana.com.evil.com/docs/')).toBe(false);
      expect(isGrafanaDocsUrl('https://a-grafana.com/docs/')).toBe(false);
    });

    it('should return false for invalid URLs', () => {
      expect(isGrafanaDocsUrl('not a url')).toBe(false);
      expect(isGrafanaDocsUrl('')).toBe(false);
    });
  });
});

describe('GitHub URL validators', () => {
  describe('isGitHubUrl', () => {
    it('should return true for valid github.com URLs', () => {
      expect(isGitHubUrl('https://github.com/grafana/grafana')).toBe(true);
      expect(isGitHubUrl('https://github.com/user/repo/blob/main/file.ts')).toBe(true);
    });

    it('should return false for raw.githubusercontent.com URLs', () => {
      expect(isGitHubUrl('https://raw.githubusercontent.com/grafana/grafana/main/file.ts')).toBe(false);
    });

    it('should return false for non-GitHub URLs', () => {
      expect(isGitHubUrl('https://grafana.com/docs/')).toBe(false);
      expect(isGitHubUrl('https://github.com.evil.com/fake')).toBe(false);
    });

    it('should return false for http:// URLs (must be https)', () => {
      expect(isGitHubUrl('http://github.com/grafana/grafana')).toBe(false);
    });

    it('should return false for invalid URLs', () => {
      expect(isGitHubUrl('not a url')).toBe(false);
      expect(isGitHubUrl('')).toBe(false);
    });
  });

  describe('isGitHubRawUrl', () => {
    it('should return true for valid raw.githubusercontent.com URLs', () => {
      expect(isGitHubRawUrl('https://raw.githubusercontent.com/grafana/grafana/main/file.ts')).toBe(true);
      expect(isGitHubRawUrl('https://raw.githubusercontent.com/user/repo/branch/path/file.html')).toBe(true);
    });

    it('should return false for github.com URLs', () => {
      expect(isGitHubRawUrl('https://github.com/grafana/grafana')).toBe(false);
    });

    it('should return false for non-GitHub URLs', () => {
      expect(isGitHubRawUrl('https://grafana.com/docs/')).toBe(false);
      expect(isGitHubRawUrl('https://raw.githubusercontent.com.evil.com/fake')).toBe(false);
    });

    it('should return false for http:// URLs (must be https)', () => {
      expect(isGitHubRawUrl('http://raw.githubusercontent.com/grafana/grafana/main/file.ts')).toBe(false);
    });

    it('should return false for invalid URLs', () => {
      expect(isGitHubRawUrl('not a url')).toBe(false);
      expect(isGitHubRawUrl('')).toBe(false);
    });
  });

  describe('isAnyGitHubUrl', () => {
    it('should return true for github.com URLs', () => {
      expect(isAnyGitHubUrl('https://github.com/grafana/grafana')).toBe(true);
    });

    it('should return true for raw.githubusercontent.com URLs', () => {
      expect(isAnyGitHubUrl('https://raw.githubusercontent.com/grafana/grafana/main/file.ts')).toBe(true);
    });

    it('should return false for non-GitHub URLs', () => {
      expect(isAnyGitHubUrl('https://grafana.com/docs/')).toBe(false);
    });

    it('should return false for domain hijacking attempts', () => {
      expect(isAnyGitHubUrl('https://github.com.evil.com/fake')).toBe(false);
      expect(isAnyGitHubUrl('https://raw.githubusercontent.com.evil.com/fake')).toBe(false);
    });
  });

  describe('isAllowedGitHubRawUrl - SECURITY TESTS', () => {
    const allowedRepos = [
      {
        repo: '/grafana/interactive-tutorials/',
        allowedRefs: ['main', 'v1.0.0'], // Only main branch and v1.0.0 tag
      },
      {
        repo: '/grafana/test-repo/',
        allowedRefs: ['production'], // Only production branch
      },
    ];

    describe('✅ Allowed URLs (legitimate content)', () => {
      it('should allow URLs from main branch', () => {
        const url = 'https://raw.githubusercontent.com/grafana/interactive-tutorials/main/tutorial.md';
        expect(isAllowedGitHubRawUrl(url, allowedRepos)).toBe(true);
      });

      it('should allow URLs from allowed tag', () => {
        const url = 'https://raw.githubusercontent.com/grafana/interactive-tutorials/v1.0.0/tutorial.md';
        expect(isAllowedGitHubRawUrl(url, allowedRepos)).toBe(true);
      });

      it('should allow URLs with nested paths', () => {
        const url = 'https://raw.githubusercontent.com/grafana/interactive-tutorials/main/advanced/tutorial.md';
        expect(isAllowedGitHubRawUrl(url, allowedRepos)).toBe(true);
      });

      it('should allow URLs from second allowed repo', () => {
        const url = 'https://raw.githubusercontent.com/grafana/test-repo/production/file.md';
        expect(isAllowedGitHubRawUrl(url, allowedRepos)).toBe(true);
      });
    });

    describe('🔴 BLOCKED: PR Branch Attacks', () => {
      it('should block PR branch URLs', () => {
        const url = 'https://raw.githubusercontent.com/grafana/interactive-tutorials/attacker-pr-branch/exploit.md';
        expect(isAllowedGitHubRawUrl(url, allowedRepos)).toBe(false);
      });

      it('should block URLs from feature branches', () => {
        const url = 'https://raw.githubusercontent.com/grafana/interactive-tutorials/feature/evil-feature/exploit.md';
        expect(isAllowedGitHubRawUrl(url, allowedRepos)).toBe(false);
      });

      it('should block URLs from develop branch', () => {
        const url = 'https://raw.githubusercontent.com/grafana/interactive-tutorials/develop/tutorial.md';
        expect(isAllowedGitHubRawUrl(url, allowedRepos)).toBe(false);
      });
    });

    describe('🔴 BLOCKED: Commit Hash Attacks', () => {
      it('should block arbitrary commit hash URLs', () => {
        const url =
          'https://raw.githubusercontent.com/grafana/interactive-tutorials/45eae82874d8f9d3899dbf6345759d9ae23f7815/exploit.md';
        expect(isAllowedGitHubRawUrl(url, allowedRepos)).toBe(false);
      });

      it('should block short commit hash URLs', () => {
        const url = 'https://raw.githubusercontent.com/grafana/interactive-tutorials/45eae82/exploit.md';
        expect(isAllowedGitHubRawUrl(url, allowedRepos)).toBe(false);
      });
    });

    describe('🔴 BLOCKED: Wrong Repository', () => {
      it('should block URLs from non-allowed repositories', () => {
        const url = 'https://raw.githubusercontent.com/attacker/malicious-repo/main/exploit.md';
        expect(isAllowedGitHubRawUrl(url, allowedRepos)).toBe(false);
      });

      it('should block URLs from forked repositories', () => {
        const url = 'https://raw.githubusercontent.com/attacker/interactive-tutorials/main/exploit.md';
        expect(isAllowedGitHubRawUrl(url, allowedRepos)).toBe(false);
      });

      it('should block URLs from grafana org but different repo', () => {
        const url = 'https://raw.githubusercontent.com/grafana/grafana/main/file.md';
        expect(isAllowedGitHubRawUrl(url, allowedRepos)).toBe(false);
      });
    });

    describe('🔴 BLOCKED: Wrong Branch in Allowed Repo', () => {
      it('should block wrong branch even in allowed repo', () => {
        const url = 'https://raw.githubusercontent.com/grafana/test-repo/main/file.md';
        expect(isAllowedGitHubRawUrl(url, allowedRepos)).toBe(false); // Only 'production' is allowed
      });

      it('should block staging branch in test-repo', () => {
        const url = 'https://raw.githubusercontent.com/grafana/test-repo/staging/file.md';
        expect(isAllowedGitHubRawUrl(url, allowedRepos)).toBe(false);
      });
    });

    describe('🔴 BLOCKED: Protocol and Domain Validation', () => {
      it('should block HTTP URLs (require HTTPS)', () => {
        const url = 'http://raw.githubusercontent.com/grafana/interactive-tutorials/main/tutorial.md';
        expect(isAllowedGitHubRawUrl(url, allowedRepos)).toBe(false);
      });

      it('should block domain hijacking attempts', () => {
        const url = 'https://raw.githubusercontent.com.evil.com/grafana/interactive-tutorials/main/tutorial.md';
        expect(isAllowedGitHubRawUrl(url, allowedRepos)).toBe(false);
      });

      it('should block wrong hostname', () => {
        const url = 'https://github.com/grafana/interactive-tutorials/blob/main/tutorial.md';
        expect(isAllowedGitHubRawUrl(url, allowedRepos)).toBe(false);
      });
    });

    describe('🔴 BLOCKED: Malformed URLs', () => {
      it('should block URLs with insufficient path parts', () => {
        const url = 'https://raw.githubusercontent.com/grafana/';
        expect(isAllowedGitHubRawUrl(url, allowedRepos)).toBe(false);
      });

      it('should block invalid URL strings', () => {
        expect(isAllowedGitHubRawUrl('not a url', allowedRepos)).toBe(false);
        expect(isAllowedGitHubRawUrl('', allowedRepos)).toBe(false);
      });

      it('should block URLs without ref', () => {
        const url = 'https://raw.githubusercontent.com/grafana/interactive-tutorials/';
        expect(isAllowedGitHubRawUrl(url, allowedRepos)).toBe(false);
      });
    });

    describe('Edge Cases', () => {
      it('should handle empty allowed repos array', () => {
        const url = 'https://raw.githubusercontent.com/grafana/interactive-tutorials/main/tutorial.md';
        expect(isAllowedGitHubRawUrl(url, [])).toBe(false);
      });

      it('should handle repo with no allowed refs', () => {
        const noRefsAllowed = [{ repo: '/grafana/interactive-tutorials/', allowedRefs: [] }];
        const url = 'https://raw.githubusercontent.com/grafana/interactive-tutorials/main/tutorial.md';
        expect(isAllowedGitHubRawUrl(url, noRefsAllowed)).toBe(false);
      });

      it('should be case-sensitive for branch names', () => {
        const url = 'https://raw.githubusercontent.com/grafana/interactive-tutorials/Main/tutorial.md';
        expect(isAllowedGitHubRawUrl(url, allowedRepos)).toBe(false); // 'Main' != 'main'
      });
    });
  });
});

describe('Localhost URL validators', () => {
  describe('isLocalhostUrl', () => {
    it('should return true for localhost URLs', () => {
      expect(isLocalhostUrl('http://localhost:3000')).toBe(true);
      expect(isLocalhostUrl('https://localhost:3000')).toBe(true);
      expect(isLocalhostUrl('http://localhost')).toBe(true);
    });

    it('should return true for 127.0.0.1 URLs', () => {
      expect(isLocalhostUrl('http://127.0.0.1:8080')).toBe(true);
      expect(isLocalhostUrl('https://127.0.0.1:5500')).toBe(true);
      expect(isLocalhostUrl('http://127.0.0.1')).toBe(true);
    });

    it('should return true for 127.x.x.x range', () => {
      expect(isLocalhostUrl('http://127.1.2.3:8080')).toBe(true);
      expect(isLocalhostUrl('http://127.255.255.255')).toBe(true);
    });

    it('should return true for IPv6 localhost', () => {
      expect(isLocalhostUrl('http://[::1]:3000')).toBe(true);
    });

    it('should return false for non-localhost URLs', () => {
      expect(isLocalhostUrl('https://grafana.com')).toBe(false);
      expect(isLocalhostUrl('http://192.168.1.1')).toBe(false);
      expect(isLocalhostUrl('http://mylocalhost.com')).toBe(false);
    });

    it('should return false for dangerous protocols', () => {
      expect(isLocalhostUrl('file://localhost/path')).toBe(false);
      expect(isLocalhostUrl('javascript:alert("xss")')).toBe(false);
    });

    it('should return false for invalid URLs', () => {
      expect(isLocalhostUrl('not a url')).toBe(false);
      expect(isLocalhostUrl('')).toBe(false);
    });
  });

  describe('isAllowedContentUrl', () => {
    beforeEach(() => {
      // Reset dev mode mock to disabled by default
      jest.mocked(isDevModeEnabled).mockReturnValue(false);
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    it('should always allow bundled content', () => {
      expect(isAllowedContentUrl('bundled:welcome-to-grafana')).toBe(true);
      expect(isAllowedContentUrl('bundled:first-dashboard')).toBe(true);
    });

    it('should always allow Grafana docs URLs', () => {
      expect(isAllowedContentUrl('https://grafana.com/docs/grafana/latest/')).toBe(true);
      expect(isAllowedContentUrl('https://grafana.com/tutorials/getting-started/')).toBe(true);
    });

    it('should reject localhost URLs in production mode', () => {
      expect(isAllowedContentUrl('http://localhost:3000/docs')).toBe(false);
      expect(isAllowedContentUrl('http://127.0.0.1:5500/tutorial.html')).toBe(false);
    });

    it('should allow localhost URLs with valid docs paths in dev mode', () => {
      jest.mocked(isDevModeEnabled).mockReturnValue(true);

      // Valid docs paths should be allowed
      expect(isAllowedContentUrl('http://localhost:3000/docs')).toBe(true);
      expect(isAllowedContentUrl('http://localhost:3000/docs/grafana/latest/')).toBe(true);
      expect(isAllowedContentUrl('http://127.0.0.1:5500/tutorials/getting-started')).toBe(true);
      expect(isAllowedContentUrl('http://localhost:3000/learning-journeys/intro')).toBe(true);
    });

    it('should reject localhost URLs without valid docs paths in dev mode', () => {
      jest.mocked(isDevModeEnabled).mockReturnValue(true);

      // Non-docs paths should be rejected to avoid intercepting menu items
      expect(isAllowedContentUrl('http://localhost:3000/')).toBe(false);
      expect(isAllowedContentUrl('http://localhost:3000/dashboard')).toBe(false);
      expect(isAllowedContentUrl('http://localhost:3000/d/abc123/my-dashboard')).toBe(false);
      expect(isAllowedContentUrl('http://127.0.0.1:5500/tutorial.html')).toBe(false);
      expect(isAllowedContentUrl('http://localhost:3000/datasources')).toBe(false);
    });

    it('should reject non-Grafana URLs in production', () => {
      expect(isAllowedContentUrl('https://evil.com/fake-docs')).toBe(false);
      expect(isAllowedContentUrl('https://grafana.com.evil.com/docs')).toBe(false);
    });

    it('should reject non-Grafana URLs even in dev mode', () => {
      jest.mocked(isDevModeEnabled).mockReturnValue(true);

      expect(isAllowedContentUrl('https://evil.com/fake-docs')).toBe(false);
      expect(isAllowedContentUrl('https://malicious.site/tutorial')).toBe(false);
    });
  });

  describe('validateTutorialUrl', () => {
    beforeEach(() => {
      jest.mocked(isDevModeEnabled).mockReturnValue(false);
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    it('should accept Grafana docs URLs', () => {
      const result = validateTutorialUrl('https://grafana.com/docs/grafana/latest/');
      expect(result.isValid).toBe(true);
    });

    it('should reject localhost URLs in production', () => {
      const result = validateTutorialUrl('http://localhost:5500/tutorial/unstyled.html');
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toContain('dev mode');
    });

    it('should accept localhost URLs with /unstyled.html suffix in dev mode', () => {
      jest.mocked(isDevModeEnabled).mockReturnValue(true);

      const result = validateTutorialUrl('http://localhost:5500/tutorial/unstyled.html');
      expect(result.isValid).toBe(true);
    });

    it('should reject localhost URLs without /unstyled.html suffix in dev mode', () => {
      jest.mocked(isDevModeEnabled).mockReturnValue(true);

      const result = validateTutorialUrl('http://localhost:5500/tutorial/index.html');
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toContain('unstyled.html');
    });

    it('should reject empty URLs', () => {
      const result = validateTutorialUrl('');
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toContain('provide a URL');
    });

    it('should reject invalid URL formats', () => {
      const result = validateTutorialUrl('not a valid url');
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toContain('Invalid URL');
    });
  });
});
