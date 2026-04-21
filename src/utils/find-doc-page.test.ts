jest.mock('../security', () => ({
  isGrafanaDocsUrl: jest.fn(() => false),
  isInteractiveLearningUrl: jest.fn(() => false),
  isGrafanaGitHubRawUrl: jest.fn(() => false),
}));

jest.mock('../security/url-validator', () => ({
  parseUrlSafely: jest.fn((url: string) => {
    try {
      return new URL(url);
    } catch {
      return null;
    }
  }),
  isLocalhostUrl: jest.fn((url: string) => {
    try {
      const parsed = new URL(url);
      return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    } catch {
      return false;
    }
  }),
}));

const mockIsDevModeEnabledGlobal = jest.fn(() => false);
jest.mock('./dev-mode', () => ({
  isDevModeEnabledGlobal: () => mockIsDevModeEnabledGlobal(),
}));

import { findDocPage } from './find-doc-page';
import { isGrafanaGitHubRawUrl } from '../security';

describe('findDocPage', () => {
  describe('api: prefix (custom backend guides)', () => {
    it('returns a backend-guide DocPage for a valid resource name', () => {
      expect(findDocPage('api:my-guide-a3f9')).toEqual({
        type: 'docs-page',
        url: 'backend-guide:my-guide-a3f9',
        title: 'my-guide-a3f9',
      });
    });

    it('trims whitespace from the resource name', () => {
      expect(findDocPage('api:  spaced-name  ')).toEqual({
        type: 'docs-page',
        url: 'backend-guide:spaced-name',
        title: 'spaced-name',
      });
    });

    it('returns null for api: with no resource name', () => {
      expect(findDocPage('api:')).toBeNull();
    });

    it('returns null for api: with only whitespace', () => {
      expect(findDocPage('api:   ')).toBeNull();
    });

    it('passes through resource names with special characters (encoding handled downstream)', () => {
      const result = findDocPage('api:name-with/slash');
      expect(result).toEqual({
        type: 'docs-page',
        url: 'backend-guide:name-with/slash',
        title: 'name-with/slash',
      });
    });
  });

  describe('null/empty input', () => {
    it('returns null for empty string', () => {
      expect(findDocPage('')).toBeNull();
    });

    it('returns null for whitespace-only string', () => {
      expect(findDocPage('   ')).toBeNull();
    });
  });

  describe('remote: prefix (GitHub-hosted guides)', () => {
    beforeEach(() => {
      (isGrafanaGitHubRawUrl as jest.Mock).mockReturnValue(false);
    });

    it('returns interactive DocPage for valid Grafana GitHub URL', () => {
      (isGrafanaGitHubRawUrl as jest.Mock).mockReturnValue(true);
      const url = 'https://raw.githubusercontent.com/grafana/repo/main/my-guide.json';
      expect(findDocPage(`remote:${url}`)).toEqual({
        type: 'interactive',
        url,
        title: 'My Guide',
      });
    });

    it('derives title from last path segment, stripping extension', () => {
      (isGrafanaGitHubRawUrl as jest.Mock).mockReturnValue(true);
      const url = 'https://raw.githubusercontent.com/grafana/repo/main/grafana-13-tour.json';
      expect(findDocPage(`remote:${url}`)?.title).toBe('Grafana 13 Tour');
    });

    it('handles .html extension', () => {
      (isGrafanaGitHubRawUrl as jest.Mock).mockReturnValue(true);
      const url = 'https://raw.githubusercontent.com/grafana/repo/main/intro.html';
      expect(findDocPage(`remote:${url}`)?.title).toBe('Intro');
    });

    it('returns null for remote: with empty URL', () => {
      expect(findDocPage('remote:')).toBeNull();
      expect(findDocPage('remote:   ')).toBeNull();
    });

    it('returns null when URL fails security validation', () => {
      (isGrafanaGitHubRawUrl as jest.Mock).mockReturnValue(false);
      expect(findDocPage('remote:https://raw.githubusercontent.com/evil-org/repo/main/guide.json')).toBeNull();
    });
  });

  describe('url: prefix (dev-mode URL packages)', () => {
    afterEach(() => {
      mockIsDevModeEnabledGlobal.mockReturnValue(false);
    });

    it('returns url-package DocPage for valid localhost URL in dev mode', () => {
      mockIsDevModeEnabledGlobal.mockReturnValue(true);
      expect(findDocPage('url:http://localhost:8080/my-package/')).toEqual({
        type: 'interactive',
        url: 'url-package:http://localhost:8080/my-package/',
        title: 'My Package',
      });
    });

    it('normalizes URL by appending trailing slash', () => {
      mockIsDevModeEnabledGlobal.mockReturnValue(true);
      const result = findDocPage('url:http://localhost:8080/my-package');
      expect(result?.url).toBe('url-package:http://localhost:8080/my-package/');
    });

    it('preserves existing trailing slash', () => {
      mockIsDevModeEnabledGlobal.mockReturnValue(true);
      const result = findDocPage('url:http://localhost:8080/my-package/');
      expect(result?.url).toBe('url-package:http://localhost:8080/my-package/');
    });

    it('derives title from last path segment', () => {
      mockIsDevModeEnabledGlobal.mockReturnValue(true);
      expect(findDocPage('url:http://localhost:3333/grafana-101-tour/')?.title).toBe('Grafana 101 Tour');
    });

    it('returns null when dev mode is disabled', () => {
      mockIsDevModeEnabledGlobal.mockReturnValue(false);
      expect(findDocPage('url:http://localhost:8080/my-package/')).toBeNull();
    });

    it('returns null for non-localhost URL even in dev mode', () => {
      mockIsDevModeEnabledGlobal.mockReturnValue(true);
      expect(findDocPage('url:https://evil.com/my-package/')).toBeNull();
    });

    it('returns null for url: with empty URL', () => {
      mockIsDevModeEnabledGlobal.mockReturnValue(true);
      expect(findDocPage('url:')).toBeNull();
      expect(findDocPage('url:   ')).toBeNull();
    });

    it('returns null for invalid URL format', () => {
      mockIsDevModeEnabledGlobal.mockReturnValue(true);
      expect(findDocPage('url:not-a-url')).toBeNull();
    });

    it('accepts 127.0.0.1 as localhost', () => {
      mockIsDevModeEnabledGlobal.mockReturnValue(true);
      const result = findDocPage('url:http://127.0.0.1:9000/pkg/');
      expect(result).not.toBeNull();
      expect(result?.url).toBe('url-package:http://127.0.0.1:9000/pkg/');
    });
  });

  describe('unrecognised input', () => {
    it('returns null for an unknown prefix', () => {
      expect(findDocPage('unknown:something')).toBeNull();
    });
  });
});
