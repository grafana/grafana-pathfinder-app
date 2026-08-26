import type { RepositoryJson } from '../../types/package.types';
import type { LocalRepositorySource } from './e2e-local-package';
import type { PackageMeta } from './e2e-results';
import type { ExecutionPlan } from './guide-chains';
import { applyLocalManifestStartingLocation, applyLocalRepositoryStartingLocations } from './local-starting-location';
import { createStartingLocationTracker } from './starting-location';

function plan(...guides: Array<{ id: string; path: string }>): ExecutionPlan {
  return {
    chains: [
      guides.map(({ id, path }) => ({
        id,
        guide: { path, content: JSON.stringify({ id }) },
        dependencies: [],
        autoIncluded: false,
      })),
    ],
    autoIncludedIds: [],
    errors: [],
  };
}

function repoSource(repository: RepositoryJson): LocalRepositorySource {
  return {
    repository,
    loadGuideById(id, entry) {
      return { path: `/repo/${entry.path}content.json`, content: JSON.stringify({ id }) };
    },
  };
}

function trackerWithCarry() {
  const tracker = createStartingLocationTracker();
  tracker.record(
    true,
    {
      guide: { id: 'first', title: 'First', path: '/repo/first/content.json' },
      timestamp: '2026-01-01T00:00:00.000Z',
      results: [
        {
          stepId: 'final',
          status: 'passed',
          durationMs: 1,
          currentUrl: 'http://localhost:3000/carried?tab=query#editor',
          consoleErrors: [],
          skippable: false,
        },
      ],
      aborted: false,
    },
    'http://localhost:3000'
  );
  return tracker;
}

describe('applyLocalRepositoryStartingLocations', () => {
  it('makes bundled explicit starts win while omitted starts inherit', () => {
    const repository: RepositoryJson = {
      explicit: { path: 'explicit/', type: 'guide', startingLocation: '/connections' },
      root: { path: 'root/', type: 'guide', startingLocation: '/' },
      omitted: { path: 'omitted/', type: 'guide' },
    };
    const metadata = new Map<string, PackageMeta>();

    applyLocalRepositoryStartingLocations(
      plan(
        { id: 'explicit', path: '/repo/explicit/content.json' },
        { id: 'root', path: '/repo/root/content.json' },
        { id: 'omitted', path: '/repo/omitted/content.json' }
      ),
      repoSource(repository),
      metadata
    );
    const tracker = trackerWithCarry();

    expect(tracker.select(metadata.get('explicit')?.startingLocation)).toBe('/connections');
    expect(tracker.select(metadata.get('root')?.startingLocation)).toBe('/');
    expect(tracker.select(metadata.get('omitted')?.startingLocation)).toBe('/carried?tab=query#editor');
  });

  it('does not apply bundled metadata to an unrelated local file with the same id', () => {
    const repository: RepositoryJson = {
      shared: { path: 'shared/', type: 'guide', startingLocation: '/bundled-start' },
    };
    const metadata = new Map<string, PackageMeta>();

    applyLocalRepositoryStartingLocations(
      plan({ id: 'shared', path: '/workspace/local-guide.json' }),
      repoSource(repository),
      metadata
    );

    expect(metadata.get('shared')).toBeUndefined();
  });
});

describe('applyLocalManifestStartingLocation', () => {
  it.each(['/local-start', '/'] as const)('makes local manifest location %s win over carried state', (explicit) => {
    const metadata = new Map<string, PackageMeta>();
    applyLocalManifestStartingLocation({ id: 'local-guide', startingLocation: explicit }, metadata);

    expect(trackerWithCarry().select(metadata.get('local-guide')?.startingLocation)).toBe(explicit);
  });

  it('lets an omitted local manifest location inherit carried state', () => {
    const metadata = new Map<string, PackageMeta>();
    applyLocalManifestStartingLocation({ id: 'local-guide' }, metadata);

    expect(trackerWithCarry().select(metadata.get('local-guide')?.startingLocation)).toBe('/carried?tab=query#editor');
  });
});
