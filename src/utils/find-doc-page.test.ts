jest.mock('../security', () => ({
  isGrafanaDocsUrl: jest.fn(() => false),
  isInteractiveLearningUrl: jest.fn(() => false),
}));

import { isInteractiveLearningUrl } from '../security';
import { findDocPage } from './find-doc-page';

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

  describe('backend-guide: prefix (raw form, e.g. ?doc= from auto-dock or copy-link)', () => {
    it('returns a backend-guide DocPage for a valid resource name', () => {
      // The fullscreen "Copy workshop link" copies the tab's baseUrl verbatim,
      // which for custom guides is `backend-guide:...` — make sure that round
      // trip works without requiring the api: shorthand.
      expect(findDocPage('backend-guide:my-guide-a3f9')).toEqual({
        type: 'docs-page',
        url: 'backend-guide:my-guide-a3f9',
        title: 'my-guide-a3f9',
      });
    });

    it('trims whitespace from the resource name', () => {
      expect(findDocPage('backend-guide:  spaced-name  ')).toEqual({
        type: 'docs-page',
        url: 'backend-guide:spaced-name',
        title: 'spaced-name',
      });
    });

    it('returns null for backend-guide: with no resource name', () => {
      expect(findDocPage('backend-guide:')).toBeNull();
    });

    it('returns null for backend-guide: with only whitespace', () => {
      expect(findDocPage('backend-guide:   ')).toBeNull();
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

  describe('interactive CDN URLs', () => {
    it('returns interactive for allowed private interactive-learning URL', () => {
      const mockIsInteractiveLearningURL = isInteractiveLearningUrl as jest.MockedFunction<typeof isInteractiveLearningUrl>;
      mockIsInteractiveLearningURL.mockReturnValueOnce(true);

      expect(findDocPage('https://interactive-learning-private.grafana-dev.net/internal/e2e/guide/content.json')).toEqual({
        type: 'interactive',
        url: 'https://interactive-learning-private.grafana-dev.net/internal/e2e/guide/content.json',
        title: 'Guide',
      });
    });

    it('returns null when interactive-learning host is rejected by validator', () => {
      const mockIsInteractiveLearningURL = isInteractiveLearningUrl as jest.MockedFunction<typeof isInteractiveLearningUrl>;
      mockIsInteractiveLearningURL.mockReturnValueOnce(false);

      expect(findDocPage('https://interactive-learning-private.grafana-dev.net/internal/e2e/guide/content.json')).toBeNull();
    });
  });

  describe('unrecognised input', () => {
    it('returns null for an unknown prefix', () => {
      expect(findDocPage('unknown:something')).toBeNull();
    });
  });
});
