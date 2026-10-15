import {
  bundledCatalog,
  filterCatalog,
  mergeCatalog,
  onlineCatalog,
  organizationCatalog,
  withoutPathMembers,
} from './package-catalog';
import type { CatalogPackage } from '../types/package-catalog.types';
import type { RepositoryJson } from '../types/package.types';
import { GUIDE_STATS_VERSION } from './guide-stats/summary';
import bundledRepository from '../bundled-interactives/repository.json';
import legacyIndex from '../bundled-interactives/index.json';

const stats = {
  version: GUIDE_STATS_VERSION,
  blockCount: 10,
  sectionCount: 2,
  completableBlockCount: 4,
  finalCompletablePosition: 8,
};
const repository: RepositoryJson = {
  intro: { type: 'guide', path: 'intro/', title: 'Introduction', stats },
  'e2e-framework-test': { type: 'guide', path: 'test/', title: 'Fixture' },
  unknown: { type: 'guide', path: 'unknown/', title: 'Unknown counts', stats: { ...stats, version: 999 } },
};

describe('package catalog', () => {
  it.each(['future', 42, { future: true }, 'markdown'])(
    'preserves path metadata and exact prerequisite labels for format %p',
    (format) => {
      const label = '  Literal <b> & **syntax**  ';
      const [entry] = onlineCatalog({
        baseUrl: 'https://interactive-learning.grafana.net/packages/',
        packages: [
          {
            id: 'test-path',
            path: 'test-path/',
            title: 'Path',
            type: 'path',
            manifest: {
              id: 'test-path',
              type: 'path',
              milestones: ['first', 'second'],
              prerequisites: [{ id: ' notice ', label, format }],
            },
          },
        ],
      });
      expect(entry).toMatchObject({
        format: 'path',
        memberIds: ['first', 'second'],
        packageInfo: {
          packageId: 'test-path',
          packageManifest: {
            id: 'test-path',
            type: 'path',
            milestones: ['first', 'second'],
            prerequisites: [{ id: ' notice ', label, ...(format === 'markdown' ? { format } : {}) }],
          },
        },
      });
    }
  );

  it.each([
    [
      [
        { id: 'duplicate', label: 'First' },
        { id: 'duplicate', label: 'Second' },
      ],
    ],
    [[null]],
    [[{ id: 'numeric-label', label: 42 }]],
    [{ id: 'not-an-array', label: 'Setup' }],
  ])('retains path navigation despite invalid prerequisites %p', (prerequisites) => {
    const [entry] = onlineCatalog({
      baseUrl: 'https://interactive-learning.grafana.net/packages/',
      packages: [
        {
          id: 'test-path',
          path: 'test-path/',
          type: 'path',
          manifest: {
            id: 'test-path',
            type: 'path',
            milestones: ['first', 'second'],
            prerequisites,
          },
        },
      ],
    });
    expect(entry).toMatchObject({
      format: 'path',
      memberIds: ['first', 'second'],
      packageInfo: { packageManifest: { id: 'test-path', type: 'path', milestones: ['first', 'second'] } },
    });
    expect(entry?.packageInfo?.packageManifest?.prerequisites).toBeUndefined();
  });

  it('uses existing bundled estimates and supported activity counts, and excludes fixtures', () => {
    const entries = bundledCatalog(repository, { intro: { title: 'Introduction', estimatedMinutes: 5 } });
    expect(entries.map((entry) => entry.id)).toEqual(['intro', 'unknown']);
    expect(entries[0]).toMatchObject({ estimatedMinutes: 5, activityCount: 4, url: 'bundled:intro/content.json' });
    expect(entries[1]?.activityCount).toBeUndefined();
    expect(entries[1]?.estimatedMinutes).toBeUndefined();
  });

  it('uses a loadable package URL for guides that are absent from the legacy index', () => {
    expect(legacyIndex.interactives.some((entry) => entry.id === 'block-editor-tutorial')).toBe(false);
    const guide = bundledCatalog(bundledRepository as RepositoryJson, {}).find(
      (entry) => entry.id === 'block-editor-tutorial'
    );
    expect(guide).toMatchObject({
      key: 'bundled:block-editor-tutorial',
      url: 'bundled:block-editor-tutorial/content.json',
      packageInfo: { repository: 'bundled', packageManifest: { id: 'block-editor-tutorial' } },
    });
  });

  it('retains sparse published organization content with trusted private identity', () => {
    const entries = organizationCatalog([
      {
        id: 'intro',
        title: 'Private introduction',
        status: 'published',
        manifest: { repository: 'bundled', type: 'guide' },
      },
      { id: 'draft', status: 'draft' },
      { id: '../unsafe', status: 'published' },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      key: 'app-platform:intro',
      url: 'backend-guide:intro',
      source: 'organization',
      packageInfo: { repository: 'app-platform', packageManifest: { repository: 'app-platform' } },
    });
    expect(entries[0]?.activityCount).toBeUndefined();
  });

  it('deduplicates public IDs by resolver precedence while preserving private collisions', () => {
    const local = bundledCatalog(repository, {});
    const online = onlineCatalog({
      baseUrl: 'https://interactive-learning.grafana.net/packages/',
      packages: [{ id: 'intro', path: 'intro', title: 'Online introduction', type: 'guide' }],
    });
    const privateEntries = organizationCatalog([{ id: 'intro', title: 'Private introduction', status: 'published' }]);
    expect(
      mergeCatalog(local, online, privateEntries)
        .filter((entry) => entry.id === 'intro')
        .map((entry) => entry.url)
    ).toEqual(['bundled:intro/content.json', 'backend-guide:intro']);
  });

  it('rejects unsafe online content URLs and retains missing manifests without inventing counts', () => {
    const entries = [{ id: 'intro', path: 'intro', title: 'Introduction', type: 'path' }];
    expect(onlineCatalog({ baseUrl: 'https://untrusted.example/packages/', packages: entries })).toEqual([]);
    const allowed = onlineCatalog({ baseUrl: 'https://interactive-learning.grafana.net/packages/', packages: entries });
    expect(allowed[0]).toMatchObject({ format: 'path' });
    expect(allowed[0]?.memberIds).toBeUndefined();
    expect(allowed[0]?.estimatedMinutes).toBeUndefined();
  });

  it('searches all terms, ranks matching titles first, and keeps uncategorized content discoverable', () => {
    const entries: CatalogPackage[] = [
      {
        key: 'a',
        id: 'a',
        title: 'Metrics',
        description: 'Build your first dashboard',
        format: 'guide',
        source: 'grafana',
        url: 'bundled:a',
        category: 'metrics',
      },
      { key: 'b', id: 'b', title: 'First dashboard', format: 'guide', source: 'organization', url: 'backend-guide:b' },
    ];
    const all = { query: 'first dashboard', format: 'all', source: 'all', category: 'all' } as const;
    expect(filterCatalog(entries, all).map((entry) => entry.key)).toEqual(['b', 'a']);
    expect(filterCatalog(entries, { ...all, query: '', category: 'uncategorized' }).map((entry) => entry.key)).toEqual([
      'b',
    ]);
    expect(filterCatalog(entries, { ...all, source: 'grafana' }).map((entry) => entry.key)).toEqual(['a']);
  });

  it('omits guides that are milestones of a path from the same source', () => {
    const guide = (key: string, id: string, source: CatalogPackage['source']): CatalogPackage => ({
      key,
      id,
      title: id,
      format: 'guide',
      source,
      url: `bundled:${id}`,
    });
    const entries: CatalogPackage[] = [
      { ...guide('path', 'path', 'grafana'), format: 'path', memberIds: ['member', 'missing'] },
      guide('member', 'member', 'grafana'),
      guide('org-member', 'member', 'organization'),
      guide('standalone', 'standalone', 'grafana'),
    ];
    expect(withoutPathMembers(entries).map((entry) => entry.key)).toEqual(['path', 'org-member', 'standalone']);
  });

  it('lists legacy organization members as modules and omits every path member from browse', () => {
    const entries = organizationCatalog([
      {
        id: 'team-path',
        status: 'published',
        manifest: {
          type: 'path',
          milestones: ['foundation', 'team.guide_v1'],
          tracks: [{ trackId: 'deep-dive', label: 'Deep dive', guides: ['track-only-guide'] }],
        },
      },
      {
        id: 'canonical-path',
        status: 'published',
        manifest: {
          type: 'path',
          milestones: ['canonical-member'],
          tracks: [{ trackId: 'extras', label: 'Extras', guides: ['canonical-track-guide'] }],
        },
      },
      ...[
        'foundation',
        'team.guide_v1',
        'track-only-guide',
        'canonical-member',
        'canonical-track-guide',
        'standalone',
      ].map((id) => ({
        id,
        status: 'published',
        manifest: { type: 'guide' as const },
      })),
    ]);
    expect(entries[0]?.memberIds).toEqual(['foundation', 'team.guide_v1']);
    expect(entries[1]?.memberIds).toEqual(['canonical-member']);
    expect(withoutPathMembers(entries).map((entry) => entry.id)).toEqual(['team-path', 'canonical-path', 'standalone']);
  });
});

it('keeps legacy private resource identifiers without a manifest migration', () => {
  expect(organizationCatalog([{ id: 'team.guide_v1', status: 'published' }])[0]?.url).toBe(
    'backend-guide:team.guide_v1'
  );
});
