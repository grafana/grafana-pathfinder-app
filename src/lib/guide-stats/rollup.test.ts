import { meanOfMemberPercentages } from './rollup';

describe('meanOfMemberPercentages', () => {
  it('reads 31% for the four-milestone worked example', () => {
    expect(meanOfMemberPercentages([100, 25, 0, 0])).toEqual({ percent: 31, complete: false });
  });

  it('weights members equally regardless of length', () => {
    expect(meanOfMemberPercentages([100, 0]).percent).toBe(50);
  });

  it('is 0% and incomplete for a path with no members', () => {
    expect(meanOfMemberPercentages([])).toEqual({ percent: 0, complete: false });
  });

  it('completes only when every member is at 100', () => {
    expect(meanOfMemberPercentages([100, 100])).toEqual({ percent: 100, complete: true });
    expect(meanOfMemberPercentages([100, 99]).complete).toBe(false);
  });

  it('reserves 100 for completion, so a nearly-finished path reads 99', () => {
    expect(meanOfMemberPercentages([100, 100, 100, 99]).percent).toBe(99);
  });

  it('reports 100 for a complete path whose members round below it', () => {
    // Every member complete is completion even when a member's own percent was
    // capped at 99 by its denominator — the flag is the contract, not the mean.
    expect(meanOfMemberPercentages([100])).toEqual({ percent: 100, complete: true });
  });

  it('is the identity on a single member', () => {
    for (const percent of [0, 1, 37, 99]) {
      expect(meanOfMemberPercentages([percent])).toEqual({ percent, complete: false });
    }
  });

  it('clamps a member outside 0..100 rather than poisoning the mean', () => {
    expect(meanOfMemberPercentages([200, 0]).percent).toBe(50);
    expect(meanOfMemberPercentages([-100, 100])).toEqual({ percent: 50, complete: false });
  });

  it('treats a non-finite member as 0 — the percent reaches a durable record', () => {
    expect(meanOfMemberPercentages([Number.NaN, 100]).percent).toBe(50);
    expect(meanOfMemberPercentages([Number.POSITIVE_INFINITY, 100]).percent).toBe(50);
  });
});
