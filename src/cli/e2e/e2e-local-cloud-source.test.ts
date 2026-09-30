import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative } from 'path';

import {
  assertLocalCloudCheckoutSources,
  hasInteractiveBlocks,
  loadLocalRepositorySource,
  resolveLocalCloudGuide,
  resolveLocalMetapackage,
} from './e2e-local-package';

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

describe('local cloud package source resolution', () => {
  let root: string;
  let guideDir: string;
  let prerequisiteDir: string;
  let repositoryPath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pathfinder-local-cloud-source-'));
    guideDir = join(root, 'local-guide');
    prerequisiteDir = join(root, 'local-prerequisite');
    mkdirSync(guideDir);
    mkdirSync(prerequisiteDir);
    repositoryPath = join(root, 'repository.json');
    writeJson(join(guideDir, 'manifest.json'), {
      id: 'local-guide',
      type: 'guide',
      depends: ['local-prerequisite'],
      testEnvironment: { tier: 'cloud' },
    });
    writeJson(join(guideDir, 'content.json'), { id: 'local-guide', title: 'Local guide', blocks: [] });
    writeJson(join(prerequisiteDir, 'manifest.json'), {
      id: 'local-prerequisite',
      type: 'guide',
      testEnvironment: { tier: 'cloud' },
    });
    writeJson(join(prerequisiteDir, 'content.json'), {
      id: 'local-prerequisite',
      title: 'Local prerequisite',
      blocks: [],
    });
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it.each(['relative escape', 'symlink escape'] as const)('confines loaded content after resolving a %s', (kind) => {
    const outside = mkdtempSync(join(tmpdir(), 'pathfinder-outside-content-'));
    try {
      writeJson(join(outside, 'content.json'), { id: 'outside', title: 'Outside', blocks: [] });
      symlinkSync(outside, join(root, 'linked-guide'));
      const source = loadLocalRepositorySource(root, true, true);
      const entry = {
        type: 'guide' as const,
        path: kind === 'relative escape' ? `${relative(root, outside)}/` : 'linked-guide/',
      };
      expect(() => source.loadGuideById('outside', entry)).toThrow('content is outside the local repository');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('rejects a selected package outside the checkout', () => {
    const outside = mkdtempSync(join(tmpdir(), 'pathfinder-outside-package-'));
    try {
      expect(() => assertLocalCloudCheckoutSources(root, outside)).toThrow('outside the local repository');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it.each(['scripts/guide', 'assets/guide', 'local-guide/assets/guide'])(
    'rejects a selected package under %s',
    (location) => {
      const selected = join(root, location);
      mkdirSync(selected, { recursive: true });
      expect(() => assertLocalCloudCheckoutSources(root, selected)).toThrow('outside the package catalog');
    }
  );

  (process.platform === 'win32' ? it.skip : it)('rejects a FIFO before attempting to read source files', () => {
    execFileSync('mkfifo', [join(guideDir, 'source-pipe')]);
    expect(() => assertLocalCloudCheckoutSources(root, guideDir)).toThrow('special file');
  });

  it.each(['whenTrue', 'whenFalse'])('finds interactive content under a conditional %s branch', (branch) => {
    const block = { type: 'conditional', whenTrue: [], whenFalse: [] };
    expect(hasInteractiveBlocks([block])).toBe(false);
    expect(
      hasInteractiveBlocks([
        { ...block, [branch]: [{ type: 'interactive', action: 'highlight', reftarget: 'body', content: 'Inspect' }] },
      ])
    ).toBe(true);
  });

  it('uses the local guide and prerequisite rather than published content', () => {
    writeJson(repositoryPath, {
      'local-guide': {
        path: 'local-guide/',
        type: 'guide',
        depends: ['local-prerequisite'],
        testEnvironment: { tier: 'cloud' },
      },
      'local-prerequisite': {
        path: 'local-prerequisite/',
        type: 'guide',
        testEnvironment: { tier: 'cloud' },
      },
    });

    const resolution = resolveLocalCloudGuide({
      packageDir: guideDir,
      repositoryPath,
      grafanaUrl: 'http://localhost:3000',
      currentTier: 'cloud',
      cloudUrl: 'https://learn.grafana.net/',
      verbose: false,
      cloudTargetCapabilities: { sharedStackUrls: [], isolatedStack: true },
    });

    expect(resolution.guides.map((guide) => JSON.parse(guide.content))).toEqual([
      { id: 'local-prerequisite', title: 'Local prerequisite', blocks: [] },
      { id: 'local-guide', title: 'Local guide', blocks: [] },
    ]);
    expect(resolution.packageMetaById.get('local-guide')?.sourceUrl).toContain(`${root}/local-guide/content.json`);
    expect(resolution.packageMetaById.get('local-prerequisite')?.sourceUrl).toContain(
      `${root}/local-prerequisite/content.json`
    );
  });

  it('requires an explicit local repository and does not resolve a missing source remotely', () => {
    expect(() =>
      resolveLocalCloudGuide({
        packageDir: guideDir,
        grafanaUrl: 'http://localhost:3000',
        currentTier: 'cloud',
        cloudUrl: 'https://learn.grafana.net/',
        verbose: false,
      })
    ).toThrow('requires --repository <path>');
  });

  it('resolves cloud path milestones from the same local repository', () => {
    const pathDir = join(root, 'local-path');
    mkdirSync(pathDir);
    writeJson(join(pathDir, 'manifest.json'), {
      id: 'local-path',
      type: 'path',
      milestones: ['local-prerequisite'],
      testEnvironment: { tier: 'cloud' },
    });
    writeJson(join(pathDir, 'content.json'), { id: 'local-path', title: 'Local path', blocks: [] });
    writeJson(repositoryPath, {
      'local-path': {
        path: 'local-path/',
        type: 'path',
        milestones: ['local-prerequisite'],
        testEnvironment: { tier: 'cloud' },
      },
      'local-prerequisite': {
        path: 'local-prerequisite/',
        type: 'guide',
        testEnvironment: { tier: 'cloud' },
      },
    });

    const resolution = resolveLocalMetapackage({
      packageDir: pathDir,
      repositoryPath,
      grafanaUrl: 'http://localhost:3000',
      currentTier: 'cloud',
      cloudUrl: 'https://learn.grafana.net/',
      verbose: false,
      cloudTargetCapabilities: { sharedStackUrls: [], isolatedStack: true },
    });

    expect(resolution?.guides.map((guide) => JSON.parse(guide.content).id)).toEqual(['local-prerequisite']);
    expect(resolution?.packageMetaById.get('local-prerequisite')?.sourceUrl).toContain(
      `${root}/local-prerequisite/content.json`
    );
  });

  it('ignores stale index paths and resolves the package location from the checkout', () => {
    const outsideDir = mkdtempSync(join(tmpdir(), 'pathfinder-outside-'));
    try {
      writeJson(join(outsideDir, 'manifest.json'), {
        id: 'local-guide',
        type: 'guide',
        testEnvironment: { tier: 'cloud' },
      });
      writeJson(repositoryPath, {
        'local-guide': {
          path: `${outsideDir}/`,
          type: 'guide',
          testEnvironment: { tier: 'cloud' },
        },
      });
      const resolution = resolveLocalCloudGuide({
        packageDir: guideDir,
        repositoryPath,
        grafanaUrl: 'http://localhost:3000',
        currentTier: 'cloud',
        cloudUrl: 'https://learn.grafana.net/',
        verbose: false,
        cloudTargetCapabilities: { sharedStackUrls: [], isolatedStack: true },
      });

      expect(resolution.guides.map((guide) => JSON.parse(guide.content).id)).toEqual([
        'local-prerequisite',
        'local-guide',
      ]);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});
