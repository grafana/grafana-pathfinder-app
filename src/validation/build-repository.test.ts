/**
 * Build Repository Integration Tests (Layer 1)
 *
 * Tests the build-repository command against sample package trees.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { buildRepository } from '../cli/commands/build-repository';

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pathfinder-build-repo-'));
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

describe('buildRepository', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return empty repository for empty directory', () => {
    const { repository, warnings, errors } = buildRepository(tmpDir);
    expect(Object.keys(repository)).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
    expect(errors).toHaveLength(0);
  });

  it('should skip content-only directories without manifest.json', () => {
    writeJson(path.join(tmpDir, 'welcome-to-grafana', 'content.json'), {
      id: 'welcome-to-grafana',
      title: 'Welcome to Grafana',
      blocks: [{ type: 'markdown', content: '# Welcome' }],
    });

    writeJson(path.join(tmpDir, 'first-dashboard', 'content.json'), {
      id: 'first-dashboard',
      title: 'Create your first dashboard',
      blocks: [],
    });

    const { repository, warnings, errors } = buildRepository(tmpDir);

    expect(errors).toHaveLength(0);
    expect(Object.keys(repository)).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('should build repository from packages with manifest.json', () => {
    writeJson(path.join(tmpDir, 'prometheus-101', 'content.json'), {
      id: 'prometheus-101',
      title: 'Prometheus & Grafana 101',
      blocks: [],
    });

    writeJson(path.join(tmpDir, 'prometheus-101', 'manifest.json'), {
      id: 'prometheus-101',
      type: 'guide',
      description: 'Learn Prometheus and Grafana',
      category: 'data-availability',
      startingLocation: '/connections',
      depends: ['welcome-to-grafana'],
      provides: ['datasource-configured'],
    });

    const { repository, errors } = buildRepository(tmpDir);

    expect(errors).toHaveLength(0);
    expect(Object.keys(repository)).toHaveLength(1);

    const entry = repository['prometheus-101'];
    expect(entry).toBeDefined();
    expect(entry!.type).toBe('guide');
    expect(entry!.description).toBe('Learn Prometheus and Grafana');
    expect(entry!.category).toBe('data-availability');
    expect(entry!.depends).toEqual(['welcome-to-grafana']);
    expect(entry!.provides).toEqual(['datasource-configured']);
  });

  it('should denormalize manifest metadata into repository entries', () => {
    writeJson(path.join(tmpDir, 'test-guide', 'content.json'), {
      id: 'test-guide',
      title: 'Test guide',
      blocks: [],
    });

    writeJson(path.join(tmpDir, 'test-guide', 'manifest.json'), {
      id: 'test-guide',
      type: 'guide',
      description: 'A test guide',
      category: 'testing',
      startingLocation: '/test',
      depends: ['dep-a', ['dep-b', 'dep-c']],
      recommends: ['rec-a'],
      suggests: ['sug-a'],
      provides: ['test-capability'],
      conflicts: ['old-test'],
      replaces: ['legacy-test'],
    });

    const { repository, errors } = buildRepository(tmpDir);
    expect(errors).toHaveLength(0);

    const entry = repository['test-guide'];
    expect(entry).toBeDefined();
    expect(entry!.description).toBe('A test guide');
    expect(entry!.category).toBe('testing');
    expect(entry!.startingLocation).toBe('/test');
    expect(entry!.depends).toEqual(['dep-a', ['dep-b', 'dep-c']]);
    expect(entry!.recommends).toEqual(['rec-a']);
    expect(entry!.suggests).toEqual(['sug-a']);
    expect(entry!.provides).toEqual(['test-capability']);
    expect(entry!.conflicts).toEqual(['old-test']);
    expect(entry!.replaces).toEqual(['legacy-test']);
  });

  it('should error on ID mismatch between content and manifest', () => {
    writeJson(path.join(tmpDir, 'mismatched', 'content.json'), {
      id: 'content-id',
      title: 'Test',
      blocks: [],
    });

    writeJson(path.join(tmpDir, 'mismatched', 'manifest.json'), {
      id: 'manifest-id',
      type: 'guide',
    });

    const { errors } = buildRepository(tmpDir);
    expect(errors.some((e) => e.includes('ID mismatch'))).toBe(true);
  });

  it('should error on duplicate package IDs', () => {
    writeJson(path.join(tmpDir, 'pkg-a', 'content.json'), {
      id: 'duplicate-id',
      title: 'Package A',
      blocks: [],
    });
    writeJson(path.join(tmpDir, 'pkg-a', 'manifest.json'), {
      id: 'duplicate-id',
      type: 'guide',
    });

    writeJson(path.join(tmpDir, 'pkg-b', 'content.json'), {
      id: 'duplicate-id',
      title: 'Package B',
      blocks: [],
    });
    writeJson(path.join(tmpDir, 'pkg-b', 'manifest.json'), {
      id: 'duplicate-id',
      type: 'guide',
    });

    const { errors } = buildRepository(tmpDir);
    expect(errors.some((e) => e.includes('Duplicate package ID'))).toBe(true);
  });

  it('should warn on invalid manifest but still include content-only entry', () => {
    writeJson(path.join(tmpDir, 'bad-manifest', 'content.json'), {
      id: 'bad-manifest',
      title: 'Guide with bad manifest',
      blocks: [],
    });

    writeJson(path.join(tmpDir, 'bad-manifest', 'manifest.json'), {
      type: 'invalid-type',
    });

    const { repository, warnings } = buildRepository(tmpDir);
    expect(warnings.length).toBeGreaterThan(0);
    expect(repository['bad-manifest']).toBeDefined();
    expect(repository['bad-manifest']!.type).toBe('guide');
  });

  it('should skip non-directory entries', () => {
    writeJson(path.join(tmpDir, 'guide-a', 'content.json'), {
      id: 'guide-a',
      title: 'Guide A',
      blocks: [],
    });
    writeJson(path.join(tmpDir, 'guide-a', 'manifest.json'), {
      id: 'guide-a',
      type: 'guide',
    });

    fs.writeFileSync(path.join(tmpDir, 'stray-file.json'), '{}', 'utf-8');

    const { repository, errors } = buildRepository(tmpDir);
    expect(errors).toHaveLength(0);
    expect(Object.keys(repository)).toHaveLength(1);
    expect(repository['guide-a']).toBeDefined();
  });

  it('should skip directories without manifest.json', () => {
    fs.mkdirSync(path.join(tmpDir, 'empty-dir'));
    writeJson(path.join(tmpDir, 'valid-guide', 'content.json'), {
      id: 'valid-guide',
      title: 'Valid guide',
      blocks: [],
    });
    writeJson(path.join(tmpDir, 'valid-guide', 'manifest.json'), {
      id: 'valid-guide',
      type: 'guide',
    });
    writeJson(path.join(tmpDir, 'content-only', 'content.json'), {
      id: 'content-only',
      title: 'Content only',
      blocks: [],
    });

    const { repository, errors } = buildRepository(tmpDir);
    expect(errors).toHaveLength(0);
    expect(Object.keys(repository)).toHaveLength(1);
  });

  it('should discover package directories recursively and emit nested relative paths', () => {
    writeJson(path.join(tmpDir, 'journeys', 'infra-alerting', 'content.json'), {
      id: 'infra-alerting',
      title: 'Infrastructure alerting',
      blocks: [],
    });
    writeJson(path.join(tmpDir, 'journeys', 'infra-alerting', 'manifest.json'), {
      id: 'infra-alerting',
      type: 'journey',
      steps: ['infra-alerting-find-data'],
    });

    writeJson(path.join(tmpDir, 'journeys', 'infra-alerting', 'steps', 'find-data', 'content.json'), {
      id: 'infra-alerting-find-data',
      title: 'Find data',
      blocks: [],
    });
    writeJson(path.join(tmpDir, 'journeys', 'infra-alerting', 'steps', 'find-data', 'manifest.json'), {
      id: 'infra-alerting-find-data',
      type: 'guide',
    });

    const { repository, errors } = buildRepository(tmpDir);
    expect(errors).toHaveLength(0);
    expect(repository['infra-alerting']?.path).toBe('journeys/infra-alerting/');
    expect(repository['infra-alerting-find-data']?.path).toBe('journeys/infra-alerting/steps/find-data/');
  });

  it('should not recurse into assets subdirectories when discovering manifests', () => {
    writeJson(path.join(tmpDir, 'guide-a', 'content.json'), {
      id: 'guide-a',
      title: 'Guide A',
      blocks: [],
    });
    writeJson(path.join(tmpDir, 'guide-a', 'manifest.json'), {
      id: 'guide-a',
      type: 'guide',
    });

    // If assets/ were traversed, this would be picked up and cause a missing content.json error.
    writeJson(path.join(tmpDir, 'guide-a', 'assets', 'shadow', 'manifest.json'), {
      id: 'shadow',
      type: 'guide',
    });

    const { repository, errors } = buildRepository(tmpDir);
    expect(errors).toHaveLength(0);
    expect(repository['guide-a']).toBeDefined();
    expect(repository['shadow']).toBeUndefined();
  });

  it('should handle path-type packages with steps', () => {
    writeJson(path.join(tmpDir, 'getting-started', 'content.json'), {
      id: 'getting-started',
      title: 'Getting started path',
      blocks: [],
    });

    writeJson(path.join(tmpDir, 'getting-started', 'manifest.json'), {
      id: 'getting-started',
      type: 'path',
      steps: ['welcome-to-grafana', 'first-dashboard'],
    });

    const { repository, errors } = buildRepository(tmpDir);
    expect(errors).toHaveLength(0);

    const entry = repository['getting-started'];
    expect(entry).toBeDefined();
    expect(entry!.type).toBe('path');
    expect(entry!.steps).toEqual(['welcome-to-grafana', 'first-dashboard']);
  });

  it('should omit empty dependency arrays from entries', () => {
    writeJson(path.join(tmpDir, 'no-deps', 'content.json'), {
      id: 'no-deps',
      title: 'No dependencies',
      blocks: [],
    });

    writeJson(path.join(tmpDir, 'no-deps', 'manifest.json'), {
      id: 'no-deps',
      type: 'guide',
      depends: [],
      recommends: [],
    });

    const { repository, errors } = buildRepository(tmpDir);
    expect(errors).toHaveLength(0);

    const entry = repository['no-deps'];
    expect(entry).toBeDefined();
    expect(entry!.depends).toBeUndefined();
    expect(entry!.recommends).toBeUndefined();
  });

  it('should handle non-existent root directory', () => {
    const { repository, warnings } = buildRepository('/nonexistent/path');
    expect(Object.keys(repository)).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });
});
