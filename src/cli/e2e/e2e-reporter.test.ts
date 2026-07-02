/**
 * Reporter tests for dependency-aware execution outcomes.
 *
 * A guide skipped because its prerequisite failed produces no step data, so it
 * must still be represented in the multi-guide JSON report or the report would
 * undercount and lose the skip reason relative to the console summary.
 */

import { generateMultiGuideReport, type TestResultsData } from './e2e-reporter';

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
