/**
 * Tests for manifest pre-flight checking logic.
 *
 * Tests the pure functions and the orchestration logic in manifest-preflight.ts.
 * Network calls are mocked via jest.spyOn(global, 'fetch').
 */

import {
  checkTier,
  checkMinVersion,
  checkPlugins,
  runManifestPreflight,
  parseVersion,
  compareVersions,
  loadManifestFromDir,
  type CurrentTier,
} from '../utils/manifest-preflight';
import type { ManifestJson, TestEnvironment } from '../../types/package.types';

import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// ============ parseVersion ============

describe('parseVersion', () => {
  it('parses a standard semver string', () => {
    expect(parseVersion('12.2.0')).toEqual([12, 2, 0]);
  });

  it('parses a semver with pre-release suffix', () => {
    expect(parseVersion('12.2.0-pre')).toEqual([12, 2, 0]);
  });

  it('parses a semver with build metadata', () => {
    expect(parseVersion('12.2.0+security-01')).toEqual([12, 2, 0]);
  });

  it('returns null for non-semver strings', () => {
    expect(parseVersion('not-a-version')).toBeNull();
    expect(parseVersion('')).toBeNull();
    expect(parseVersion('12.2')).toBeNull();
  });
});

// ============ compareVersions ============

describe('compareVersions', () => {
  it('returns 0 for equal versions', () => {
    expect(compareVersions([12, 2, 0], [12, 2, 0])).toBe(0);
  });

  it('returns negative when a < b (major)', () => {
    expect(compareVersions([11, 0, 0], [12, 0, 0])).toBeLessThan(0);
  });

  it('returns positive when a > b (minor)', () => {
    expect(compareVersions([12, 3, 0], [12, 2, 0])).toBeGreaterThan(0);
  });

  it('returns negative when patch differs', () => {
    expect(compareVersions([12, 2, 1], [12, 2, 2])).toBeLessThan(0);
  });
});

// ============ checkTier ============

describe('checkTier', () => {
  it('skips when no tier is declared', () => {
    const result = checkTier({} as TestEnvironment, 'local');
    expect(result.status).toBe('skip');
  });

  it('passes for local tier against local environment', () => {
    const result = checkTier({ tier: 'local' }, 'local');
    expect(result.status).toBe('pass');
  });

  it('passes for local tier against cloud environment', () => {
    const result = checkTier({ tier: 'local' }, 'cloud');
    expect(result.status).toBe('pass');
  });

  it('passes for cloud tier against cloud environment', () => {
    const result = checkTier({ tier: 'cloud' }, 'cloud');
    expect(result.status).toBe('pass');
  });

  it('skips (not fails) for cloud tier against local environment', () => {
    const result = checkTier({ tier: 'cloud' }, 'local');
    expect(result.status).toBe('skip');
    if (result.status === 'skip') {
      expect(result.reason).toContain('skipping');
    }
  });

  it('passes for unknown tier (forward-compatible)', () => {
    const result = checkTier({ tier: 'enterprise' as CurrentTier }, 'local');
    expect(result.status).toBe('pass');
  });
});

// ============ checkMinVersion ============

describe('checkMinVersion', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('skips when no minVersion is declared', async () => {
    const result = await checkMinVersion({} as TestEnvironment, 'http://localhost:3000');
    expect(result.status).toBe('skip');
  });

  it('passes when Grafana version meets the minimum', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ version: '12.3.0', database: 'ok' }),
    });

    const result = await checkMinVersion({ minVersion: '12.2.0' }, 'http://localhost:3000');
    expect(result.status).toBe('pass');
  });

  it('passes when Grafana version exactly meets the minimum', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ version: '12.2.0', database: 'ok' }),
    });

    const result = await checkMinVersion({ minVersion: '12.2.0' }, 'http://localhost:3000');
    expect(result.status).toBe('pass');
  });

  it('fails when Grafana version is below the minimum', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ version: '11.5.0', database: 'ok' }),
    });

    const result = await checkMinVersion({ minVersion: '12.2.0' }, 'http://localhost:3000');
    expect(result.status).toBe('fail');
    if (result.status === 'fail') {
      expect(result.message).toContain('11.5.0');
      expect(result.message).toContain('12.2.0');
    }
  });

  it('fails when the health endpoint returns a non-OK status', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    });

    const result = await checkMinVersion({ minVersion: '12.2.0' }, 'http://localhost:3000');
    expect(result.status).toBe('fail');
    if (result.status === 'fail') {
      expect(result.message).toContain('503');
    }
  });

  it('fails when the health response has no version field', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ database: 'ok' }),
    });

    const result = await checkMinVersion({ minVersion: '12.2.0' }, 'http://localhost:3000');
    expect(result.status).toBe('fail');
    if (result.status === 'fail') {
      expect(result.message).toContain('version field');
    }
  });

  it('fails when the manifest minVersion is not valid semver', async () => {
    const result = await checkMinVersion({ minVersion: 'not-semver' }, 'http://localhost:3000');
    expect(result.status).toBe('fail');
    if (result.status === 'fail') {
      expect(result.message).toContain('not a valid semver');
    }
  });

  it('fails when fetch throws a network error', async () => {
    global.fetch = jest.fn().mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await checkMinVersion({ minVersion: '12.2.0' }, 'http://localhost:3000');
    expect(result.status).toBe('fail');
    if (result.status === 'fail') {
      expect(result.message).toContain('ECONNREFUSED');
    }
  });
});

// ============ checkPlugins ============

describe('checkPlugins', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('skips when no plugins are declared', async () => {
    const results = await checkPlugins({} as TestEnvironment, 'http://localhost:3000');
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe('skip');
  });

  it('skips when plugins array is empty', async () => {
    const results = await checkPlugins({ plugins: [] }, 'http://localhost:3000');
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe('skip');
  });

  it('passes when all required plugins are installed', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 'grafana-piechart-panel' }, { id: 'grafana-worldmap-panel' }],
    });

    const results = await checkPlugins(
      { plugins: ['grafana-piechart-panel', 'grafana-worldmap-panel'] },
      'http://localhost:3000'
    );
    expect(results.every((r) => r.status === 'pass')).toBe(true);
  });

  it('fails for each missing plugin', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 'grafana-piechart-panel' }],
    });

    const results = await checkPlugins(
      { plugins: ['grafana-piechart-panel', 'grafana-worldmap-panel'] },
      'http://localhost:3000'
    );
    const passes = results.filter((r) => r.status === 'pass');
    const fails = results.filter((r) => r.status === 'fail');
    expect(passes).toHaveLength(1);
    expect(fails).toHaveLength(1);
    expect(fails[0]!.check).toContain('grafana-worldmap-panel');
  });

  it('returns a single fail when the plugin API is unreachable', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    });

    const results = await checkPlugins({ plugins: ['some-plugin'] }, 'http://localhost:3000');
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe('fail');
    if (results[0]!.status === 'fail') {
      expect(results[0]!.message).toContain('503');
    }
  });
});

// ============ loadManifestFromDir ============

describe('loadManifestFromDir', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'preflight-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns null when no manifest.json exists', () => {
    const result = loadManifestFromDir(tempDir);
    expect(result).toBeNull();
  });

  it('loads and parses a valid manifest.json', () => {
    const manifest = {
      id: 'test-guide',
      type: 'guide',
      testEnvironment: { tier: 'local', minVersion: '12.0.0' },
    };
    writeFileSync(join(tempDir, 'manifest.json'), JSON.stringify(manifest));

    const result = loadManifestFromDir(tempDir);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('test-guide');
    expect(result!.testEnvironment?.tier).toBe('local');
  });

  it('throws when manifest.json is invalid JSON', () => {
    writeFileSync(join(tempDir, 'manifest.json'), 'not valid json {');
    expect(() => loadManifestFromDir(tempDir)).toThrow();
  });

  it('throws when manifest.json is missing required fields', () => {
    writeFileSync(join(tempDir, 'manifest.json'), JSON.stringify({ title: 'No ID or type' }));
    expect(() => loadManifestFromDir(tempDir)).toThrow();
  });
});

// ============ runManifestPreflight ============

describe('runManifestPreflight', () => {
  const baseManifest: ManifestJson = {
    id: 'test-guide',
    type: 'guide',
  };

  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns canRun:true and skipped:false when all checks pass', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '12.5.0', database: 'ok' }),
    });

    const manifest: ManifestJson = {
      ...baseManifest,
      testEnvironment: { tier: 'local', minVersion: '12.0.0' },
    };

    const outcome = await runManifestPreflight(manifest, {
      grafanaUrl: 'http://localhost:3000',
      currentTier: 'local',
    });

    expect(outcome.canRun).toBe(true);
    expect(outcome.skipped).toBe(false);
  });

  it('returns skipped:true when tier does not match, makes no network calls', async () => {
    const mockFetch = jest.fn();
    global.fetch = mockFetch;

    const manifest: ManifestJson = {
      ...baseManifest,
      testEnvironment: { tier: 'cloud' },
    };

    const outcome = await runManifestPreflight(manifest, {
      grafanaUrl: 'http://localhost:3000',
      currentTier: 'local',
    });

    expect(outcome.skipped).toBe(true);
    expect(outcome.canRun).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns canRun:false when version check fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '11.0.0', database: 'ok' }),
    });

    const manifest: ManifestJson = {
      ...baseManifest,
      testEnvironment: { tier: 'local', minVersion: '12.0.0' },
    };

    const outcome = await runManifestPreflight(manifest, {
      grafanaUrl: 'http://localhost:3000',
      currentTier: 'local',
    });

    expect(outcome.canRun).toBe(false);
    expect(outcome.skipped).toBe(false);
    const fail = outcome.results.find((r) => r.status === 'fail');
    expect(fail).toBeDefined();
  });

  it('returns canRun:false when a required plugin is missing', async () => {
    // minVersion not declared, so only the plugins call fires
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 'some-other-plugin' }],
    });

    const manifest: ManifestJson = {
      ...baseManifest,
      testEnvironment: { tier: 'local', plugins: ['grafana-missing-panel'] },
    };

    const outcome = await runManifestPreflight(manifest, {
      grafanaUrl: 'http://localhost:3000',
      currentTier: 'local',
    });

    expect(outcome.canRun).toBe(false);
    const fail = outcome.results.find((r) => r.status === 'fail');
    expect(fail).toBeDefined();
    expect(fail!.check).toContain('grafana-missing-panel');
  });

  it('runs correctly when testEnvironment is absent from manifest', async () => {
    const outcome = await runManifestPreflight(baseManifest, {
      grafanaUrl: 'http://localhost:3000',
      currentTier: 'local',
    });

    expect(outcome.canRun).toBe(true);
    expect(outcome.skipped).toBe(false);
    // All checks should have been skipped (no requirements declared)
    expect(outcome.results.every((r) => r.status === 'skip')).toBe(true);
  });
});
