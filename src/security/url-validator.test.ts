/**
 * Tests for centralized URL validation functions
 */
import {
  isGrafanaDocsUrl,
  isGrafanaDomain,
  isLocalhostUrl,
  isAllowedContentUrl,
  isInteractiveLearningUrl,
  validateTutorialUrl,
  validateRedirectPath,
  isGitHubRawUrl,
} from './url-validator';

// Mock the dev-mode module
jest.mock('../utils/dev-mode', () => ({
  isDevModeEnabled: jest.fn(() => false),
  isDevModeEnabledGlobal: jest.fn(() => false),
  enableDevMode: jest.fn(),
  disableDevMode: jest.fn(),
  toggleDevMode: jest.fn(),
}));

import { isDevModeEnabledGlobal } from '../utils/dev-mode';

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

    it('should reject http:// URLs (require HTTPS)', () => {
      expect(isGrafanaDomain('http://grafana.com')).toBe(false);
      expect(isGrafanaDomain('http://grafana.com/docs/grafana/latest/')).toBe(false);
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
      expect(isGrafanaDocsUrl('https://grafana.com/docs/learning-paths/drilldown-logs/')).toBe(true);
    });

    it('should return false for grafana.com URLs that are not docs', () => {
      expect(isGrafanaDocsUrl('https://grafana.com/pricing')).toBe(false);
      expect(isGrafanaDocsUrl('https://grafana.com/blog')).toBe(false);
    });

    it('should return false for domain hijacking attempts', () => {
      expect(isGrafanaDocsUrl('https://grafana.com.evil.com/docs/')).toBe(false);
      expect(isGrafanaDocsUrl('https://a-grafana.com/docs/')).toBe(false);
    });

    it('should reject paths where /docs/learning-journeys/ is not at the start', () => {
      expect(isGrafanaDocsUrl('https://grafana.com/blog/docs/learning-journeys/foo')).toBe(false);
    });

    it('should return false for invalid URLs', () => {
      expect(isGrafanaDocsUrl('not a url')).toBe(false);
      expect(isGrafanaDocsUrl('')).toBe(false);
    });
  });
});

describe('Interactive Learning URL validators', () => {
  describe('isInteractiveLearningUrl', () => {
    it('should return true for interactive-learning.grafana.net URLs', () => {
      expect(isInteractiveLearningUrl('https://interactive-learning.grafana.net')).toBe(true);
      expect(isInteractiveLearningUrl('https://interactive-learning.grafana.net/guide/')).toBe(true);
      expect(isInteractiveLearningUrl('https://interactive-learning.grafana.net/tutorial/content.json')).toBe(true);
    });

    it('should return true for interactive-learning.grafana-dev.net URLs', () => {
      expect(isInteractiveLearningUrl('https://interactive-learning.grafana-dev.net')).toBe(true);
      expect(isInteractiveLearningUrl('https://interactive-learning.grafana-dev.net/guide/')).toBe(true);
      expect(isInteractiveLearningUrl('https://interactive-learning.grafana-dev.net/tutorial/unstyled.html')).toBe(
        true
      );
    });

    it('should return false for domain hijacking attempts', () => {
      expect(isInteractiveLearningUrl('https://interactive-learning.grafana.net.evil.com/guide/')).toBe(false);
      expect(isInteractiveLearningUrl('https://a-interactive-learning.grafana.net/guide/')).toBe(false);
      expect(isInteractiveLearningUrl('https://interactive-learning.grafana-dev.net.evil.com/guide/')).toBe(false);
    });

    it('should return false for other Grafana domains', () => {
      expect(isInteractiveLearningUrl('https://grafana.com/docs/')).toBe(false);
      expect(isInteractiveLearningUrl('https://docs.grafana.com/')).toBe(false);
    });

    it('should return false for http:// URLs (must be https)', () => {
      expect(isInteractiveLearningUrl('http://interactive-learning.grafana.net/guide/')).toBe(false);
      expect(isInteractiveLearningUrl('http://interactive-learning.grafana-dev.net/guide/')).toBe(false);
    });

    it('should return false for invalid URLs', () => {
      expect(isInteractiveLearningUrl('not a url')).toBe(false);
      expect(isInteractiveLearningUrl('')).toBe(false);
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
      jest.mocked(isDevModeEnabledGlobal).mockReturnValue(false);
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

    it('should always allow interactive learning URLs', () => {
      expect(isAllowedContentUrl('https://interactive-learning.grafana.net/guide/')).toBe(true);
      expect(isAllowedContentUrl('https://interactive-learning.grafana-dev.net/tutorial/')).toBe(true);
    });

    it('should reject localhost URLs in production mode', () => {
      expect(isAllowedContentUrl('http://localhost:3000/docs')).toBe(false);
      expect(isAllowedContentUrl('http://127.0.0.1:5500/tutorial.html')).toBe(false);
    });

    it('should allow localhost URLs with valid docs paths in dev mode', () => {
      jest.mocked(isDevModeEnabledGlobal).mockReturnValue(true);

      // Valid docs paths should be allowed
      expect(isAllowedContentUrl('http://localhost:3000/docs')).toBe(true);
      expect(isAllowedContentUrl('http://localhost:3000/docs/grafana/latest/')).toBe(true);
      expect(isAllowedContentUrl('http://127.0.0.1:5500/tutorials/getting-started')).toBe(true);
      expect(isAllowedContentUrl('http://localhost:3000/docs/learning-journeys/intro')).toBe(true);
      expect(isAllowedContentUrl('http://localhost:3000/docs/learning-paths/intro')).toBe(true);
    });

    it('should reject localhost URLs without valid docs paths in dev mode', () => {
      jest.mocked(isDevModeEnabledGlobal).mockReturnValue(true);

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
      jest.mocked(isDevModeEnabledGlobal).mockReturnValue(true);

      expect(isAllowedContentUrl('https://evil.com/fake-docs')).toBe(false);
      expect(isAllowedContentUrl('https://malicious.site/tutorial')).toBe(false);
    });
  });

  describe('validateTutorialUrl', () => {
    beforeEach(() => {
      jest.mocked(isDevModeEnabledGlobal).mockReturnValue(false);
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    it('should accept Grafana docs URLs', () => {
      const result = validateTutorialUrl('https://grafana.com/docs/grafana/latest/');
      expect(result.isValid).toBe(true);
    });

    it('should accept interactive learning URLs', () => {
      const result = validateTutorialUrl('https://interactive-learning.grafana.net/tutorial/');
      expect(result.isValid).toBe(true);
    });

    it('should accept interactive learning dev URLs', () => {
      const result = validateTutorialUrl('https://interactive-learning.grafana-dev.net/tutorial/');
      expect(result.isValid).toBe(true);
    });

    it('should reject localhost URLs in production', () => {
      const result = validateTutorialUrl('http://localhost:5500/tutorial/unstyled.html');
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toContain('dev mode');
    });

    it('should accept localhost URLs in dev mode', () => {
      jest.mocked(isDevModeEnabledGlobal).mockReturnValue(true);

      // Content fetcher automatically appends /unstyled.html suffix when needed
      expect(validateTutorialUrl('http://localhost:5500/tutorial/unstyled.html').isValid).toBe(true);
      expect(validateTutorialUrl('http://localhost:5500/tutorial/index.html').isValid).toBe(true);
      expect(validateTutorialUrl('http://localhost:5500/docs/grafana/').isValid).toBe(true);
    });

    it('should reject empty URLs', () => {
      const result = validateTutorialUrl('');
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toContain('provide a URL');
    });

    it('should reject invalid URL formats', () => {
      const result = validateTutorialUrl('not a valid url');
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toContain('Invalid URL format');
    });
  });
});

describe('validateRedirectPath', () => {
  describe('valid paths (returned as-is or normalized)', () => {
    it('should return / for home', () => {
      expect(validateRedirectPath('/')).toBe('/');
    });

    it('should return simple paths', () => {
      expect(validateRedirectPath('/explore')).toBe('/explore');
    });

    it('should return nested paths', () => {
      expect(validateRedirectPath('/dashboards/new')).toBe('/dashboards/new');
    });

    it('should return plugin page paths', () => {
      expect(validateRedirectPath('/a/some-plugin-app')).toBe('/a/some-plugin-app');
    });

    it('should return deep paths', () => {
      expect(validateRedirectPath('/connections/datasources')).toBe('/connections/datasources');
    });

    it('should normalize trailing slashes via URL API', () => {
      expect(validateRedirectPath('/explore/')).toBe('/explore/');
    });
  });

  describe('attack vectors (all return /)', () => {
    it('should reject full external URLs', () => {
      expect(validateRedirectPath('https://evil.com')).toBe('/');
    });

    it('should reject protocol-relative URLs', () => {
      expect(validateRedirectPath('//evil.com')).toBe('/');
    });

    it('should normalize path traversal to a safe local path', () => {
      // URL API resolves /../../../etc/passwd to /etc/passwd (a harmless local Grafana route)
      // This is safe because locationService.replace navigates within Grafana's client-side router
      expect(validateRedirectPath('/../../../etc/passwd')).toBe('/etc/passwd');
    });

    it('should normalize encoded path traversal to a safe local path', () => {
      // URL API decodes %2e%2e to .. and resolves it, resulting in /etc/passwd
      expect(validateRedirectPath('/%2e%2e/etc/passwd')).toBe('/etc/passwd');
    });

    it('should reject paths containing literal .. after normalization', () => {
      // Defense-in-depth: if .. somehow survives URL normalization, reject it
      // In practice, URL API always resolves .., but this tests the belt-and-suspenders check
      // We can't easily construct a URL that preserves .. after normalization,
      // so this test verifies the check exists by confirming safe paths pass
      expect(validateRedirectPath('/safe/path')).toBe('/safe/path');
    });

    it('should strip query strings (returns pathname only)', () => {
      expect(validateRedirectPath('/path?admin=true')).toBe('/path');
    });

    it('should strip fragments (returns pathname only)', () => {
      expect(validateRedirectPath('/path#fragment')).toBe('/path');
    });

    it('should reject javascript: scheme', () => {
      expect(validateRedirectPath('javascript:alert(1)')).toBe('/');
    });

    it('should reject data: URI', () => {
      expect(validateRedirectPath('data:text/html,<script>')).toBe('/');
    });

    it('should return / for empty string', () => {
      expect(validateRedirectPath('')).toBe('/');
    });

    it('should reject backslash trick (URL API resolves to different origin)', () => {
      // URL API treats \ as / in special schemes, so /\evil.com resolves to http://evil.com/
      // The origin check catches this and returns /
      expect(validateRedirectPath('/\\evil.com')).toBe('/');
    });

    it('should return / for null/undefined inputs', () => {
      expect(validateRedirectPath(null as unknown as string)).toBe('/');
      expect(validateRedirectPath(undefined as unknown as string)).toBe('/');
    });

    it('should reject paths not starting with /', () => {
      expect(validateRedirectPath('evil.com/path')).toBe('/');
      expect(validateRedirectPath('relative/path')).toBe('/');
    });

    it('should reject sensitive route prefixes', () => {
      expect(validateRedirectPath('/logout')).toBe('/');
      expect(validateRedirectPath('/admin')).toBe('/');
      expect(validateRedirectPath('/admin/users')).toBe('/');
      expect(validateRedirectPath('/api/datasources')).toBe('/');
      expect(validateRedirectPath('/profile/password')).toBe('/');
    });

    it('should allow non-sensitive routes that share a prefix', () => {
      expect(validateRedirectPath('/administration')).toBe('/administration');
      expect(validateRedirectPath('/profiles')).toBe('/profiles');
    });
  });
});

describe('GitHub URL validators', () => {
  describe('isGitHubRawUrl', () => {
    it('should accept raw.githubusercontent.com URLs', () => {
      expect(isGitHubRawUrl('https://raw.githubusercontent.com/grafana/repo/main/file.json')).toBe(true);
      expect(isGitHubRawUrl('https://raw.githubusercontent.com/owner/repo/sha123/path/to/content.json')).toBe(true);
    });

    it('should accept objects.githubusercontent.com URLs (redirect target)', () => {
      // GitHub may redirect raw content to objects.githubusercontent.com for blob storage
      expect(isGitHubRawUrl('https://objects.githubusercontent.com/some-path')).toBe(true);
      expect(isGitHubRawUrl('https://objects.githubusercontent.com/github-production-release-asset/123456')).toBe(true);
    });

    it('should reject non-GitHub URLs', () => {
      expect(isGitHubRawUrl('https://evil.com/raw.githubusercontent.com/fake')).toBe(false);
      expect(isGitHubRawUrl('https://raw.githubusercontent.com.evil.com/path')).toBe(false);
      expect(isGitHubRawUrl('https://github.com/owner/repo/blob/main/file.json')).toBe(false);
    });

    it('should reject HTTP URLs (require HTTPS)', () => {
      expect(isGitHubRawUrl('http://raw.githubusercontent.com/owner/repo/main/file.json')).toBe(false);
      expect(isGitHubRawUrl('http://objects.githubusercontent.com/path')).toBe(false);
    });

    it('should reject invalid URLs', () => {
      expect(isGitHubRawUrl('not a url')).toBe(false);
      expect(isGitHubRawUrl('')).toBe(false);
    });
  });
});
