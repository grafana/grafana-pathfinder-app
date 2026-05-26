import { loadTabContentResult, UNRESOLVED_PACKAGE_ERROR } from './docs-tab-loader';
import { fetchContent, fetchPackageById, fetchPackageContent } from '../../../docs-retrieval';

jest.mock('../../../docs-retrieval', () => ({
  fetchContent: jest.fn(),
  fetchPackageById: jest.fn(),
  fetchPackageContent: jest.fn(),
}));

const mockFetchContent = jest.mocked(fetchContent);
const mockFetchPackageById = jest.mocked(fetchPackageById);
const mockFetchPackageContent = jest.mocked(fetchPackageContent);

describe('loadTabContentResult', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('mode: docs', () => {
    it('uses fetchPackageContent when package-backed contentUrl is present', async () => {
      mockFetchPackageContent.mockResolvedValueOnce({
        content: null,
        error: 'package fetch attempted',
        errorType: 'other',
      });

      const packageManifest = { id: 'alerting-101', type: 'guide' };
      await loadTabContentResult('https://interactive-learning.grafana.net/packages/alerting-101/content.json', {
        mode: 'docs',
        packageInfo: {
          packageId: 'alerting-101',
          packageManifest,
        },
      });

      expect(mockFetchPackageContent).toHaveBeenCalledWith(
        'https://interactive-learning.grafana.net/packages/alerting-101/content.json',
        packageManifest,
        undefined
      );
      expect(mockFetchPackageById).not.toHaveBeenCalled();
      expect(mockFetchContent).not.toHaveBeenCalled();
    });

    it('falls back to fetchPackageById when package URL is empty but packageId is known', async () => {
      mockFetchPackageById.mockResolvedValueOnce({
        content: null,
        error: 'resolver attempted',
        errorType: 'other',
      });

      const packageManifest = { id: 'alerting-101', type: 'guide' };
      await loadTabContentResult('', {
        mode: 'docs',
        packageInfo: {
          packageId: 'alerting-101',
          packageManifest,
        },
      });

      expect(mockFetchPackageById).toHaveBeenCalledWith('alerting-101', packageManifest);
      expect(mockFetchPackageContent).not.toHaveBeenCalled();
      expect(mockFetchContent).not.toHaveBeenCalled();
    });

    it('returns a controlled not-found error for unresolved packages without a URL or packageId', async () => {
      const result = await loadTabContentResult('', {
        mode: 'docs',
        packageInfo: {
          packageManifest: { type: 'guide' },
        },
      });

      expect(result).toEqual({
        content: null,
        error: UNRESOLVED_PACKAGE_ERROR,
        errorType: 'not-found',
      });
      expect(mockFetchPackageById).not.toHaveBeenCalled();
      expect(mockFetchPackageContent).not.toHaveBeenCalled();
      expect(mockFetchContent).not.toHaveBeenCalled();
    });

    it('uses fetchContent for non-package docs opens, forwarding skipReadyToBegin', async () => {
      mockFetchContent.mockResolvedValueOnce({
        content: null,
        error: 'docs fetch attempted',
        errorType: 'other',
      });

      await loadTabContentResult('https://grafana.com/docs/grafana/latest/alerting/', {
        mode: 'docs',
        skipReadyToBegin: true,
      });

      expect(mockFetchContent).toHaveBeenCalledWith('https://grafana.com/docs/grafana/latest/alerting/', {
        skipReadyToBegin: true,
      });
      expect(mockFetchPackageById).not.toHaveBeenCalled();
      expect(mockFetchPackageContent).not.toHaveBeenCalled();
    });
  });

  describe('mode: journey', () => {
    it('uses fetchContent without options for journey milestone opens', async () => {
      mockFetchContent.mockResolvedValueOnce({
        content: null,
        error: 'journey fetch attempted',
        errorType: 'other',
      });

      await loadTabContentResult('https://grafana.com/tutorials/foo/milestone-1', { mode: 'journey' });

      // Journey path passes no options: the "ready to begin" gate is for
      // the docs-loader cover page, not for milestone navigation.
      expect(mockFetchContent).toHaveBeenCalledWith('https://grafana.com/tutorials/foo/milestone-1');
      expect(mockFetchPackageById).not.toHaveBeenCalled();
      expect(mockFetchPackageContent).not.toHaveBeenCalled();
    });

    it('ignores packageInfo on the journey branch (panel never supplies it)', async () => {
      mockFetchContent.mockResolvedValueOnce({
        content: null,
        error: 'journey fetch attempted',
        errorType: 'other',
      });

      await loadTabContentResult('https://grafana.com/tutorials/foo/milestone-1', {
        mode: 'journey',
        // Defensive: even if a caller leaks packageInfo in, the journey
        // branch must not route through the package fetchers — that would
        // skip the milestone-context enrichment in the panel.
        packageInfo: { packageManifest: { type: 'guide' } },
      });

      expect(mockFetchContent).toHaveBeenCalledWith('https://grafana.com/tutorials/foo/milestone-1');
      expect(mockFetchPackageById).not.toHaveBeenCalled();
      expect(mockFetchPackageContent).not.toHaveBeenCalled();
    });

    it('returns a controlled error when URL is empty (panel should have caught this)', async () => {
      const result = await loadTabContentResult('', { mode: 'journey' });

      expect(result).toEqual({
        content: null,
        error: 'Invalid URL provided',
        errorType: 'other',
      });
      expect(mockFetchContent).not.toHaveBeenCalled();
      expect(mockFetchPackageById).not.toHaveBeenCalled();
      expect(mockFetchPackageContent).not.toHaveBeenCalled();
    });
  });
});
