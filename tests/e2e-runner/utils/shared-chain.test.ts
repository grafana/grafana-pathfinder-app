/** @jest-environment node */

import {
  createMinimalResultsData,
  generateMultiGuideReport,
  type TestResultsData,
} from '../../../src/cli/e2e/e2e-reporter';
import type { E2EChainInput } from '../../../src/cli/e2e/e2e-runner-contract';
import { MultiGuideReportSchema } from '../../../src/cli/e2e/schemas/e2e-report.schema';
import { resolveMilestoneTransition, runSharedGuideChain } from './shared-chain';

function input(): E2EChainInput {
  return {
    targetUrl: 'http://localhost:3000/',
    options: {
      artifactsDir: '/tmp/artifacts',
      alwaysScreenshot: false,
      verbose: false,
    },
    guides: [
      { id: 'first', path: '/first.json', content: '{"title":"First"}', dependencies: [] },
      { id: 'second', path: '/second.json', content: '{"title":"Second"}', dependencies: [] },
      { id: 'dependent', path: '/dependent.json', content: '{"title":"Dependent"}', dependencies: ['first'] },
    ],
  };
}

function result(id: string, outcome: TestResultsData['outcome'] = 'passed'): TestResultsData {
  return createMinimalResultsData({
    guide: { id, title: id, path: `/${id}.json`, targetUrl: 'http://localhost:3000/' },
    outcome: outcome ?? 'passed',
    errorCode: outcome === 'passed' ? 'UNKNOWN' : 'MANDATORY_FAILURE',
    errorMessage: outcome === 'passed' ? '' : 'failed',
  });
}

describe('shared guide chain', () => {
  it('keeps the page for a later milestone without an authored location', () => {
    expect(
      resolveMilestoneTransition('http://localhost:3000', 'http://localhost:3000/wizard?step=2', undefined, false)
    ).toEqual({
      startingLocation: '/wizard?step=2',
      navigateToStartingLocation: false,
    });
  });

  it('navigates to a different authored location but not to a matching one', () => {
    expect(
      resolveMilestoneTransition('http://localhost:3000', 'http://localhost:3000/wizard?step=2', '/dashboards', false)
    ).toEqual({ startingLocation: '/dashboards', navigateToStartingLocation: true });
    expect(
      resolveMilestoneTransition('http://localhost:3000', 'http://localhost:3000/dashboards', '/dashboards', false)
    ).toEqual({ startingLocation: '/dashboards', navigateToStartingLocation: false });
  });

  it('always navigates the first runnable milestone', () => {
    expect(
      resolveMilestoneTransition('http://localhost:3000', 'http://localhost:3000/dashboards', undefined, true)
    ).toEqual({
      startingLocation: '/',
      navigateToStartingLocation: true,
    });
  });

  it('continues a soft-ordered milestone and skips only the blocked dependency', async () => {
    const runGuide = jest
      .fn()
      .mockResolvedValueOnce(result('first', 'failed'))
      .mockResolvedValueOnce(result('second', 'passed'));
    const publish = jest.fn();

    const outcome = await runSharedGuideChain(input(), {
      currentUrl: () => 'http://localhost:3000/current',
      runGuide,
      publish,
    });

    expect(runGuide.mock.calls.map(([guide]) => guide.id)).toEqual(['first', 'second']);
    expect(outcome.results.map((item) => [item.guide.id, item.outcome, item.abortReason])).toEqual([
      ['first', 'failed', undefined],
      ['second', 'passed', undefined],
      ['dependent', 'skipped', 'SKIPPED_PREREQ'],
    ]);
    expect(publish).toHaveBeenCalledTimes(3);
  });

  it('aborts remaining milestones after authentication expiry', async () => {
    const authResult = createMinimalResultsData({
      guide: { id: 'first', title: 'First', path: '/first.json' },
      outcome: 'aborted',
      errorCode: 'AUTH_EXPIRED',
      errorMessage: 'Session expired',
      abortReason: 'AUTH_EXPIRED',
    });

    const outcome = await runSharedGuideChain(input(), {
      currentUrl: () => 'http://localhost:3000/current',
      runGuide: jest.fn().mockResolvedValue(authResult),
      publish: jest.fn(),
    });

    expect(outcome.authExpired).toBe(true);
    expect(outcome.results).toHaveLength(3);
    expect(outcome.results.slice(1).every((item) => item.results.length === 0)).toBe(true);
    expect(outcome.results.slice(1).every((item) => item.errorCode === 'AUTH_EXPIRED')).toBe(true);
  });

  it('writes zero-step infrastructure results after browser-session loss', async () => {
    const infrastructureResult = createMinimalResultsData({
      guide: { id: 'first', title: 'First', path: '/first.json' },
      outcome: 'infrastructure_error',
      errorCode: 'REPORT_MISSING',
      errorMessage: 'The browser context closed.',
    });

    const outcome = await runSharedGuideChain(input(), {
      currentUrl: () => 'http://localhost:3000/current',
      runGuide: jest.fn().mockResolvedValue(infrastructureResult),
      publish: jest.fn(),
    });

    expect(outcome.results).toHaveLength(3);
    expect(outcome.results.slice(1).every((item) => item.outcome === 'infrastructure_error')).toBe(true);
    expect(outcome.results.slice(1).every((item) => item.results.length === 0)).toBe(true);
  });

  it('keeps one existing report per milestone in plan order', async () => {
    const outcome = await runSharedGuideChain(input(), {
      currentUrl: () => 'http://localhost:3000/current',
      runGuide: (guide) => Promise.resolve(result(guide.id)),
      publish: jest.fn(),
    });

    const report = generateMultiGuideReport(outcome.results, undefined, { id: 'test-path', type: 'path' });

    expect(report.schemaVersion).toBe('1.0.0');
    expect(report.reports.map((item) => item.guide.id)).toEqual(['first', 'second', 'dependent']);
    expect(MultiGuideReportSchema.safeParse(report).success).toBe(true);
  });
});
