import { loadDocsTabContentResult, UNRESOLVED_PACKAGE_ERROR } from './docs-tab-loader';
import { fetchContent, fetchPackageById, fetchPackageContent } from '../../../docs-retrieval';

jest.mock('../../../docs-retrieval', () => ({
  fetchContent: jest.fn(),
  fetchPackageById: jest.fn(),
  fetchPackageContent: jest.fn(),
}));

const mockFetchContent = jest.mocked(fetchContent);
const mockFetchPackageById = jest.mocked(fetchPackageById);
const mockFetchPackageContent = jest.mocked(fetchPackageContent);

describe('loadDocsTabContentResult', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses fetchPackageContent when package-backed contentUrl is present', async () => {
    mockFetchPackageContent.mockResolvedValueOnce({
      content: null,
      error: 'package fetch attempted',
      errorType: 'other',
    });

    const packageManifest = { id: 'alerting-101', type: 'guide' };
    await loadDocsTabContentResult('https://interactive-learning.grafana.net/packages/alerting-101/content.json', {
      packageInfo: {
        packageId: 'alerting-101',
        packageManifest,
      },
    });

    expect(mockFetchPackageContent).toHaveBeenCalledWith(
      'https://interactive-learning.grafana.net/packages/alerting-101/content.json',
      packageManifest
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
    await loadDocsTabContentResult('', {
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
    const result = await loadDocsTabContentResult('', {
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

  it('uses fetchContent for non-package docs opens', async () => {
    mockFetchContent.mockResolvedValueOnce({
      content: null,
      error: 'docs fetch attempted',
      errorType: 'other',
    });

    await loadDocsTabContentResult('https://grafana.com/docs/grafana/latest/alerting/', {
      skipReadyToBegin: true,
    });

    expect(mockFetchContent).toHaveBeenCalledWith('https://grafana.com/docs/grafana/latest/alerting/', {
      skipReadyToBegin: true,
    });
    expect(mockFetchPackageById).not.toHaveBeenCalled();
    expect(mockFetchPackageContent).not.toHaveBeenCalled();
  });
});
