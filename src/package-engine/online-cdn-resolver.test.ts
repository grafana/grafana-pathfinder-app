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
  it.each(
    [
      [
        { id: 'duplicate', label: 'First' },
        { id: 'duplicate', label: 'Second' },
      ],
      [null],
      [{ id: 'numeric-label', label: 42 }],
      { id: 'not-an-array', label: 'Setup' },
    ].flatMap((prerequisites) => ['inline', 'fetched'].map((source) => ({ prerequisites, source })))
  )('preserves a $source path despite invalid prerequisites $prerequisites', async ({ prerequisites, source }) => {
    const manifest = {
      ...sampleEntry.manifest,
      type: 'path',
      milestones: ['first', 'second'],
      tracks: [{ trackId: 'extra', label: 'Extra', guides: ['track-guide'] }],
      prerequisites,
    };
    (fetchOnlinePackageRecommendations as jest.Mock).mockResolvedValue({
      baseUrl,
      packages: [{ ...sampleEntry, type: 'path', manifest: source === 'inline' ? manifest : undefined }],
    });
    const originalFetch = global.fetch;
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(manifest) });
    global.fetch = fetchMock;
    try {
      const result = await new OnlineCdnPackageResolver().resolve(sampleEntry.id, { loadContent: 'metadata-only' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.id).toBe(sampleEntry.id);
        expect(result.manifest).toMatchObject({
          id: sampleEntry.id,
          type: 'path',
          milestones: manifest.milestones,
          tracks: manifest.tracks,
        });
        expect(result.manifest?.prerequisites).toBeUndefined();
        expect(result.contentUrl).toBe(`${baseUrl}${sampleEntry.id}/content.json`);
        expect(result.content).toBeUndefined();
      }
      expect(fetchMock).toHaveBeenCalledTimes(source === 'inline' ? 0 : 1);
      expect(fetchOnlinePackageRecommendations).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it.each([
    { source: 'inline', loadContent: false },
    { source: 'inline', loadContent: 'metadata-only' },
    { source: 'inline', loadContent: true },
    { source: 'fetched', loadContent: 'metadata-only' },
    { source: 'fetched', loadContent: true },
    { source: 'fallback', loadContent: 'metadata-only' },
    { source: 'fallback', loadContent: true },
  ] as const)(
    'preserves $source path manifests with unknown formats and loadContent=$loadContent',
    async ({ source, loadContent }) => {
      const manifest = {
        ...sampleEntry.manifest,
        type: 'path',
        milestones: ['first', 'second'],
        tracks: [{ trackId: 'extra', label: 'Extra', guides: ['track-guide'] }],
        prerequisites: [
          { id: ' first ', label: ' <b>Literal</b> ', format: 'html' },
          { id: 'numeric', label: '**Still literal**', format: 42 },
          { id: 'object', label: '[Literal](https://example.com)', format: { type: 'markdown' } },
          { id: 'markdown', label: '**Markdown**', format: 'markdown' },
          { id: 'plain', label: 'Plain' },
        ],
      };
      (fetchOnlinePackageRecommendations as jest.Mock).mockResolvedValue({
        baseUrl,
        packages: [
          {
            ...sampleEntry,
            manifest:
              source === 'inline' ? manifest : source === 'fallback' ? { ...manifest, id: 'Bad_ID' } : undefined,
          },
        ],
      });
      const originalFetch = global.fetch;
      const content = { id: sampleEntry.id, title: 'Path', blocks: [] };
      const fetchMock = jest.fn().mockImplementation((url: string) =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(url.endsWith('/content.json') ? content : manifest),
        })
      );
      global.fetch = fetchMock;
      try {
        const result = await new OnlineCdnPackageResolver().resolve(sampleEntry.id, { loadContent });

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.manifest).toMatchObject({
            ...manifest,
            prerequisites: [
              { id: ' first ', label: ' <b>Literal</b> ' },
              { id: 'numeric', label: '**Still literal**' },
              { id: 'object', label: '[Literal](https://example.com)' },
              { id: 'markdown', label: '**Markdown**', format: 'markdown' },
              { id: 'plain', label: 'Plain' },
            ],
          });
          expect(result.content).toEqual(loadContent === true ? content : undefined);
          expect(result.repository).toBe('online-cdn');
        }
        expect(fetchMock).toHaveBeenCalledTimes(Number(loadContent === true) + Number(source !== 'inline'));
        if (source === 'inline') {
          expect(fetchMock).not.toHaveBeenCalledWith(`${baseUrl}${sampleEntry.id}/manifest.json`);
        } else {
          expect(fetchMock).toHaveBeenLastCalledWith(`${baseUrl}${sampleEntry.id}/manifest.json`);
        }
      } finally {
        global.fetch = originalFetch;
      }
    }
  );

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
      expect(result.entryTitle).toBe('Business value');
    }
  });

  it('omits entryTitle when the index entry has no title', async () => {
    (fetchOnlinePackageRecommendations as jest.Mock).mockResolvedValue({
      baseUrl,
      packages: [{ ...sampleEntry, title: undefined }],
    });
    const resolver = new OnlineCdnPackageResolver();

    const result = await resolver.resolve('github-visualize-business-value');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entryTitle).toBeUndefined();
    }
  });

  it('returns not-found when the id is missing from the index', async () => {
    const resolver = new OnlineCdnPackageResolver();

    const result = await resolver.resolve('does-not-exist');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not-found');
      expect(result.error.diagnostic).toEqual({ source: 'cdn', stage: 'resolve', reason: 'not-found' });
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

  it('fetches manifest.json from the CDN on metadata-only resolve when no manifest is inlined', async () => {
    // The backend only inlines manifests for targeted entries; untargeted
    // (milestone/recommends-only) entries rely on this lazy fallback.
    (fetchOnlinePackageRecommendations as jest.Mock).mockResolvedValue({
      baseUrl,
      packages: [{ id: 'milestone-only', path: 'milestone-only/', title: 'Milestone only', type: 'guide' }],
    });
    const originalFetch = global.fetch;
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'milestone-only', type: 'guide', description: 'Lazy manifest' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    try {
      const resolver = new OnlineCdnPackageResolver();
      const result = await resolver.resolve('milestone-only', { loadContent: 'metadata-only' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.manifest).toBeDefined();
        expect((result.manifest as unknown as Record<string, unknown>).id).toBe('milestone-only');
      }
      expect(fetchMock).toHaveBeenCalledWith(
        'https://interactive-learning.grafana.net/packages/milestone-only/manifest.json'
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
});
