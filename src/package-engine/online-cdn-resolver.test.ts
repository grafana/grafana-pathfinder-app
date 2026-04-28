jest.mock('../lib/package-recommendations-client', () => {
  const actual = jest.requireActual('../lib/package-recommendations-client');
  return {
    ...actual,
    fetchOnlinePackageRecommendations: jest.fn(),
  };
});

import { fetchOnlinePackageRecommendations } from '../lib/package-recommendations-client';

import { OnlineCdnPackageResolver } from './online-cdn-resolver';

const baseUrl = 'https://interactive-learning.grafana.net/packages/';
const sampleEntry = {
  id: 'github-visualize-business-value',
  path: 'github-visualize-business-value/',
  title: 'Business value',
  type: 'guide',
  manifest: {
    id: 'github-visualize-business-value',
    type: 'guide',
    description: 'Why visualize GitHub data?',
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  (fetchOnlinePackageRecommendations as jest.Mock).mockResolvedValue({
    baseUrl,
    packages: [sampleEntry],
  });
});

describe('OnlineCdnPackageResolver', () => {
  it('resolves a known id to its CDN URLs without fetching content', async () => {
    const resolver = new OnlineCdnPackageResolver();

    const result = await resolver.resolve('github-visualize-business-value');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contentUrl).toBe(
        'https://interactive-learning.grafana.net/packages/github-visualize-business-value/content.json'
      );
      expect(result.manifestUrl).toBe(
        'https://interactive-learning.grafana.net/packages/github-visualize-business-value/manifest.json'
      );
      // Inlined manifest is surfaced even when loadContent is omitted, so
      // resolveDeferredData can read milestones immediately.
      expect(result.manifest).toBeDefined();
      expect((result.manifest as unknown as Record<string, unknown>).id).toBe('github-visualize-business-value');
    }
  });

  it('returns not-found when the id is missing from the index', async () => {
    const resolver = new OnlineCdnPackageResolver();

    const result = await resolver.resolve('does-not-exist');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not-found');
    }
  });

  it('strips trailing slashes when building URLs', async () => {
    (fetchOnlinePackageRecommendations as jest.Mock).mockResolvedValue({
      baseUrl,
      packages: [{ ...sampleEntry, path: 'github-visualize-business-value/' }],
    });
    const resolver = new OnlineCdnPackageResolver();

    const result = await resolver.resolve('github-visualize-business-value');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contentUrl).not.toContain('//content.json');
    }
  });
});
