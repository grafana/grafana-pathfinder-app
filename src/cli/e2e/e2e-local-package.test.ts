import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { resolveLocalMetapackage } from './e2e-local-package';

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function options(root: string, repository: string) {
  return {
    packageDir: join(root, 'path'),
    repositoryPath: repository,
    grafanaUrl: 'http://localhost:3000',
    currentTier: 'local' as const,
    cloudUrl: 'https://learn.grafana.net/',
    verbose: false,
  };
}

describe('local metapackage input resolution', () => {
  let root: string;
  let pathDir: string;
  let stepDir: string;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pathfinder-local-metapackage-'));
    pathDir = join(root, 'path');
    stepDir = join(root, 'step');
    mkdirSync(pathDir);
    mkdirSync(stepDir);
    writeJson(join(pathDir, 'manifest.json'), {
      id: 'coverless-path',
      type: 'path',
      milestones: ['coverless-step'],
      testEnvironment: { tier: 'local' },
    });
    writeJson(join(stepDir, 'content.json'), {
      id: 'coverless-step',
      title: 'Coverless step',
      blocks: [],
    });
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('preserves an explicit milestone starting location', () => {
    const repository = join(root, 'repository.json');
    writeJson(repository, {
      'coverless-path': {
        path: 'path/',
        type: 'path',
        milestones: ['coverless-step'],
        testEnvironment: { tier: 'local' },
      },
      'coverless-step': {
        path: 'step/',
        type: 'guide',
        startingLocation: '/connections',
        testEnvironment: { tier: 'local' },
      },
    });

    const inputs = resolveLocalMetapackage(options(root, repository))!;

    expect(inputs.packageMetaById.get('coverless-step')?.startingLocation).toBe('/connections');
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    rmSync(root, { recursive: true, force: true });
  });

  it('expands a valid path without requiring cover content.json', () => {
    const repository = join(root, 'repository.json');
    writeJson(repository, {
      'coverless-path': {
        path: 'path/',
        type: 'path',
        milestones: ['coverless-step'],
        testEnvironment: { tier: 'local' },
      },
      'coverless-step': {
        path: 'step/',
        type: 'guide',
        testEnvironment: { tier: 'local' },
      },
    });

    const inputs = resolveLocalMetapackage(options(root, repository))!;

    expect(inputs.selection).toEqual({ id: 'coverless-path', type: 'path' });
    expect(inputs.guides).toHaveLength(1);
    expect(JSON.parse(inputs.guides[0]!.content).id).toBe('coverless-step');
    expect(inputs.executionPlan?.chains[0]?.map((guide) => guide.id)).toEqual(['coverless-step']);
    expect(inputs.packageMetaById.get('coverless-step')?.startingLocation).toBeUndefined();
  });

  it('makes the root non-runnable when its own target is incompatible with the environment', () => {
    const repository = join(root, 'repository.json');
    writeJson(repository, {
      'coverless-path': {
        path: 'path/',
        type: 'path',
        milestones: ['coverless-step'],
        testEnvironment: { tier: 'cloud' },
      },
      'coverless-step': {
        path: 'step/',
        type: 'guide',
        testEnvironment: { tier: 'local' },
      },
    });

    const inputs = resolveLocalMetapackage(options(root, repository))!;

    expect(inputs.selection).toEqual({ id: 'coverless-path', type: 'path' });
    expect(inputs.guides).toEqual([]);
    expect(inputs.executionPlan).toBeUndefined();
    expect(inputs.packageMetaById.size).toBe(0);
    expect(inputs.preRunSkipped).toEqual([
      expect.objectContaining({
        id: 'coverless-path',
        status: 'skipped_tier_mismatch',
        abortMessage: expect.stringContaining('requires tier \"cloud\"'),
      }),
    ]);
  });

  it('rejects an otherwise-runnable milestone whose target differs from the root', () => {
    const repository = join(root, 'repository.json');
    writeJson(repository, {
      'coverless-path': {
        path: 'path/',
        type: 'path',
        milestones: ['coverless-step'],
        testEnvironment: { tier: 'local', instance: 'root.example.com' },
      },
      'coverless-step': {
        path: 'step/',
        type: 'guide',
        testEnvironment: { tier: 'local', instance: 'leaf.example.com' },
      },
    });

    const inputs = resolveLocalMetapackage(options(root, repository))!;

    expect(inputs.selection).toEqual({ id: 'coverless-path', type: 'path' });
    expect(inputs.guides).toEqual([]);
    expect(inputs.executionPlan).toBeUndefined();
    expect(inputs.packageMetaById.size).toBe(0);
    expect(inputs.preRunSkipped).toEqual([
      expect.objectContaining({
        id: 'coverless-path',
        status: 'resolution_failed',
        abortMessage: expect.stringContaining('mixes incompatible targets at guide \"coverless-step\"'),
      }),
    ]);
  });

  it('loads successful milestones in declared order', () => {
    const repository = join(root, 'repository.json');
    const secondStepDir = join(root, 'second-step');
    mkdirSync(secondStepDir);
    writeJson(join(secondStepDir, 'content.json'), {
      id: 'second-step',
      title: 'Second step',
      blocks: [],
    });
    writeJson(repository, {
      'coverless-path': {
        path: 'path/',
        type: 'path',
        milestones: ['coverless-step', 'second-step'],
        testEnvironment: { tier: 'local' },
      },
      'coverless-step': {
        path: 'step/',
        type: 'guide',
        testEnvironment: { tier: 'local' },
      },
      'second-step': {
        path: 'second-step/',
        type: 'guide',
        testEnvironment: { tier: 'local' },
      },
    });

    const inputs = resolveLocalMetapackage(options(root, repository))!;

    expect(inputs.guides.map((guide) => JSON.parse(guide.content).id)).toEqual(['coverless-step', 'second-step']);
    expect(inputs.executionPlan?.chains[0]?.map((guide) => guide.id)).toEqual(['coverless-step', 'second-step']);
    expect([...inputs.packageMetaById.keys()]).toEqual(['coverless-step', 'second-step']);
    expect(inputs.preRunSkipped).toEqual([]);
  });

  it('reports manifest and repository root type mismatches with selection', () => {
    const repository = join(root, 'repository.json');
    writeJson(repository, {
      'coverless-path': {
        path: 'path/',
        type: 'journey',
        milestones: ['coverless-step'],
        testEnvironment: { tier: 'local' },
      },
      'coverless-step': {
        path: 'step/',
        type: 'guide',
        testEnvironment: { tier: 'local' },
      },
    });

    try {
      resolveLocalMetapackage(options(root, repository));
      throw new Error('Expected local metapackage type validation to fail');
    } catch (error) {
      expect(error).toMatchObject({
        message: expect.stringContaining('manifest declares "path", repository declares "journey"'),
        selection: { id: 'coverless-path', type: 'path' },
      });
    }
  });

  it('makes the root non-runnable when any milestone is incompatible with the environment', () => {
    const repository = join(root, 'repository.json');
    const cloudStepDir = join(root, 'cloud-step');
    mkdirSync(cloudStepDir);
    writeJson(join(cloudStepDir, 'content.json'), {
      id: 'cloud-step',
      title: 'Cloud step',
      blocks: [],
    });
    writeJson(repository, {
      'coverless-path': {
        path: 'path/',
        type: 'path',
        milestones: ['coverless-step', 'cloud-step'],
        testEnvironment: { tier: 'local' },
      },
      'coverless-step': {
        path: 'step/',
        type: 'guide',
        testEnvironment: { tier: 'local' },
      },
      'cloud-step': {
        path: 'cloud-step/',
        type: 'guide',
        testEnvironment: { tier: 'cloud' },
      },
    });

    const inputs = resolveLocalMetapackage(options(root, repository))!;

    expect(inputs.selection).toEqual({ id: 'coverless-path', type: 'path' });
    expect(inputs.guides).toEqual([]);
    expect(inputs.executionPlan).toBeUndefined();
    expect(inputs.packageMetaById.size).toBe(0);
    expect(inputs.preRunSkipped).toEqual([
      expect.objectContaining({ id: 'cloud-step', status: 'skipped_tier_mismatch' }),
      expect.objectContaining({
        id: 'coverless-path',
        status: 'prerequisite_failed',
        abortMessage: expect.stringContaining('cloud-step'),
      }),
    ]);
  });

  it('does not partially execute independent milestones when one required milestone is unrunnable', () => {
    const repository = join(root, 'repository.json');
    const cloudStepDir = join(root, 'cloud-step');
    const independentStepDir = join(root, 'independent-step');
    mkdirSync(cloudStepDir);
    mkdirSync(independentStepDir);
    writeJson(join(cloudStepDir, 'content.json'), {
      id: 'cloud-step',
      title: 'Cloud step',
      blocks: [],
    });
    writeJson(join(independentStepDir, 'content.json'), {
      id: 'independent-step',
      title: 'Independent step',
      blocks: [],
    });
    writeJson(repository, {
      'coverless-path': {
        path: 'path/',
        type: 'path',
        milestones: ['cloud-step', 'coverless-step', 'independent-step'],
        testEnvironment: { tier: 'local' },
      },
      'cloud-step': {
        path: 'cloud-step/',
        type: 'guide',
        testEnvironment: { tier: 'cloud' },
      },
      'coverless-step': {
        path: 'step/',
        type: 'guide',
        testEnvironment: { tier: 'local' },
      },
      'independent-step': {
        path: 'independent-step/',
        type: 'guide',
        testEnvironment: { tier: 'local' },
      },
    });

    const inputs = resolveLocalMetapackage(options(root, repository))!;

    expect(inputs.guides).toEqual([]);
    expect(inputs.executionPlan).toBeUndefined();
    expect(inputs.preRunSkipped.map((skip) => skip.id)).toEqual(['cloud-step', 'coverless-path']);
  });

  it('attaches root selection to a local milestone planning error', () => {
    const repository = join(root, 'missing-repository.json');
    writeJson(repository, {
      'coverless-path': {
        path: 'path/',
        type: 'path',
        milestones: ['coverless-step'],
        testEnvironment: { tier: 'local' },
      },
    });

    try {
      resolveLocalMetapackage(options(root, repository));
      throw new Error('Expected local metapackage planning to fail');
    } catch (error) {
      expect(error).toMatchObject({
        message: expect.stringContaining('Failed to plan guide execution'),
        selection: { id: 'coverless-path', type: 'path' },
      });
    }
  });
});
