import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { buildRepository, runBuildRepository } from '../commands/build-repository';
import { contentDigest } from './e2e-reporter';
import { loadLocalRepositorySource, resolveLocalCloudGuide, resolveLocalMetapackage } from './e2e-local-package';

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value)}\n`);
}

describe('local cloud catalog from a working checkout', () => {
  let root: string;
  let catalogPath: string;
  let rootDir: string;
  let prerequisiteDir: string;
  let stdout: jest.SpyInstance;
  let stderr: jest.SpyInstance;
  let originalFetch: typeof fetch | undefined;
  let fetchSpy: jest.Mock;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pathfinder-cloud-catalog-'));
    catalogPath = join(root, 'repository.json');
    rootDir = join(root, 'renamed-directory');
    prerequisiteDir = join(root, 'prerequisite');
    mkdirSync(rootDir);
    mkdirSync(prerequisiteDir);
    writeJson(join(rootDir, 'manifest.json'), {
      id: 'cloud-root',
      type: 'guide',
      depends: ['prerequisite'],
      testEnvironment: { tier: 'cloud' },
    });
    writeJson(join(prerequisiteDir, 'manifest.json'), {
      id: 'prerequisite',
      type: 'guide',
      testEnvironment: { tier: 'cloud' },
    });
    writeJson(join(rootDir, 'content.json'), {
      id: 'cloud-root',
      title: 'Working root',
      blocks: [{ type: 'markdown', content: 'Working root content' }],
    });
    writeJson(join(prerequisiteDir, 'content.json'), {
      id: 'prerequisite',
      title: 'Working prerequisite',
      blocks: [{ type: 'markdown', content: 'Working prerequisite content' }],
    });
    stdout = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    stderr = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    originalFetch = global.fetch;
    fetchSpy = jest.fn(() => {
      throw new Error('Remote content requested');
    });
    Object.defineProperty(global, 'fetch', { configurable: true, value: fetchSpy });
  });

  afterEach(() => {
    stdout.mockRestore();
    stderr.mockRestore();
    if (originalFetch) {
      Object.defineProperty(global, 'fetch', { configurable: true, value: originalFetch });
    } else {
      delete (global as Partial<typeof global>).fetch;
    }
    rmSync(root, { recursive: true, force: true });
  });

  function buildCurrentCatalog(): void {
    const { repository, errors } = buildRepository(root);
    expect(errors).toEqual([]);
    writeJson(catalogPath, repository);
  }

  function resolveRoot(repositoryPath = catalogPath) {
    return resolveLocalCloudGuide({
      packageDir: rootDir,
      repositoryPath,
      grafanaUrl: 'http://localhost:3000',
      currentTier: 'cloud',
      cloudUrl: 'https://learn.grafana.net/',
      verbose: false,
      cloudTargetCapabilities: { sharedStackUrls: [], isolatedStack: true },
    });
  }

  function addDuplicatePackage(directory: string, id: string, provides?: string[]): void {
    const duplicateDir = join(root, directory);
    mkdirSync(duplicateDir);
    writeJson(join(duplicateDir, 'manifest.json'), {
      id,
      type: 'guide',
      ...(provides ? { provides } : {}),
      testEnvironment: { tier: 'cloud' },
    });
    writeJson(join(duplicateDir, 'content.json'), {
      id,
      title: `Duplicate in ${directory}`,
      blocks: [{ type: 'markdown', content: 'Duplicate content' }],
    });
  }

  it('rejects a duplicate selected root ID even when the selected directory is the first builder entry', () => {
    addDuplicatePackage('z-shadow-root', 'cloud-root');
    expect(loadLocalRepositorySource(root, true, true).duplicateIds).toEqual(new Set(['cloud-root']));
    expect(() => resolveRoot(root)).toThrow('Selected local cloud graph contains duplicate package ID "cloud-root"');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a duplicate required guide ID across renamed directories', () => {
    addDuplicatePackage('a-renamed-prerequisite', 'prerequisite');
    expect(loadLocalRepositorySource(root, true, true).duplicateIds).toEqual(new Set(['prerequisite']));
    expect(() => resolveRoot(root)).toThrow('Selected local cloud graph contains duplicate package ID "prerequisite"');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a duplicate provider ID for a required capability', () => {
    writeJson(join(rootDir, 'manifest.json'), {
      id: 'cloud-root',
      type: 'guide',
      depends: ['dashboard-ready'],
      testEnvironment: { tier: 'cloud' },
    });
    writeJson(join(prerequisiteDir, 'manifest.json'), {
      id: 'prerequisite',
      type: 'guide',
      provides: ['dashboard-ready'],
      testEnvironment: { tier: 'cloud' },
    });
    addDuplicatePackage('z-renamed-provider', 'prerequisite', ['dashboard-ready']);
    expect(loadLocalRepositorySource(root, true, true).duplicateIds).toEqual(new Set(['prerequisite']));
    expect(() => resolveRoot(root)).toThrow('Selected local cloud graph contains duplicate package ID "prerequisite"');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a duplicate milestone package ID required by a selected path', () => {
    const pathDir = join(root, 'selected-path');
    mkdirSync(pathDir);
    writeJson(join(pathDir, 'manifest.json'), {
      id: 'selected-path',
      type: 'path',
      milestones: ['prerequisite'],
      testEnvironment: { tier: 'cloud' },
    });
    writeJson(join(pathDir, 'content.json'), { id: 'selected-path', title: 'Selected path', blocks: [] });
    addDuplicatePackage('z-renamed-milestone', 'prerequisite');
    expect(() =>
      resolveLocalMetapackage({
        packageDir: pathDir,
        repositoryPath: root,
        grafanaUrl: 'http://localhost:3000',
        currentTier: 'cloud',
        cloudUrl: 'https://learn.grafana.net/',
        verbose: false,
        cloudTargetCapabilities: { sharedStackUrls: [], isolatedStack: true },
      })
    ).toThrow('Selected local cloud graph contains duplicate package ID "prerequisite"');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not reject a duplicated capability provider when another provider is selected', () => {
    writeJson(join(rootDir, 'manifest.json'), {
      id: 'cloud-root',
      type: 'guide',
      depends: ['dashboard-ready'],
      testEnvironment: { tier: 'cloud' },
    });
    addDuplicatePackage('aaa-provider-directory', 'aaa-provider', ['dashboard-ready']);
    addDuplicatePackage('unused-provider-one', 'zzz-provider', ['dashboard-ready']);
    addDuplicatePackage('unused-provider-two', 'zzz-provider', ['dashboard-ready']);
    const ids = resolveRoot(root).guides.map((guide) => JSON.parse(guide.content).id);
    expect(ids).toContain('aaa-provider');
    expect(ids).not.toContain('zzz-provider');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not reject duplicates disconnected from the selected graph', () => {
    addDuplicatePackage('unrelated-one', 'unrelated');
    addDuplicatePackage('unrelated-two', 'unrelated');
    expect(resolveRoot(root).guides.map((guide) => JSON.parse(guide.content).id)).toEqual([
      'prerequisite',
      'cloud-root',
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('builds an in-memory catalog from a checkout directory without creating an index', () => {
    writeJson(join(prerequisiteDir, 'manifest.json'), {
      id: 'prerequisite',
      type: 'guide',
      testEnvironment: { tier: 'cloud', minVersion: '12.0.0' },
    });
    writeJson(join(prerequisiteDir, 'content.json'), {
      id: 'prerequisite',
      title: 'Uncommitted prerequisite',
      blocks: [{ type: 'markdown', content: 'Uncommitted content' }],
    });
    const rootEntries = readdirSync(root).sort();
    const resolution = resolveLocalCloudGuide({
      packageDir: rootDir,
      repositoryPath: root,
      grafanaUrl: 'http://localhost:3000',
      currentTier: 'cloud',
      cloudUrl: 'https://learn.grafana.net/',
      verbose: false,
      cloudTargetCapabilities: { sharedStackUrls: [], isolatedStack: true },
    });

    expect(resolution.guides.map((guide) => JSON.parse(guide.content).id)).toEqual(['prerequisite', 'cloud-root']);
    expect(resolution.guides[0]?.content).toContain('Uncommitted content');
    expect(resolution.guides[0]?.content).toBe(readFileSync(join(prerequisiteDir, 'content.json'), 'utf8'));
    expect(resolution.packageMetaById.get('prerequisite')?.sourceUrl).toBe(join(prerequisiteDir, 'content.json'));
    expect(readdirSync(root).sort()).toEqual(rootEntries);
    expect(existsSync(catalogPath)).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fails closed with a checkout directory when the selected graph has a missing dependency', () => {
    writeJson(join(prerequisiteDir, 'manifest.json'), {
      id: 'prerequisite',
      type: 'guide',
      depends: ['missing-package'],
      testEnvironment: { tier: 'cloud' },
    });
    expect(() =>
      resolveLocalCloudGuide({
        packageDir: rootDir,
        repositoryPath: root,
        grafanaUrl: 'http://localhost:3000',
        currentTier: 'cloud',
        cloudUrl: 'https://learn.grafana.net/',
        verbose: false,
        cloudTargetCapabilities: { sharedStackUrls: [], isolatedStack: true },
      })
    ).toThrow('does not resolve to a known package or capability');
    expect(existsSync(catalogPath)).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('indexes uncommitted root and prerequisite bytes by manifest ID, not directory name or published content', async () => {
    buildCurrentCatalog();
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
    expect(catalog['cloud-root'].path).toBe('renamed-directory/');
    expect(catalog['cloud-root'].depends).toEqual(['prerequisite']);

    const resolution = resolveRoot();
    expect(
      resolution.guides.map((guide) => ({
        id: JSON.parse(guide.content).id,
        digest: contentDigest(guide.content),
      }))
    ).toEqual([
      { id: 'prerequisite', digest: contentDigest(readFileSync(join(prerequisiteDir, 'content.json'), 'utf8')) },
      { id: 'cloud-root', digest: contentDigest(readFileSync(join(rootDir, 'content.json'), 'utf8')) },
    ]);
    expect(resolution.guides[0]?.content).toContain('Working prerequisite content');
    expect(resolution.guides[1]?.content).toContain('Working root content');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rebuilds changed prerequisite dependencies and target requirements from that checkout', async () => {
    const setupDir = join(root, 'setup');
    mkdirSync(setupDir);
    writeJson(join(setupDir, 'manifest.json'), {
      id: 'setup',
      type: 'guide',
      testEnvironment: { tier: 'cloud' },
    });
    writeJson(join(setupDir, 'content.json'), {
      id: 'setup',
      title: 'Working setup',
      blocks: [{ type: 'markdown', content: 'Unpublished setup' }],
    });
    writeJson(join(prerequisiteDir, 'manifest.json'), {
      id: 'prerequisite',
      type: 'guide',
      depends: ['setup'],
      testEnvironment: { tier: 'cloud', minVersion: '12.0.0', plugins: ['required-plugin'] },
    });

    buildCurrentCatalog();
    const resolution = resolveRoot();
    expect(resolution.guides.map((guide) => JSON.parse(guide.content).id)).toEqual([
      'setup',
      'prerequisite',
      'cloud-root',
    ]);
    expect(resolution.packageMetaById.get('prerequisite')?.plugins).toEqual(['required-plugin']);
    expect(resolution.guides[0]?.content).toContain('Unpublished setup');
    expect(JSON.parse(readFileSync(catalogPath, 'utf8'))['prerequisite']).toMatchObject({
      depends: ['setup'],
      testEnvironment: { minVersion: '12.0.0', plugins: ['required-plugin'] },
    });
  });

  it('refuses stale repository metadata rather than falling back to a remote dependency', async () => {
    buildCurrentCatalog();
    writeJson(join(prerequisiteDir, 'manifest.json'), {
      id: 'prerequisite',
      type: 'guide',
      depends: ['unpublished-new-guide'],
      testEnvironment: { tier: 'cloud' },
    });
    const previousFetch = global.fetch;
    const fetchSpy = jest.fn(() => {
      throw new Error('Remote content requested');
    });
    Object.defineProperty(global, 'fetch', { configurable: true, value: fetchSpy });
    try {
      expect(resolveRoot).toThrow('does not resolve to a known package or capability');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      if (previousFetch) {
        Object.defineProperty(global, 'fetch', { configurable: true, value: previousFetch });
      } else {
        delete (global as Partial<typeof global>).fetch;
      }
    }
  });

  it('does not let stale provides metadata redirect the selected prerequisite', () => {
    const decoyDir = join(root, 'decoy-provider');
    mkdirSync(decoyDir);
    writeJson(join(rootDir, 'manifest.json'), {
      id: 'cloud-root',
      type: 'guide',
      depends: ['database-ready'],
      testEnvironment: { tier: 'cloud' },
    });
    writeJson(join(rootDir, 'content.json'), {
      id: 'cloud-root',
      title: 'Working root',
      blocks: [{ type: 'markdown', content: 'Working root content' }],
    });
    writeJson(join(prerequisiteDir, 'manifest.json'), {
      id: 'prerequisite',
      type: 'guide',
      provides: ['database-ready'],
      testEnvironment: { tier: 'cloud' },
    });
    writeJson(join(decoyDir, 'manifest.json'), {
      id: 'decoy-provider',
      type: 'guide',
      testEnvironment: { tier: 'cloud' },
    });
    writeJson(join(decoyDir, 'content.json'), {
      id: 'decoy-provider',
      title: 'Decoy provider',
      blocks: [{ type: 'markdown', content: 'Decoy content' }],
    });
    buildCurrentCatalog();
    const staleCatalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as Record<string, any>;
    staleCatalog.prerequisite.provides = [];
    staleCatalog['decoy-provider'].provides = ['database-ready'];
    writeJson(catalogPath, staleCatalog);

    const resolution = resolveRoot();

    expect(resolution.guides.map((guide) => JSON.parse(guide.content).id)).toContain('prerequisite');
    expect(resolution.guides.map((guide) => JSON.parse(guide.content).id)).not.toContain('decoy-provider');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('resolves path milestones directly from a checkout directory without an index', () => {
    const pathDir = join(root, 'selected-path');
    mkdirSync(pathDir);
    writeJson(join(pathDir, 'manifest.json'), {
      id: 'selected-path',
      type: 'path',
      milestones: ['prerequisite'],
      testEnvironment: { tier: 'cloud' },
    });
    writeJson(join(pathDir, 'content.json'), { id: 'selected-path', title: 'Selected path', blocks: [] });

    const resolution = resolveLocalMetapackage({
      packageDir: pathDir,
      repositoryPath: root,
      grafanaUrl: 'http://localhost:3000',
      currentTier: 'cloud',
      cloudUrl: 'https://learn.grafana.net/',
      verbose: false,
      cloudTargetCapabilities: { sharedStackUrls: [], isolatedStack: true },
    });
    expect(resolution?.guides.map((guide) => JSON.parse(guide.content).id)).toEqual(['prerequisite']);
    expect(existsSync(catalogPath)).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not let stale nested path milestones select a different local leaf', () => {
    const pathDir = join(root, 'selected-path');
    const nestedPathDir = join(root, 'nested-path');
    const decoyDir = join(root, 'stale-leaf');
    mkdirSync(pathDir);
    mkdirSync(nestedPathDir);
    mkdirSync(decoyDir);
    writeJson(join(pathDir, 'manifest.json'), {
      id: 'selected-path',
      type: 'path',
      milestones: ['nested-path'],
      testEnvironment: { tier: 'cloud' },
    });
    writeJson(join(pathDir, 'content.json'), { id: 'selected-path', title: 'Selected path', blocks: [] });
    writeJson(join(nestedPathDir, 'manifest.json'), {
      id: 'nested-path',
      type: 'path',
      milestones: ['prerequisite'],
      testEnvironment: { tier: 'cloud' },
    });
    writeJson(join(nestedPathDir, 'content.json'), {
      id: 'nested-path',
      title: 'Nested path',
      blocks: [],
    });
    writeJson(join(decoyDir, 'manifest.json'), {
      id: 'stale-leaf',
      type: 'guide',
      testEnvironment: { tier: 'cloud' },
    });
    writeJson(join(decoyDir, 'content.json'), {
      id: 'stale-leaf',
      title: 'Stale leaf',
      blocks: [{ type: 'markdown', content: 'Stale content' }],
    });
    buildCurrentCatalog();
    const staleCatalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as Record<string, any>;
    staleCatalog['nested-path'].milestones = ['stale-leaf'];
    writeJson(catalogPath, staleCatalog);

    const resolution = resolveLocalMetapackage({
      packageDir: pathDir,
      repositoryPath: catalogPath,
      grafanaUrl: 'http://localhost:3000',
      currentTier: 'cloud',
      cloudUrl: 'https://learn.grafana.net/',
      verbose: false,
      cloudTargetCapabilities: { sharedStackUrls: [], isolatedStack: true },
    });

    expect(resolution?.guides.map((guide) => JSON.parse(guide.content).id)).toContain('prerequisite');
    expect(resolution?.guides.map((guide) => JSON.parse(guide.content).id)).not.toContain('stale-leaf');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not let stale startingLocation metadata replace the checkout manifest value', () => {
    writeJson(join(prerequisiteDir, 'manifest.json'), {
      id: 'prerequisite',
      type: 'guide',
      testEnvironment: { tier: 'cloud' },
      startingLocation: '/working-checkout',
    });
    buildCurrentCatalog();
    const staleCatalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as Record<string, any>;
    staleCatalog.prerequisite.startingLocation = '/stale-index';
    writeJson(catalogPath, staleCatalog);

    const resolution = resolveRoot();

    expect(resolution.packageMetaById.get('prerequisite')?.startingLocation).toBe('/working-checkout');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ignores unrelated package build errors when the selected checkout graph is valid', () => {
    const unrelatedDir = join(root, 'unrelated-invalid-package');
    mkdirSync(unrelatedDir);
    writeJson(join(unrelatedDir, 'manifest.json'), { id: 'unrelated-invalid', type: 'guide' });
    const { repository, errors } = buildRepository(root);
    expect(errors).toHaveLength(1);
    writeJson(catalogPath, repository);

    const resolution = resolveRoot();

    expect(resolution.guides.map((guide) => JSON.parse(guide.content).id)).toEqual(['prerequisite', 'cloud-root']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not write an executable catalog when the trusted builder finds an invalid selected package', async () => {
    writeJson(join(prerequisiteDir, 'content.json'), {
      id: 'unexpected-id',
      title: 'Mismatched prerequisite',
      blocks: [],
    });
    const built = buildRepository(root);
    expect(built.errors).toContain(
      'prerequisite: ID mismatch: content.json has "unexpected-id", manifest.json has "prerequisite"'
    );
    const result = await runBuildRepository({ root, output: catalogPath, exclude: [] });
    expect(result).toMatchObject({ status: 'error', code: 'BUILD_FAILED' });
    expect(existsSync(catalogPath)).toBe(false);
    expect(resolveRoot).toThrow('Repository index not found');
  });
});
