import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { writeJsonReport } from './e2e-console-reporter';
import { ExitCode } from './exit-codes';
import type { GuideRunResult } from './e2e-results';
import type { MultiGuideReport } from './schemas/e2e-report.schema';

describe('writeJsonReport', () => {
  let tempDir: string;
  let errorSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pathfinder-report-test-'));
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
    logSpy.mockRestore();
    warnSpy.mockRestore();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes a multi-guide report for pre-run skips when no guide has step data', () => {
    const outputPath = join(tempDir, 'results.json');
    const results: GuideRunResult[] = [
      {
        guide: 'https://cdn.test/cloud-guide/content.json',
        id: 'cloud-guide',
        status: 'skipped_no_auth',
        exitCode: ExitCode.SUCCESS,
        autoIncluded: false,
        abortMessage: 'Cloud-tier guide requires --cloud-instance-admin-token for https://learn.grafana.net/',
        tier: 'cloud',
      },
    ];

    const schemaValid = writeJsonReport(results, outputPath);

    const report = JSON.parse(readFileSync(outputPath, 'utf-8')) as MultiGuideReport;
    expect(schemaValid).toBe(true);
    expect(report.type).toBe('multi-guide');
    expect(report.guides).toEqual([]);
    expect(report.reports).toEqual([]);
    expect(report.preRunSkipped).toEqual([
      {
        id: 'cloud-guide',
        reason: 'skipped_no_auth',
        message: 'Cloud-tier guide requires --cloud-instance-admin-token for https://learn.grafana.net/',
        failed: false,
        tier: 'cloud',
        sourceUrl: 'https://cdn.test/cloud-guide/content.json',
      },
    ]);
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('No test results available'));
  });

  it('sets outcome to failed when a pre-run skip entry has failed: true', () => {
    const outputPath = join(tempDir, 'results.json');
    const results: GuideRunResult[] = [
      {
        guide: 'https://cdn.test/invalid-guide/content.json',
        id: 'invalid-guide',
        status: 'validation_failed',
        exitCode: ExitCode.TEST_FAILURE,
        autoIncluded: false,
        abortMessage: 'Fetched content.json failed guide schema validation',
        tier: 'cloud',
      },
    ];

    writeJsonReport(results, outputPath);

    const report = JSON.parse(readFileSync(outputPath, 'utf-8')) as MultiGuideReport;
    expect(report.outcome).toBe('failed');
    expect(report.preRunSkipped?.[0]?.failed).toBe(true);
  });

  it('sets outcome to skipped when no pre-run skip entry has failed: true', () => {
    const outputPath = join(tempDir, 'results.json');
    const results: GuideRunResult[] = [
      {
        guide: 'https://cdn.test/cloud-guide/content.json',
        id: 'cloud-guide',
        status: 'skipped_no_auth',
        exitCode: ExitCode.SUCCESS,
        autoIncluded: false,
        abortMessage: 'No cloud auth configured',
        tier: 'cloud',
      },
    ];

    writeJsonReport(results, outputPath);

    const report = JSON.parse(readFileSync(outputPath, 'utf-8')) as MultiGuideReport;
    expect(report.outcome).toBe('skipped');
  });

  it('preserves an aborted outcome when a pre-run skip entry failed', () => {
    const outputPath = join(tempDir, 'results.json');
    const results: GuideRunResult[] = [
      {
        guide: 'aborted-guide/content.json',
        id: 'aborted-guide',
        status: 'auth_expired',
        exitCode: ExitCode.AUTH_FAILURE,
        autoIncluded: false,
        resultsData: {
          guide: {
            id: 'aborted-guide',
            title: 'Aborted guide',
            path: 'aborted-guide/content.json',
            targetUrl: 'http://localhost:3000',
          },
          timestamp: '2026-01-01T00:00:00.000Z',
          outcome: 'aborted',
          errorCode: 'AUTH_EXPIRED',
          results: [],
          aborted: true,
          abortReason: 'AUTH_EXPIRED',
          abortMessage: 'Session expired',
        },
      },
      {
        guide: 'https://cdn.test/invalid-guide/content.json',
        id: 'invalid-guide',
        status: 'validation_failed',
        exitCode: ExitCode.TEST_FAILURE,
        autoIncluded: false,
        abortMessage: 'Fetched content.json failed guide schema validation',
        tier: 'cloud',
      },
    ];

    writeJsonReport(results, outputPath);

    const report = JSON.parse(readFileSync(outputPath, 'utf-8')) as MultiGuideReport;
    expect(report.outcome).toBe('aborted');
    expect(report.preRunSkipped?.[0]?.failed).toBe(true);
  });

  it('returns false after writing a report that fails schema validation', () => {
    const outputPath = join(tempDir, 'results.json');
    const invalidResults = {
      guide: { id: 42, title: 'Invalid guide', path: 'invalid/content.json', targetUrl: 'http://localhost:3000' },
      timestamp: '2026-01-01T00:00:00.000Z',
      results: [],
      aborted: false,
    } as unknown as NonNullable<GuideRunResult['resultsData']>;
    const results: GuideRunResult[] = [
      {
        guide: 'invalid/content.json',
        id: 'invalid',
        status: 'passed',
        exitCode: ExitCode.SUCCESS,
        autoIncluded: false,
        resultsData: invalidResults,
      },
    ];

    const schemaValid = writeJsonReport(results, outputPath);

    expect(schemaValid).toBe(false);
    expect(JSON.parse(readFileSync(outputPath, 'utf-8')).guide.id).toBe(42);
    expect(errorSpy).toHaveBeenCalled();
  });
});
