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
      packageManifest,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
    );
    expect(mockFetchPackageById).not.toHaveBeenCalled();
    expect(mockFetchContent).not.toHaveBeenCalled();
  });

  it('threads the recommendation-level repository through to fetchPackageContent', async () => {
    mockFetchPackageContent.mockResolvedValueOnce({ content: null, error: 'x', errorType: 'other' });

    const packageManifest = { id: 'alerting-101', type: 'guide' };
    await loadDocsTabContentResult('https://interactive-learning.grafana.net/packages/alerting-101/content.json', {
      packageInfo: { packageId: 'alerting-101', packageManifest, repository: 'app-platform' },
    });

    expect(mockFetchPackageContent).toHaveBeenCalledWith(
      'https://interactive-learning.grafana.net/packages/alerting-101/content.json',
      packageManifest,
      undefined,
      'app-platform',
      undefined,
      undefined,
      undefined,
      undefined
    );
  });

  // Regression: the manifest guide id a click target already carried
  // (GuideList's current row, the cover-page CTA) must reach
  // fetchPackageContent so it can classify the load structurally instead of
  // comparing resolved URLs.
  it('threads explicitGuideId through to fetchPackageContent', async () => {
    mockFetchPackageContent.mockResolvedValueOnce({ content: null, error: 'x', errorType: 'other' });

    const packageManifest = { id: 'alerting-101', type: 'path', milestones: ['step-1'] };
    await loadDocsTabContentResult('https://interactive-learning.grafana.net/packages/step-1/content.json', {
      packageInfo: { packageId: 'alerting-101', packageManifest },
      explicitGuideId: 'step-1',
    });

    expect(mockFetchPackageContent).toHaveBeenCalledWith(
      'https://interactive-learning.grafana.net/packages/step-1/content.json',
      packageManifest,
      undefined,
      undefined,
      undefined,
      'step-1',
      undefined,
      undefined
    );
  });

  // The cover page's own base URL, when docs-panel.tsx already knows it
  // (the tab's outgoing content, right before a track-member click
  // overwrites it), must reach fetchPackageContent so a transient failure
  // of that request's OWN independent re-resolve doesn't silently drop the
  // track-only guide's completion.
  it('threads knownBaseUrl through to fetchPackageContent', async () => {
    mockFetchPackageContent.mockResolvedValueOnce({ content: null, error: 'x', errorType: 'other' });

    const packageManifest = { id: 'the-path', type: 'path', tracks: [{ trackId: 'builder', guides: ['t-only'] }] };
    await loadDocsTabContentResult('https://interactive-learning.grafana.net/packages/t-only/content.json', {
      packageInfo: { packageId: 'the-path', packageManifest },
      explicitGuideId: 't-only',
      knownBaseUrl: 'https://interactive-learning.grafana.net/packages/the-path/content.json',
    });

    expect(mockFetchPackageContent).toHaveBeenCalledWith(
      'https://interactive-learning.grafana.net/packages/t-only/content.json',
      packageManifest,
      undefined,
      undefined,
      undefined,
      't-only',
      'https://interactive-learning.grafana.net/packages/the-path/content.json',
      undefined
    );
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

    expect(mockFetchPackageById).toHaveBeenCalledWith('alerting-101', packageManifest, undefined, undefined);
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
      diagnostic: { source: 'other', stage: 'resolve', reason: 'not-found' },
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

it('classifies an empty docs URL before attempting a fetch', async () => {
  const result = await loadDocsTabContentResult('  ');
  expect(result.diagnostic).toEqual({ source: 'other', stage: 'resolve', reason: 'invalid-url' });
});
