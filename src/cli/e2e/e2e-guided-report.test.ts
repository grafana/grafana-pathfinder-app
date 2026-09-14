import Ajv2020 from 'ajv/dist/2020';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { exportSchema } from '../commands/schema';
import { generateMultiGuideReport, generateReport, writeReport, type TestResultsData } from './e2e-reporter';
import { E2ETestReportSchema, MultiGuideReportSchema, ReportSubstepResultSchema } from './schemas/e2e-report.schema';

function fixture(): TestResultsData {
  return {
    guide: { id: 'guided', title: 'Guided', path: 'guided/content.json' },
    timestamp: '2026-01-01T00:00:00.000Z',
    results: [
      {
        stepId: 'step',
        stepKind: 'guided',
        status: 'failed',
        durationMs: 50000,
        currentUrl: '/',
        consoleErrors: [],
        skippable: false,
        substeps: [
          { index: 0, action: 'button', status: 'completed', durationMs: 10 },
          { index: 1, action: 'highlight', status: 'skipped', durationMs: 20, error: 'Target was not actionable' },
          { index: 2, action: 'hover', status: 'timeout', durationMs: 30000 },
          { index: 3, action: 'formfill', status: 'cancelled', durationMs: 40 },
          { index: 4, action: 'noop', status: 'error', durationMs: 50 },
        ],
      },
    ],
    coverage: {
      contractSource: 'current',
      rendered: 2,
      supported: 1,
      executed: 1,
      unsupported: 1,
      unsupportedSteps: [{ stepKind: 'quiz', stepId: 'quiz' }],
    },
    aborted: false,
  };
}

describe('optional guided report evidence', () => {
  it('maps all actions and statuses without changing parent counts or coverage', () => {
    const data = fixture();
    const report = generateReport(data);

    expect(report.schemaVersion).toBe('1.1.0');
    expect(report.outcome).toBe('failed');
    expect(report.summary).toMatchObject({ total: 1, passed: 0, failed: 1, skipped: 0 });
    expect(report.coverage).toEqual(data.coverage);
    expect(report.steps[0]!.substeps).toEqual([
      { index: 0, action: 'button', status: 'completed', duration: 10 },
      { index: 1, action: 'highlight', status: 'skipped', duration: 20, error: 'Target was not actionable' },
      { index: 2, action: 'hover', status: 'timeout', duration: 30000 },
      { index: 3, action: 'formfill', status: 'cancelled', duration: 40 },
      { index: 4, action: 'noop', status: 'error', duration: 50 },
    ]);
    expect(E2ETestReportSchema.parse(report).steps[0]!.substeps).toEqual(report.steps[0]!.substeps);
  });

  it('validates reports before and after the additive evidence field', () => {
    const validate = new Ajv2020({ strict: false }).compile(exportSchema('e2e-report', false)!);
    const data = fixture();

    expect(validate(generateReport(data))).toBe(true);
    delete data.results[0]!.substeps;
    const legacy = generateReport(data);

    expect(legacy.steps[0]).not.toHaveProperty('substeps');
    expect(validate(legacy)).toBe(true);
    expect(E2ETestReportSchema.safeParse(legacy).success).toBe(true);
    data.results[0]!.substeps = [];
    expect(generateReport(data).steps[0]!.substeps).toEqual([]);
    expect(validate(generateReport(data))).toBe(true);
  });

  it('keeps substeps optional in a multi-guide report', () => {
    const legacy = fixture();
    delete legacy.results[0]!.substeps;
    const report = MultiGuideReportSchema.parse(generateMultiGuideReport([fixture(), legacy]));
    const validate = new Ajv2020({ strict: false }).compile(exportSchema('e2e-multi-report', false)!);

    expect(report.reports[0]!.steps[0]!.substeps).toHaveLength(5);
    expect(report.reports[1]!.steps[0]).not.toHaveProperty('substeps');
    expect(validate(report)).toBe(true);
    expect(report.summary.steps).toMatchObject({ total: 2, failed: 2, skipped: 0 });
  });

  it.each([
    { index: -1 },
    { index: 0.5 },
    { action: 'navigate' },
    { status: 'passed' },
    { duration: -1 },
    { duration: '10' },
  ])('rejects a malformed optional substep %j', (override) => {
    expect(
      ReportSubstepResultSchema.safeParse({
        index: 0,
        action: 'button',
        status: 'completed',
        duration: 10,
        ...override,
      }).success
    ).toBe(false);
  });

  it('serializes settlements instead of stripping them during self-validation', () => {
    const directory = mkdtempSync(join(tmpdir(), 'guided-report-'));
    try {
      const report = generateReport(fixture());
      const path = join(directory, 'report.json');

      expect(writeReport(report, path)).toBe(true);
      expect(JSON.parse(readFileSync(path, 'utf8')).steps[0].substeps).toEqual(report.steps[0]!.substeps);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
