/**
 * Reporter tests for dependency-aware execution outcomes.
 *
 * A guide skipped because its prerequisite failed produces no step data, so it
 * must still be represented in the multi-guide JSON report or the report would
 * undercount and lose the skip reason relative to the console summary.
 */

import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { E2E_REPORT_SCHEMA_VERSION, E2ETestReportSchema, type E2ETestReport } from './schemas/e2e-report.schema';
import {
  contentDigest,
  generateMultiGuideReport,
  generateReport,
  writeReport,
  type TestResultsData,
} from './e2e-reporter';

function ranGuide(id: string, opts: { failed?: boolean } = {}): TestResultsData {
  return {
    guide: { id, title: id, path: `${id}/content.json`, targetUrl: 'http://localhost:3000' },
    timestamp: '2026-01-01T00:00:00.000Z',
    results: [
      {
        stepId: 'step-1',
        status: opts.failed ? 'failed' : 'passed',
        durationMs: 10,
        currentUrl: '/',
        consoleErrors: [],
        skippable: false,
      },
    ],
    aborted: false,
  };
}

/** A guide skipped before execution because its prerequisite failed. */
function skippedGuide(id: string, failedPrerequisite: string): TestResultsData {
  return {
    guide: { id, title: id, path: `${id}/content.json`, targetUrl: 'http://localhost:3000' },
    timestamp: '2026-01-01T00:00:00.000Z',
    results: [],
    aborted: true,
    abortReason: 'SKIPPED_PREREQ',
    abortMessage: `Prerequisite "${failedPrerequisite}" did not pass`,
  };
}

function provisioningFailedGuide(id: string): TestResultsData {
  return {
    guide: { id, title: id, path: `${id}/content.json`, targetUrl: 'https://learn.grafana.net/' },
    timestamp: '2026-01-01T00:00:00.000Z',
    results: [],
    aborted: true,
    abortReason: 'PROVISIONING_FAILED',
    abortMessage: 'Cloud target provisioning failed: terraform apply failed',
  };
}

describe('generateMultiGuideReport — dependency-skipped guides', () => {
  it('counts a skipped dependent without treating it as passed', () => {
    const report = generateMultiGuideReport([
      ranGuide('prometheus-grafana-101', { failed: true }),
      skippedGuide('loki-grafana-101', 'prometheus-grafana-101'),
    ]);

    // Both the failed prerequisite and the skipped dependent are represented.
    expect(report.summary.totalGuides).toBe(2);
    expect(report.summary.skippedGuides).toBe(1);
    expect(report.summary.passedGuides).toBe(0);

    const skippedResult = report.guides.find((g) => g.id === 'loki-grafana-101');
    expect(skippedResult).toMatchObject({ abortReason: 'SKIPPED_PREREQ', success: false });
  });

  it('reports zero skipped guides when none are skipped', () => {
    const report = generateMultiGuideReport([ranGuide('a'), ranGuide('b')]);

    expect(report.summary.totalGuides).toBe(2);
    expect(report.summary.skippedGuides).toBe(0);
    expect(report.guides.every((g) => g.abortReason === undefined)).toBe(true);
  });

  it('counts provisioning failures as failed guides', () => {
    const report = generateMultiGuideReport([ranGuide('a'), provisioningFailedGuide('cloud-guide')]);

    expect(report.summary.totalGuides).toBe(2);
    expect(report.summary.passedGuides).toBe(1);
    expect(report.summary.failedGuides).toBe(1);

    const failedResult = report.guides.find((g) => g.id === 'cloud-guide');
    expect(failedResult).toMatchObject({ abortReason: 'PROVISIONING_FAILED', success: false });
  });
});

describe('versioned report contract', () => {
  it('includes normalized outcome, provenance, target, timestamps, and content digest', () => {
    const report = generateReport({
      ...ranGuide('always-passes'),
      guide: {
        ...ranGuide('always-passes').guide,
        contentDigest: contentDigest('fixture'),
        sourceUrl: 'https://cdn.example/always-passes/content.json',
      },
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:00:01.000Z',
    });

    expect(report).toMatchObject({
      schemaVersion: E2E_REPORT_SCHEMA_VERSION,
      outcome: 'passed',
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:00:01.000Z',
      target: { url: 'http://localhost:3000' },
      runner: { name: 'pathfinder-e2e-runner' },
      guide: {
        sourceUrl: 'https://cdn.example/always-passes/content.json',
        contentDigest: 'sha256:f16d05ec6b29248d2c61adb1e9263f78e4f7bace1b955014a2d17872cfe4064d',
      },
    });
  });

  it('generated reports validate against the Zod schema', () => {
    const pass = generateReport(ranGuide('always-passes'));
    const fail = generateReport(ranGuide('always-fails', { failed: true }));

    expect(() => E2ETestReportSchema.parse(pass)).not.toThrow();
    expect(() => E2ETestReportSchema.parse(fail)).not.toThrow();
    expect(pass.outcome).toBe('passed');
    expect(fail.outcome).toBe('failed');
    expect(fail.errorCode).toBe('MANDATORY_FAILURE');
  });
});

describe('writeReport self-validation', () => {
  let dir: string;
  let errorSpy: jest.SpyInstance;
  const priorStrict = process.env.PATHFINDER_E2E_STRICT_SCHEMA;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'e2e-report-'));
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    delete process.env.PATHFINDER_E2E_STRICT_SCHEMA;
    process.exitCode = undefined;
  });

  afterEach(() => {
    errorSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
    if (priorStrict === undefined) {
      delete process.env.PATHFINDER_E2E_STRICT_SCHEMA;
    } else {
      process.env.PATHFINDER_E2E_STRICT_SCHEMA = priorStrict;
    }
    process.exitCode = undefined;
  });

  it('writes a normalized report and strips unknown keys', () => {
    const report = { ...generateReport(ranGuide('always-passes')), bogusField: 'nope' } as unknown as E2ETestReport;
    const out = join(dir, 'report.json');

    writeReport(report, out);

    const written = JSON.parse(readFileSync(out, 'utf-8'));
    expect(written.bogusField).toBeUndefined();
    expect(written.outcome).toBe('passed');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('still writes a report and warns when validation fails, without throwing', () => {
    const invalid = { schemaVersion: '1.0.0', outcome: 'not-a-real-outcome' } as unknown as E2ETestReport;
    const out = join(dir, 'report.json');

    expect(() => writeReport(invalid, out)).not.toThrow();

    const written = JSON.parse(readFileSync(out, 'utf-8'));
    expect(written.outcome).toBe('not-a-real-outcome');
    expect(errorSpy).toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it('flips the exit code on invalid output only under PATHFINDER_E2E_STRICT_SCHEMA=1', () => {
    process.env.PATHFINDER_E2E_STRICT_SCHEMA = '1';
    const invalid = { schemaVersion: '1.0.0', outcome: 'not-a-real-outcome' } as unknown as E2ETestReport;

    writeReport(invalid, join(dir, 'report.json'));

    expect(process.exitCode).toBe(2);
  });
});
