import { prepareGuideLaunch } from './prepare-guide-launch';
import { loadDocsTabContentResult } from './docs-tab-loader';
import { fetchPackageInfoFromUrl, isPackageContentUrl } from '../../../docs-retrieval';
import { inlineSnippetRefsInGuideWithStatus } from '../../../snippet-engine';
import type { JsonGuide } from '../../../types/json-guide.types';
import type { RawContent } from '../../../types/content.types';

jest.mock('./docs-tab-loader', () => ({
  loadDocsTabContentResult: jest.fn(),
}));

jest.mock('../../../docs-retrieval', () => ({
  fetchPackageInfoFromUrl: jest.fn(),
  isPackageContentUrl: jest.fn(() => false),
}));

jest.mock('../../../snippet-engine', () => ({
  // Default: passthrough with no failed refs. Individual tests override.
  inlineSnippetRefsInGuideWithStatus: jest.fn(async (guide: JsonGuide) => ({ guide, unresolvedSnippetIds: [] })),
}));

const mockLoad = loadDocsTabContentResult as jest.Mock;
const mockIsPackage = isPackageContentUrl as jest.Mock;
const mockFetchPackageInfo = fetchPackageInfoFromUrl as jest.Mock;
const mockInline = inlineSnippetRefsInGuideWithStatus as jest.Mock;

function rawContentFor(guide: JsonGuide, url = 'https://grafana.com/docs/x'): RawContent {
  return {
    content: JSON.stringify(guide),
    metadata: { title: guide.title },
    type: 'interactive',
    url,
    lastFetched: '2026-07-28T00:00:00.000Z',
  };
}

function fetchResolves(guide: JsonGuide, url?: string) {
  mockLoad.mockResolvedValue({ content: rawContentFor(guide, url) });
}

describe('prepareGuideLaunch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsPackage.mockReturnValue(false);
    mockInline.mockImplementation(async (guide: JsonGuide) => ({ guide, unresolvedSnippetIds: [] }));
  });

  it('fetches the content exactly once', async () => {
    fetchResolves({ id: 'g', title: 'g', blocks: [{ type: 'markdown', content: 'hi' }] });
    await prepareGuideLaunch('https://grafana.com/docs/x', { title: 'X', source: 'home_page' });
    expect(mockLoad).toHaveBeenCalledTimes(1);
  });

  it('classifies prose as not requiring the Grafana UI and re-serializes the expanded guide', async () => {
    const guide: JsonGuide = { id: 'g', title: 'g', blocks: [{ type: 'markdown', content: 'read me' }] };
    fetchResolves(guide);

    const result = await prepareGuideLaunch('https://grafana.com/docs/x', { title: 'X', source: 'home_page' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.launch.requiresGrafanaUi).toBe(false);
      expect(result.launch.source).toBe('home_page');
      expect(JSON.parse(result.launch.preparedContent.content)).toEqual(guide);
    }
  });

  it('classifies a guide with a Grafana-driving action as requiring the Grafana UI', async () => {
    fetchResolves({ id: 'g', title: 'g', blocks: [{ type: 'interactive', action: 'button', content: 'go' }] });

    const result = await prepareGuideLaunch('https://grafana.com/docs/x', { title: 'X', source: 'home_page' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.launch.requiresGrafanaUi).toBe(true);
    }
  });

  it('fails safe to requiresGrafanaUi when a snippet could not be resolved', async () => {
    const proseGuide: JsonGuide = { id: 'g', title: 'g', blocks: [{ type: 'markdown', content: 'prose only' }] };
    fetchResolves(proseGuide);
    // Expanded guide is pure prose, but a ref failed — never hide a possible action.
    mockInline.mockResolvedValue({ guide: proseGuide, unresolvedSnippetIds: ['missing-snippet'] });

    const result = await prepareGuideLaunch('https://grafana.com/docs/x', { title: 'X', source: 'home_page' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.launch.requiresGrafanaUi).toBe(true);
    }
  });

  it('returns a failure result (no surface committed) when the fetch fails', async () => {
    mockLoad.mockResolvedValue({ content: null, error: 'not found' });

    const result = await prepareGuideLaunch('https://grafana.com/docs/x', { title: 'X', source: 'home_page' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('not found');
    }
  });

  it('returns a failure result when the fetched content is not parseable JSON', async () => {
    mockLoad.mockResolvedValue({
      content: { content: 'not json', metadata: { title: 'x' }, type: 'interactive', url: 'u', lastFetched: 't' },
    });

    const result = await prepareGuideLaunch('https://grafana.com/docs/x', { title: 'X', source: 'home_page' });

    expect(result.ok).toBe(false);
  });

  it('derives package info for a package URL and fetches only once', async () => {
    mockIsPackage.mockReturnValue(true);
    const packageInfo = { packageId: 'pkg', packageManifest: { type: 'path' } };
    mockFetchPackageInfo.mockResolvedValue(packageInfo);
    fetchResolves({ id: 'g', title: 'g', blocks: [] }, 'https://interactive-learning.grafana.net/x/content.json');

    const result = await prepareGuideLaunch('https://interactive-learning.grafana.net/x/content.json', {
      title: 'X',
      source: 'home_page',
    });

    expect(mockFetchPackageInfo).toHaveBeenCalledTimes(1);
    expect(mockLoad).toHaveBeenCalledTimes(1);
    expect(mockLoad).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ packageInfo }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.launch.packageInfo).toBe(packageInfo);
    }
  });

  it('does not derive package info for a non-package URL', async () => {
    fetchResolves({ id: 'g', title: 'g', blocks: [] });
    await prepareGuideLaunch('https://grafana.com/docs/x', { title: 'X', source: 'home_page' });
    expect(mockFetchPackageInfo).not.toHaveBeenCalled();
  });

  it('marks a learning-journey URL with the journey type discriminator', async () => {
    fetchResolves({ id: 'g', title: 'g', blocks: [] }, 'https://grafana.com/docs/learning-journeys/x/');

    const result = await prepareGuideLaunch('https://grafana.com/docs/learning-journeys/x/', {
      title: 'X',
      source: 'home_page',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.launch.type).toBe('learning-journey');
    }
  });
});
