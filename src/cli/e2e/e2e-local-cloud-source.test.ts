import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { resolveLocalCloudGuide, resolveLocalMetapackage } from './e2e-local-package';

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
