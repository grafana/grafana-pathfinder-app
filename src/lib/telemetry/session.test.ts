import { buildSessionExperimentsValue, SESSION_EXPERIMENTS_SCHEMA_VERSION } from './session';

describe('buildSessionExperimentsValue', () => {
  it('returns null when there are no active experiments', () => {
    expect(buildSessionExperimentsValue([])).toBeNull();
  });

  it('serializes the compact versioned cohort schema, dropping bulky fields', () => {
    const value = buildSessionExperimentsValue([
      {
        flag: 'pathfinder.highlighted-guide-experiment',
        variant: 'treatment',
        guideId: 'bundled:welcome',
        pages: ['/dashboards', '/explore'],
        autoOpen: true,
        resetCache: false,
      },
    ]);

    expect(JSON.parse(value!)).toEqual({
      v: SESSION_EXPERIMENTS_SCHEMA_VERSION,
      cohorts: [{ flag: 'pathfinder.highlighted-guide-experiment', variant: 'treatment', guideId: 'bundled:welcome' }],
    });
  });

  it('omits guideId when the entry has none', () => {
    const value = buildSessionExperimentsValue([{ flag: 'f', variant: 'control' }]);
    expect(JSON.parse(value!)).toEqual({
      v: SESSION_EXPERIMENTS_SCHEMA_VERSION,
      cohorts: [{ flag: 'f', variant: 'control' }],
    });
  });

  it('never truncates mid-JSON: oversized payloads degrade to empty cohorts and stay parsable', () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const value = buildSessionExperimentsValue([{ flag: 'f', variant: 'treatment', guideId: 'x'.repeat(600) }]);

    expect(value!.length).toBeLessThanOrEqual(500);
    expect(JSON.parse(value!)).toEqual({ v: SESSION_EXPERIMENTS_SCHEMA_VERSION, cohorts: [] });
    consoleWarnSpy.mockRestore();
  });
});
