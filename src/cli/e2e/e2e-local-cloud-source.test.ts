import { execFileSync } from 'child_process';
import fs, { linkSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative } from 'path';

import {
  assertLocalCloudCheckoutSources,
  assertLocalCloudSelectedPackageSources,
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
      expect(() => assertLocalCloudSelectedPackageSources(root, outside)).toThrow('outside the local repository');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it.each([
    '.git/guide',
    '.github/guide',
    'node_modules/guide',
    'scripts/guide',
    'assets/guide',
    'local-guide/assets/guide',
  ])('rejects a selected package under %s', (location) => {
    const selected = join(root, location);
    mkdirSync(selected, { recursive: true });
    expect(() => assertLocalCloudCheckoutSources(root, selected)).toThrow('outside the package catalog');
    expect(() => assertLocalCloudSelectedPackageSources(root, selected)).toThrow('outside the package catalog');
  });

  it('rejects the checkout root as the selected package', () => {
    expect(() => assertLocalCloudSelectedPackageSources(root, root)).toThrow('outside the local repository');
  });

  it.each(['symbolic', 'hard'] as const)('checks only selected metadata despite an unrelated %s link', (kind) => {
    const target = join(prerequisiteDir, 'content.json');
    const linked = join(root, 'unrelated-link.json');
    if (kind === 'symbolic') {
      symlinkSync(target, linked);
    } else {
      linkSync(target, linked);
    }
    const scanSpy = jest.spyOn(fs, 'readdirSync');
    const readSpy = jest.spyOn(fs, 'readFileSync');
    try {
      expect(() => assertLocalCloudSelectedPackageSources(root, guideDir)).not.toThrow();
      expect(scanSpy).not.toHaveBeenCalled();
      expect(readSpy).not.toHaveBeenCalled();
    } finally {
      scanSpy.mockRestore();
      readSpy.mockRestore();
    }
    expect(() => assertLocalCloudCheckoutSources(root, guideDir)).toThrow(`${kind} link`);
  });

  it.each(['directory', 'index file'] as const)('accepts a safe selection with a repository %s', (kind) => {
    writeJson(repositoryPath, {});
    expect(() =>
      assertLocalCloudSelectedPackageSources(kind === 'directory' ? root : repositoryPath, guideDir)
    ).not.toThrow();
  });

  it('accepts a safe selection without a repository and leaves missing manifests to the loader', () => {
    expect(() => assertLocalCloudSelectedPackageSources(undefined, guideDir)).not.toThrow();
    rmSync(join(guideDir, 'manifest.json'));
    expect(() => assertLocalCloudSelectedPackageSources(root, guideDir)).not.toThrow();
    expect(() => assertLocalCloudSelectedPackageSources(undefined, guideDir)).not.toThrow();
  });

  it.each(['selected directory', 'ancestor'] as const)(
    'rejects a linked %s inside the checkout before manifest reads',
    (kind) => {
      const linked = join(root, 'linked');
      symlinkSync(kind === 'selected directory' ? guideDir : root, linked);
      const selected = kind === 'selected directory' ? linked : join(linked, 'local-guide');
      const readSpy = jest.spyOn(fs, 'readFileSync');
      try {
        expect(() => assertLocalCloudSelectedPackageSources(root, selected)).toThrow('symbolic link');
        expect(readSpy).not.toHaveBeenCalled();
      } finally {
        readSpy.mockRestore();
      }
    }
  );

  it('rejects a linked selected directory without a repository', () => {
    const linked = join(root, 'linked-guide');
    symlinkSync(guideDir, linked);
    expect(() => assertLocalCloudSelectedPackageSources(undefined, linked)).toThrow('symbolic link');
  });

  it('accepts checkout-root aliases with aliased and canonical selected paths', () => {
    const outside = mkdtempSync(join(tmpdir(), 'pathfinder-checkout-alias-'));
    try {
      const alias = join(outside, 'checkout');
      symlinkSync(root, alias);
      expect(() => assertLocalCloudSelectedPackageSources(alias, join(alias, 'local-guide'))).not.toThrow();
      expect(() => assertLocalCloudSelectedPackageSources(alias, guideDir)).not.toThrow();
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  (process.platform === 'win32' ? it.skip : it)('rejects a FIFO manifest before reading it', () => {
    const manifestPath = join(guideDir, 'manifest.json');
    rmSync(manifestPath);
    execFileSync('mkfifo', [manifestPath]);
    const readSpy = jest.spyOn(fs, 'readFileSync');
    try {
      expect(() => assertLocalCloudSelectedPackageSources(root, guideDir)).toThrow('special file');
      expect(readSpy).not.toHaveBeenCalled();
    } finally {
      readSpy.mockRestore();
    }
  });

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
