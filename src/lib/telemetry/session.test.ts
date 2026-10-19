import { buildSessionExperimentsValue, SESSION_EXPERIMENTS_SCHEMA_VERSION } from './session';

describe('buildSessionExperimentsValue', () => {
  it('returns null when there are no active experiments', () => {
    expect(buildSessionExperimentsValue([])).toBeNull();
  });

  it('serializes the compact versioned cohort schema, dropping bulky fields', () => {
    const value = buildSessionExperimentsValue([
      { flag: 'pathfinder.example-experiment', variant: 'treatment', pages: ['/dashboards'], extra: true },
    ]);

    expect(JSON.parse(value!)).toEqual({
      v: SESSION_EXPERIMENTS_SCHEMA_VERSION,
      cohorts: [{ flag: 'pathfinder.example-experiment', variant: 'treatment' }],
    });
  });

  it('never truncates mid-JSON: oversized payloads degrade to empty cohorts and stay parsable', () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const value = buildSessionExperimentsValue([{ flag: 'f'.repeat(600), variant: 'treatment' }]);

    expect(value!.length).toBeLessThanOrEqual(500);
    expect(JSON.parse(value!)).toEqual({ v: SESSION_EXPERIMENTS_SCHEMA_VERSION, cohorts: [] });
    consoleWarnSpy.mockRestore();
  });
});
