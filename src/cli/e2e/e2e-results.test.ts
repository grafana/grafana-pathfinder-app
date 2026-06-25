/**
 * Command-side results-model tests. These pin the parts of the e2e command that
 * own the JSON-report contract and the process exit code but previously had no
 * direct coverage: the run-mode precedence rule, the SkippedPackage →
 * GuideRunResult mapping (including the dual classification of
 * validation_failed), the pre-run-skip report fields, and the exit-code rules.
 *
 * `fs` is mocked so resolveRunMode's directory probe is deterministic without
 * touching the filesystem.
 */

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return { ...actual, existsSync: jest.fn(), statSync: jest.fn() };
});

import { existsSync, statSync } from 'fs';

import {
  applyPackageMeta,
  buildPackageMetaMap,
  exitCodeFromResults,
  preRunSkipsFromResults,
  resolveRunMode,
  skipToResult,
  GUIDE_STATUS_ICONS,
  GUIDE_STATUS_LABELS,
  type GuideRunResult,
} from './e2e-results';
import type { ResolvedRemoteGuide, SkippedPackage } from './e2e-package';
import type { TestResultsData } from './e2e-reporter';
import { ExitCode } from './exit-codes';

describe('resolveRunMode', () => {
  beforeEach(() => {
    (existsSync as jest.Mock).mockReset();
    (statSync as jest.Mock).mockReset();
  });

  it('returns remote-repository for --remote, taking precedence over --package', () => {
    // --remote wins even when --package names an existing local directory.
    (existsSync as jest.Mock).mockReturnValue(true);
    (statSync as jest.Mock).mockReturnValue({ isDirectory: () => true });

    expect(resolveRunMode({ remote: true, package: './local-pkg' })).toBe('remote-repository');
  });

  it('treats a --package that is not an existing directory as a remote package ID', () => {
    (existsSync as jest.Mock).mockReturnValue(false);

    expect(resolveRunMode({ remote: false, package: 'alerting-101' })).toBe('remote-package');
  });

  it('treats a --package that exists but is a file (not a directory) as a remote package ID', () => {
    (existsSync as jest.Mock).mockReturnValue(true);
    (statSync as jest.Mock).mockReturnValue({ isDirectory: () => false });

    expect(resolveRunMode({ remote: false, package: 'content.json' })).toBe('remote-package');
  });

  it('treats a --package that is an existing directory as a local run', () => {
    (existsSync as jest.Mock).mockReturnValue(true);
    (statSync as jest.Mock).mockReturnValue({ isDirectory: () => true });

    expect(resolveRunMode({ remote: false, package: './my-package' })).toBe('local');
  });

  it('falls back to local when no remote inputs are given', () => {
    expect(resolveRunMode({ remote: false })).toBe('local');
  });
});

describe('skipToResult', () => {
  const baseSkip: SkippedPackage = {
    id: 'loki-101',
    reason: 'skipped_tier_mismatch',
    message: 'requires cloud',
    sourceUrl: 'https://cdn.test/loki-101/content.json',
    tier: 'cloud',
  };

  it('maps a non-failure skip to a SUCCESS exit code and carries its metadata', () => {
    expect(skipToResult(baseSkip)).toMatchObject({
      id: 'loki-101',
      guide: 'https://cdn.test/loki-101/content.json',
      status: 'skipped_tier_mismatch',
      exitCode: ExitCode.SUCCESS,
      abortMessage: 'requires cloud',
      tier: 'cloud',
      autoIncluded: false,
    });
  });

  it('classifies validation_failed as a test failure (non-zero exit)', () => {
    const result = skipToResult({ ...baseSkip, reason: 'validation_failed' });

    expect(result.status).toBe('validation_failed');
    expect(result.exitCode).toBe(ExitCode.TEST_FAILURE);
  });

  it('uses the package id as the guide label when no sourceUrl is present', () => {
    const result = skipToResult({ id: 'missing', reason: 'resolution_failed', message: 'not found' });

    expect(result.guide).toBe('missing');
  });
});

describe('buildPackageMetaMap', () => {
  it('indexes resolved guides by id with their package metadata', () => {
    const runnable: ResolvedRemoteGuide[] = [
      {
        id: 'a',
        guide: { path: 'https://cdn.test/a/content.json', content: '{}' },
        tier: 'local',
        instance: 'play.grafana.org',
        targetUrl: 'http://localhost:3000',
        sourceUrl: 'https://cdn.test/a/content.json',
      },
    ];

    expect(buildPackageMetaMap(runnable).get('a')).toEqual({
      packageId: 'a',
      tier: 'local',
      instance: 'play.grafana.org',
      targetUrl: 'http://localhost:3000',
      sourceUrl: 'https://cdn.test/a/content.json',
    });
  });
});

describe('applyPackageMeta', () => {
  function reportData(): TestResultsData {
    return {
      guide: { id: 'a', title: 'A', path: 'a/content.json', targetUrl: 'http://localhost:3000' },
      timestamp: '2026-01-01T00:00:00.000Z',
      results: [],
      aborted: false,
    };
  }

  it('merges packageId/tier/instance/sourceUrl while preserving existing guide fields', () => {
    const data = reportData();

    applyPackageMeta(data, {
      packageId: 'a',
      tier: 'local',
      instance: 'play.grafana.org',
      // targetUrl is intentionally NOT propagated; the runner already set it.
      targetUrl: 'http://should-not-overwrite:3000',
      sourceUrl: 'https://cdn.test/a/content.json',
    });

    expect(data.guide).toMatchObject({
      id: 'a',
      title: 'A',
      targetUrl: 'http://localhost:3000',
      packageId: 'a',
      tier: 'local',
      instance: 'play.grafana.org',
      sourceUrl: 'https://cdn.test/a/content.json',
    });
  });

  it('is a no-op when data or meta is missing', () => {
    const data = reportData();
    const before = { ...data.guide };

    applyPackageMeta(data, undefined);
    expect(data.guide).toEqual(before);

    expect(() => applyPackageMeta(undefined, { packageId: 'a' })).not.toThrow();
  });
});

describe('preRunSkipsFromResults', () => {
  it('keeps only resolver pre-run skips and maps the JSON-report fields', () => {
    const results: GuideRunResult[] = [
      { guide: 'a/content.json', id: 'a', status: 'passed', exitCode: 0, autoIncluded: false },
      {
        guide: 'https://cdn.test/b/content.json',
        id: 'b',
        status: 'skipped_tier_mismatch',
        exitCode: 0,
        autoIncluded: false,
        abortMessage: 'requires cloud',
        tier: 'cloud',
      },
      {
        guide: 'https://cdn.test/c/content.json',
        id: 'c',
        status: 'validation_failed',
        exitCode: 1,
        autoIncluded: false,
        tier: 'local',
      },
      { guide: 'd/content.json', id: 'd', status: 'failed', exitCode: 1, autoIncluded: false },
      {
        guide: 'e/content.json',
        id: 'e',
        status: 'skipped_prereq',
        exitCode: 0,
        autoIncluded: false,
        failedPrerequisite: 'x',
      },
    ];

    const skips = preRunSkipsFromResults(results);

    // Run outcomes (passed/failed) and skipped_prereq (which carries step data)
    // are excluded; only the resolver's pre-run skip reasons remain.
    expect(skips.map((s) => s.id)).toEqual(['b', 'c']);

    expect(skips[0]).toEqual({
      id: 'b',
      reason: 'skipped_tier_mismatch',
      message: 'requires cloud',
      failed: false,
      tier: 'cloud',
      sourceUrl: 'https://cdn.test/b/content.json',
    });

    // validation_failed is the one pre-run skip that counts as a failure, and an
    // absent message defaults to an empty string.
    expect(skips[1]).toMatchObject({ id: 'c', reason: 'validation_failed', failed: true, message: '' });
  });
});

describe('exitCodeFromResults', () => {
  const result = (status: GuideRunResult['status']): GuideRunResult => ({
    guide: status,
    id: status,
    status,
    exitCode: 0,
    autoIncluded: false,
  });

  it('returns SUCCESS for an all-passing run', () => {
    expect(exitCodeFromResults([result('passed'), result('skipped_prereq')])).toBe(ExitCode.SUCCESS);
  });

  it('returns SUCCESS for an empty result set', () => {
    expect(exitCodeFromResults([])).toBe(ExitCode.SUCCESS);
  });

  it('returns TEST_FAILURE when a guide failed or failed validation', () => {
    expect(exitCodeFromResults([result('passed'), result('failed')])).toBe(ExitCode.TEST_FAILURE);
    expect(exitCodeFromResults([result('validation_failed')])).toBe(ExitCode.TEST_FAILURE);
  });

  it('prioritizes AUTH_FAILURE over a generic test failure', () => {
    expect(exitCodeFromResults([result('failed'), result('auth_expired')])).toBe(ExitCode.AUTH_FAILURE);
  });
});

describe('status label / icon tables', () => {
  it('defines an icon for every labelled status', () => {
    for (const [status] of GUIDE_STATUS_LABELS) {
      expect(GUIDE_STATUS_ICONS[status]).toBeDefined();
    }
  });

  it('classifies validation_failed with a failure label and icon, distinct from a skip', () => {
    const label = GUIDE_STATUS_LABELS.find(([status]) => status === 'validation_failed')?.[1];

    expect(label).toBe('❌ Validation failed');
    expect(GUIDE_STATUS_ICONS.validation_failed).toBe('❌');
  });
});
