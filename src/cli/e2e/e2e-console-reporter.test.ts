import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { writeJsonReport } from './e2e-console-reporter';
import { ExitCode } from './exit-codes';
import type { GuideRunResult } from './e2e-results';
import type { MultiGuideReport } from './schemas/e2e-report.schema';

describe('writeJsonReport', () => {
  let tempDir: string;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pathfinder-report-test-'));
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
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

    writeJsonReport(results, outputPath);

    const report = JSON.parse(readFileSync(outputPath, 'utf-8')) as MultiGuideReport;
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
});
