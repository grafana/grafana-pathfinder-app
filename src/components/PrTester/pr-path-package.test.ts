import {
  buildPathPackageInfo,
  discoverCatalogPaths,
  getCatalogMilestoneIds,
  isCatalogPathEntry,
  type PrContentEntry,
} from './pr-path-package';
import type { PrJsonFile } from './github-api';
import type { OnlinePackageEntry } from '../../lib/package-recommendations-client';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const RAW_BASE = `https://raw.githubusercontent.com/org/repo/${SHA}`;
const CDN_BASE = 'https://interactive-learning.grafana.net/packages';

function prFile(directoryName: string, kind: 'content' | 'manifest' = 'content'): PrJsonFile {
  return {
    directoryName,
    rawUrl: `${RAW_BASE}/${directoryName}/${kind}.json`,
    status: 'modified',
    kind,
  };
}

function prContentEntry(directoryName: string, title?: string): PrContentEntry {
  return { file: prFile(directoryName, 'content'), title };
}

function catalogPath(id: string, milestones: string[], extra: Partial<OnlinePackageEntry> = {}): OnlinePackageEntry {
  return {
    id,
    path: `${id}/v1.0.0`,
    type: 'path',
    manifest: { id, type: 'path', milestones },
    ...extra,
  };
}

function catalogGuide(id: string, extra: Partial<OnlinePackageEntry> = {}): OnlinePackageEntry {
  return {
    id,
    path: `${id}/v1.0.0`,
    type: 'guide',
    manifest: { id, type: 'guide' },
    ...extra,
  };
}

function byId(entries: OnlinePackageEntry[]): Map<string, OnlinePackageEntry> {
  return new Map(entries.map((e) => [e.id, e]));
}

describe('getCatalogMilestoneIds', () => {
  it('reads milestone IDs from the inlined manifest', () => {
    expect(getCatalogMilestoneIds(catalogPath('p', ['a', 'b']))).toEqual(['a', 'b']);
  });

  it('returns [] when there is no manifest or milestones array', () => {
    expect(getCatalogMilestoneIds({ id: 'p', path: 'p/' })).toEqual([]);
    expect(getCatalogMilestoneIds({ id: 'p', path: 'p/', manifest: { id: 'p' } })).toEqual([]);
  });

  it('filters out non-string milestone entries', () => {
    const entry: OnlinePackageEntry = { id: 'p', path: 'p/', manifest: { milestones: ['a', 5, null, 'b'] } };
    expect(getCatalogMilestoneIds(entry)).toEqual(['a', 'b']);
  });
});

describe('isCatalogPathEntry', () => {
  it('recognizes path/journey via the top-level type', () => {
    expect(isCatalogPathEntry({ id: 'p', path: 'p/', type: 'path' })).toBe(true);
    expect(isCatalogPathEntry({ id: 'p', path: 'p/', type: 'journey' })).toBe(true);
    expect(isCatalogPathEntry({ id: 'g', path: 'g/', type: 'guide' })).toBe(false);
  });

  it('falls back to the manifest type when the top-level type is absent', () => {
    expect(isCatalogPathEntry({ id: 'p', path: 'p/', manifest: { type: 'path' } })).toBe(true);
    expect(isCatalogPathEntry({ id: 'g', path: 'g/', manifest: { type: 'guide' } })).toBe(false);
  });
});

describe('discoverCatalogPaths', () => {
  const catalog = [
    catalogPath('alpha-lj', ['a1', 'a2', 'shared']),
    catalogPath('beta-lj', ['b1', 'shared']),
    catalogGuide('shared'),
    catalogGuide('a1'),
  ];

  it('finds paths whose milestones intersect the changed IDs', () => {
    const found = discoverCatalogPaths(catalog, new Set(['a2']));
    expect(found.map((e) => e.id)).toEqual(['alpha-lj']);
  });

  it('returns every path that contains a shared changed milestone', () => {
    const found = discoverCatalogPaths(catalog, new Set(['shared']));
    expect(found.map((e) => e.id).sort()).toEqual(['alpha-lj', 'beta-lj']);
  });

  it('ignores guide-type entries even if their id matches', () => {
    const found = discoverCatalogPaths(catalog, new Set(['a1']));
    // a1 is a milestone of alpha-lj AND a guide entry; only the path is returned.
    expect(found.map((e) => e.id)).toEqual(['alpha-lj']);
  });

  it('returns [] when nothing intersects or the changed set is empty', () => {
    expect(discoverCatalogPaths(catalog, new Set(['nope']))).toEqual([]);
    expect(discoverCatalogPaths(catalog, new Set())).toEqual([]);
  });
});

describe('buildPathPackageInfo', () => {
  it('builds milestones in manifest order from PR raw URLs when all are in the PR', () => {
    const result = buildPathPackageInfo({
      pathId: 'my-path',
      milestoneIds: ['guide-one', 'guide-two'],
      coverFromPr: prFile('my-path', 'content'),
      prContentById: new Map<string, PrContentEntry>([
        ['guide-one', prContentEntry('guide-one', 'Guide One')],
        ['guide-two', prContentEntry('guide-two')],
      ]),
      catalogById: new Map(),
      catalogBaseUrl: '',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.coverUrl).toBe(`${RAW_BASE}/my-path/content.json`);
    expect(result.title).toBe('My Path');
    const milestones = result.packageInfo.resolvedMilestones ?? [];
    expect(milestones.map((m) => m.url)).toEqual([
      `${RAW_BASE}/guide-one/content.json`,
      `${RAW_BASE}/guide-two/content.json`,
    ]);
    expect(milestones[0]?.title).toBe('Guide One');
    expect(result.preview.map((p) => p.source)).toEqual(['pr', 'pr']);
  });

  it('overlays the PR onto the catalog: changed milestones win, unchanged come from the CDN', () => {
    const result = buildPathPackageInfo({
      pathId: 'my-path',
      milestoneIds: ['guide-one', 'guide-two'],
      coverFromPr: undefined,
      prContentById: new Map<string, PrContentEntry>([['guide-one', prContentEntry('guide-one', 'PR One')]]),
      catalogById: byId([
        catalogPath('my-path', ['guide-one', 'guide-two']),
        catalogGuide('guide-one', { title: 'Published One' }),
        catalogGuide('guide-two', { title: 'Published Two' }),
      ]),
      catalogBaseUrl: CDN_BASE,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    // Cover falls back to the published path package.
    expect(result.coverUrl).toBe(`${CDN_BASE}/my-path/v1.0.0/content.json`);
    const milestones = result.packageInfo.resolvedMilestones ?? [];
    // guide-one: PR wins. guide-two: from the catalog.
    expect(milestones[0]?.url).toBe(`${RAW_BASE}/guide-one/content.json`);
    expect(milestones[0]?.title).toBe('PR One');
    expect(milestones[1]?.url).toBe(`${CDN_BASE}/guide-two/v1.0.0/content.json`);
    expect(milestones[1]?.title).toBe('Published Two');
    expect(result.preview.map((p) => p.source)).toEqual(['pr', 'cdn']);
  });

  it('prefers the PR cover when the path content.json is in the diff', () => {
    const result = buildPathPackageInfo({
      pathId: 'my-path',
      milestoneIds: ['guide-one'],
      coverFromPr: prFile('my-path', 'content'),
      prContentById: new Map<string, PrContentEntry>([['guide-one', prContentEntry('guide-one')]]),
      catalogById: byId([catalogPath('my-path', ['guide-one'])]),
      catalogBaseUrl: CDN_BASE,
    });

    expect(result.ok && result.coverUrl).toBe(`${RAW_BASE}/my-path/content.json`);
  });

  it('reports missing_milestones for IDs in neither the PR nor the catalog', () => {
    const result = buildPathPackageInfo({
      pathId: 'my-path',
      milestoneIds: ['guide-one', 'guide-missing'],
      coverFromPr: prFile('my-path', 'content'),
      prContentById: new Map<string, PrContentEntry>([['guide-one', prContentEntry('guide-one')]]),
      catalogById: byId([catalogGuide('guide-one')]),
      catalogBaseUrl: CDN_BASE,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('missing_milestones');
      expect(result.missingMilestones).toEqual(['guide-missing']);
    }
  });

  it('reports missing_cover when there is no PR cover and the path is not published', () => {
    const result = buildPathPackageInfo({
      pathId: 'my-path',
      milestoneIds: ['guide-one'],
      coverFromPr: undefined,
      prContentById: new Map<string, PrContentEntry>([['guide-one', prContentEntry('guide-one')]]),
      catalogById: byId([catalogGuide('guide-one')]), // no 'my-path' entry
      catalogBaseUrl: CDN_BASE,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('missing_cover');
    }
  });

  it('reports no_milestones for an empty milestone list', () => {
    const result = buildPathPackageInfo({
      pathId: 'my-path',
      milestoneIds: [],
      coverFromPr: prFile('my-path', 'content'),
      prContentById: new Map(),
      catalogById: new Map(),
      catalogBaseUrl: '',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('no_milestones');
    }
  });

  describe('title resolution', () => {
    function buildWithDescription(pathId: string, description?: string) {
      return buildPathPackageInfo({
        pathId,
        description,
        milestoneIds: ['guide-one'],
        coverFromPr: prFile(pathId, 'content'),
        prContentById: new Map<string, PrContentEntry>([['guide-one', prContentEntry('guide-one')]]),
        catalogById: new Map(),
        catalogBaseUrl: '',
      });
    }

    it('prefers the description over the slug-formatted id', () => {
      const result = buildWithDescription('pathfinder-roadmap-2026-lj', 'Pathfinder roadmap 2026');
      expect(result.ok && result.title).toBe('Pathfinder roadmap 2026');
    });

    it('falls back to the slug-formatted id when description is missing or whitespace', () => {
      expect((buildWithDescription('pathfinder-roadmap-2026') as { title: string }).title).toBe(
        'Pathfinder Roadmap 2026'
      );
      expect((buildWithDescription('my-cool-path', '   ') as { title: string }).title).toBe('My Cool Path');
    });

    it('keeps the raw id as the package identity even when the title comes from description', () => {
      const result = buildWithDescription('pathfinder-roadmap-2026-lj', 'Pathfinder roadmap 2026');
      expect(result.ok && result.packageInfo.packageId).toBe('pathfinder-roadmap-2026-lj');
    });
  });
});
