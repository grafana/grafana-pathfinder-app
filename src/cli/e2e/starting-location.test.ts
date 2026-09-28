import type { TestResultsData, TestStepResult } from './e2e-reporter';
import { createStartingLocationTracker, finalSuccessfulStartingLocation } from './starting-location';

function result(currentUrl: string, status: TestStepResult['status'] = 'passed'): TestResultsData {
  return {
    guide: { id: 'guide', title: 'Guide', path: 'guide/content.json', targetUrl: 'http://localhost:3000' },
    timestamp: '2026-01-01T00:00:00.000Z',
    results: [
      {
        stepId: 'final-step',
        status,
        durationMs: 1,
        currentUrl,
        consoleErrors: [],
        skippable: false,
      },
    ],
    aborted: false,
  };
}

describe('finalSuccessfulStartingLocation', () => {
  it('returns the final same-origin path with its query and fragment', () => {
    expect(
      finalSuccessfulStartingLocation(
        result('http://localhost:3000/connections/datasources/edit/uid?tab=settings#details'),
        'http://localhost:3000'
      )
    ).toBe('/connections/datasources/edit/uid?tab=settings#details');
  });

  it.each(['failed', 'skipped', 'not_reached'] as const)('rejects a final %s step', (status) => {
    expect(
      finalSuccessfulStartingLocation(result('http://localhost:3000/ignored', status), 'http://localhost:3000')
    ).toBeUndefined();
  });

  it.each(['https://example.com/connections', 'not a URL', 'javascript:alert(1)'])(
    'rejects an unsafe or malformed final URL: %s',
    (currentUrl) => {
      expect(finalSuccessfulStartingLocation(result(currentUrl), 'http://localhost:3000')).toBeUndefined();
    }
  );

  it('rejects a report without step results', () => {
    const data = result('http://localhost:3000/');
    data.results = [];

    expect(finalSuccessfulStartingLocation(data, 'http://localhost:3000')).toBeUndefined();
  });
});

describe('createStartingLocationTracker', () => {
  it('selects root before a location is carried', () => {
    expect(createStartingLocationTracker().select(undefined)).toBe('/');
  });

  it('carries a successful final location with its query and fragment', () => {
    const tracker = createStartingLocationTracker();

    tracker.record(true, result('http://localhost:3000/carried?tab=query#editor'), 'http://localhost:3000');

    expect(tracker.select(undefined)).toBe('/carried?tab=query#editor');
  });

  it.each(['/explicit-start', '/'] as const)('gives explicit location %s precedence over carried state', (explicit) => {
    const tracker = createStartingLocationTracker();
    tracker.record(true, result('http://localhost:3000/carried'), 'http://localhost:3000');

    expect(tracker.select(explicit)).toBe(explicit);
  });

  it('does not carry a location from a failed guide', () => {
    const tracker = createStartingLocationTracker();

    tracker.record(false, result('http://localhost:3000/failed-guide-location'), 'http://localhost:3000');

    expect(tracker.select(undefined)).toBe('/');
  });

  it('retains the carried location after a successful zero-step guide', () => {
    const tracker = createStartingLocationTracker();
    tracker.record(true, result('http://localhost:3000/carried'), 'http://localhost:3000');
    const emptyResult = result('http://localhost:3000/');
    emptyResult.results = [];

    tracker.record(true, emptyResult, 'http://localhost:3000');

    expect(tracker.select(undefined)).toBe('/carried');
  });

  it('resets carried state when a new tracker is created', () => {
    const firstChain = createStartingLocationTracker();
    firstChain.record(true, result('http://localhost:3000/first-chain-finish'), 'http://localhost:3000');

    expect(createStartingLocationTracker().select(undefined)).toBe('/');
  });
});
