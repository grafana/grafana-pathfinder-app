import { buildPathPackageInfo, indexContentByPackageId, indexPrFiles } from './pr-path-package';
import type { PrJsonFile } from './github-api';
import type { ManifestJson } from '../../types/package.types';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const RAW_BASE = `https://raw.githubusercontent.com/org/repo/${SHA}`;

function content(directoryName: string): PrJsonFile {
  return {
    directoryName,
    rawUrl: `${RAW_BASE}/${directoryName}/content.json`,
    status: 'added',
    kind: 'content',
  };
}

function manifestFile(directoryName: string): PrJsonFile {
  return {
    directoryName,
    rawUrl: `${RAW_BASE}/${directoryName}/manifest.json`,
    status: 'added',
    kind: 'manifest',
  };
}

function pathManifest(overrides: Partial<ManifestJson> = {}): ManifestJson {
  return {
    id: 'my-path',
    type: 'path',
    milestones: ['guide-one', 'guide-two'],
    ...overrides,
  };
}

function guideManifest(id: string): ManifestJson {
  return { id, type: 'guide' };
}

/**
 * Helper that builds the package-id index assuming `manifest.id` matches
 * `directoryName`. Tests for the prefix-mismatch scenario (where directory
 * and id differ) construct the index manually.
 */
function idIndexMatchingDir(files: readonly PrJsonFile[]): Map<string, PrJsonFile> {
  const manifests = new Map<string, ManifestJson>();
  for (const file of files) {
    if (file.kind === 'manifest') {
      manifests.set(file.directoryName, guideManifest(file.directoryName));
    }
  }
  return indexContentByPackageId(indexPrFiles(files).contentByDir, manifests);
}

describe('indexPrFiles', () => {
  it('separates content and manifest files by directory', () => {
    const files: PrJsonFile[] = [content('a'), manifestFile('a'), content('b'), manifestFile('c')];

    const { contentByDir, manifestByDir } = indexPrFiles(files);

    expect(contentByDir.size).toBe(2);
    expect(contentByDir.get('a')?.kind).toBe('content');
    expect(contentByDir.get('b')?.kind).toBe('content');
    expect(manifestByDir.size).toBe(2);
    expect(manifestByDir.get('a')?.kind).toBe('manifest');
    expect(manifestByDir.get('c')?.kind).toBe('manifest');
  });
});

describe('indexContentByPackageId', () => {
  it('keys content files by the sibling manifest.id, not the directory name', () => {
    const files: PrJsonFile[] = [
      content('01-where-we-are'),
      manifestFile('01-where-we-are'),
      content('02-event-demo-suite'),
      manifestFile('02-event-demo-suite'),
    ];
    const manifests = new Map<string, ManifestJson>([
      ['01-where-we-are', guideManifest('pathfinder-roadmap-where-we-are')],
      ['02-event-demo-suite', guideManifest('pathfinder-roadmap-event-demo-suite')],
    ]);

    const index = indexContentByPackageId(indexPrFiles(files).contentByDir, manifests);

    expect(index.size).toBe(2);
    expect(index.get('pathfinder-roadmap-where-we-are')?.rawUrl).toBe(`${RAW_BASE}/01-where-we-are/content.json`);
    expect(index.get('pathfinder-roadmap-event-demo-suite')?.rawUrl).toBe(
      `${RAW_BASE}/02-event-demo-suite/content.json`
    );
    // Directory names are NOT exposed as keys
    expect(index.has('01-where-we-are')).toBe(false);
  });

  it('skips manifests whose sibling content.json is not in the PR', () => {
    const files: PrJsonFile[] = [manifestFile('orphan-manifest')];
    const manifests = new Map<string, ManifestJson>([['orphan-manifest', guideManifest('orphan')]]);

    const index = indexContentByPackageId(indexPrFiles(files).contentByDir, manifests);

    expect(index.size).toBe(0);
  });

  it('skips orphan content.json files (no sibling manifest)', () => {
    // Without a sibling manifest we cannot recover the canonical package ID,
    // so the file is unreachable for milestone resolution.
    const files: PrJsonFile[] = [content('orphan-content')];
    const manifests = new Map<string, ManifestJson>();

    const index = indexContentByPackageId(indexPrFiles(files).contentByDir, manifests);

    expect(index.size).toBe(0);
  });
});

describe('buildPathPackageInfo', () => {
  it('builds a packageInfo with milestones in manifest order, mapped to PR raw URLs', () => {
    const manifest = pathManifest();
    const files: PrJsonFile[] = [
      manifestFile('my-path'),
      content('my-path'),
      manifestFile('guide-two'),
      content('guide-two'), // intentionally out of order vs. manifest
      manifestFile('guide-one'),
      content('guide-one'),
    ];

    const result = buildPathPackageInfo({
      contentByDir: indexPrFiles(files).contentByDir,
      manifest,
      manifestDirectory: 'my-path',
      contentByPackageId: idIndexMatchingDir(files),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.coverUrl).toBe(`${RAW_BASE}/my-path/content.json`);
    // Slug-formatted fallback when the manifest has no `description`. Mirrors
    // the `formatSlug` convention used by `find-doc-page.ts` for `?doc=` deep
    // links so PR-tester tabs and deep-link tabs read the same.
    expect(result.title).toBe('My Path');
    expect(result.packageInfo.packageId).toBe('my-path');
    expect(result.packageInfo.packageManifest).toBe(manifest as unknown as Record<string, unknown>);

    const milestones = result.packageInfo.resolvedMilestones ?? [];
    expect(milestones).toHaveLength(2);
    // Order must follow manifest.milestones, not file order
    expect(milestones.map((m) => m.title)).toEqual(['guide-one', 'guide-two']);
    expect(milestones[0]?.number).toBe(1);
    expect(milestones[0]?.url).toBe(`${RAW_BASE}/guide-one/content.json`);
    expect(milestones[1]?.number).toBe(2);
    expect(milestones[1]?.url).toBe(`${RAW_BASE}/guide-two/content.json`);
  });

  describe('title resolution', () => {
    function buildWithManifest(manifest: ManifestJson) {
      const files: PrJsonFile[] = [manifestFile('my-path'), content('my-path')];
      // Self-reference so the cover resolves; we only care about `result.title`.
      return buildPathPackageInfo({
        contentByDir: indexPrFiles(files).contentByDir,
        manifest,
        manifestDirectory: 'my-path',
        contentByPackageId: new Map([['stub', content('my-path')]]),
      });
    }

    it('prefers `manifest.description` over the slug-formatted id', () => {
      const result = buildWithManifest({
        id: 'pathfinder-roadmap-2026-lj',
        type: 'path',
        milestones: ['stub'],
        description: 'Pathfinder roadmap 2026',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.title).toBe('Pathfinder roadmap 2026');
      }
    });

    it('falls back to slug-formatted id when description is missing', () => {
      const result = buildWithManifest({
        id: 'pathfinder-roadmap-2026',
        type: 'path',
        milestones: ['stub'],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.title).toBe('Pathfinder Roadmap 2026');
      }
    });

    it('falls back to slug-formatted id when description is whitespace-only', () => {
      const result = buildWithManifest({
        id: 'my-cool-path',
        type: 'path',
        milestones: ['stub'],
        description: '   ',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.title).toBe('My Cool Path');
      }
    });

    it('keeps the raw id as the package identity even when title comes from description', () => {
      const result = buildWithManifest({
        id: 'pathfinder-roadmap-2026-lj',
        type: 'path',
        milestones: ['stub'],
        description: 'Pathfinder roadmap 2026',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Identity must remain the slug so milestone progress + storage keys
        // match production lookups.
        expect(result.packageInfo.packageId).toBe('pathfinder-roadmap-2026-lj');
      }
    });
  });

  it('resolves milestones via package id even when the directory name differs (the real-world prefix case)', () => {
    const manifest: ManifestJson = {
      id: 'pathfinder-roadmap-2026-lj',
      type: 'path',
      milestones: ['pathfinder-roadmap-where-we-are', 'pathfinder-roadmap-event-demo-suite'],
    };
    const files: PrJsonFile[] = [
      content('pathfinder-roadmap-2026-lj'),
      manifestFile('pathfinder-roadmap-2026-lj'),
      content('pathfinder-roadmap-2026-lj/01-where-we-are'),
      manifestFile('pathfinder-roadmap-2026-lj/01-where-we-are'),
      content('pathfinder-roadmap-2026-lj/02-event-demo-suite'),
      manifestFile('pathfinder-roadmap-2026-lj/02-event-demo-suite'),
    ];
    // The path manifest's own id matches its directory name, but the children
    // declare ids without the numeric prefix.
    const manifests = new Map<string, ManifestJson>([
      ['pathfinder-roadmap-2026-lj', manifest],
      ['pathfinder-roadmap-2026-lj/01-where-we-are', guideManifest('pathfinder-roadmap-where-we-are')],
      ['pathfinder-roadmap-2026-lj/02-event-demo-suite', guideManifest('pathfinder-roadmap-event-demo-suite')],
    ]);

    const { contentByDir } = indexPrFiles(files);
    const result = buildPathPackageInfo({
      contentByDir,
      manifest,
      manifestDirectory: 'pathfinder-roadmap-2026-lj',
      contentByPackageId: indexContentByPackageId(contentByDir, manifests),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const milestones = result.packageInfo.resolvedMilestones ?? [];
    expect(milestones.map((m) => m.url)).toEqual([
      `${RAW_BASE}/pathfinder-roadmap-2026-lj/01-where-we-are/content.json`,
      `${RAW_BASE}/pathfinder-roadmap-2026-lj/02-event-demo-suite/content.json`,
    ]);
  });

  it('also accepts journey-type manifests', () => {
    const manifest = pathManifest({ type: 'journey' });
    const files: PrJsonFile[] = [
      content('my-path'),
      content('guide-one'),
      manifestFile('guide-one'),
      content('guide-two'),
      manifestFile('guide-two'),
    ];

    const result = buildPathPackageInfo({
      contentByDir: indexPrFiles(files).contentByDir,
      manifest,
      manifestDirectory: 'my-path',
      contentByPackageId: idIndexMatchingDir(files),
    });

    expect(result.ok).toBe(true);
  });

  it('rejects guide-type manifests as not a path package', () => {
    const manifest: ManifestJson = { id: 'g', type: 'guide' };
    const result = buildPathPackageInfo({
      contentByDir: indexPrFiles([content('g')]).contentByDir,
      manifest,
      manifestDirectory: 'g',
      contentByPackageId: new Map(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('not_path_package');
    }
  });

  it('reports no_milestones when the manifest has an empty milestones array', () => {
    const manifest = pathManifest({ milestones: [] });
    const result = buildPathPackageInfo({
      contentByDir: indexPrFiles([content('my-path')]).contentByDir,
      manifest,
      manifestDirectory: 'my-path',
      contentByPackageId: new Map(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('no_milestones');
    }
  });

  it('reports missing_cover when the path package itself has no content.json in the PR', () => {
    const manifest = pathManifest();
    const files: PrJsonFile[] = [
      content('guide-one'),
      manifestFile('guide-one'),
      content('guide-two'),
      manifestFile('guide-two'),
    ];
    const result = buildPathPackageInfo({
      contentByDir: indexPrFiles(files).contentByDir,
      manifest,
      manifestDirectory: 'my-path',
      contentByPackageId: idIndexMatchingDir(files),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('missing_cover');
    }
  });

  it('reports missing_milestones with the list of unresolved IDs', () => {
    const manifest = pathManifest({ milestones: ['guide-one', 'guide-missing', 'guide-two'] });
    const files: PrJsonFile[] = [
      content('my-path'),
      content('guide-one'),
      manifestFile('guide-one'),
      content('guide-two'),
      manifestFile('guide-two'),
    ];
    const result = buildPathPackageInfo({
      contentByDir: indexPrFiles(files).contentByDir,
      manifest,
      manifestDirectory: 'my-path',
      contentByPackageId: idIndexMatchingDir(files),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('missing_milestones');
      expect(result.missingMilestones).toEqual(['guide-missing']);
    }
  });
});
