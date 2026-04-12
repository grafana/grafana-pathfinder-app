jest.mock('../security', () => ({
  isGrafanaDocsUrl: jest.fn(() => false),
  isInteractiveLearningUrl: jest.fn(() => false),
  isGrafanaGitHubRawUrl: jest.fn(() => false),
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

  describe('unrecognised input', () => {
    it('returns null for an unknown prefix', () => {
      expect(findDocPage('unknown:something')).toBeNull();
    });
  });
});
