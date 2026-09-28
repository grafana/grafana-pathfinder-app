import { conditionTokens, isConditionInput } from './condition-input';

describe('condition inputs', () => {
  it('preserves commas in array parameters', () => {
    expect(conditionTokens(['has-dashboard-named:CPU, memory', 'coda-exit-zero:printf a,b'])).toEqual([
      'has-dashboard-named:CPU, memory',
      'coda-exit-zero:printf a,b',
    ]);
  });
  it('continues to split legacy strings', () => {
    expect(conditionTokens(' is-admin, ,is-editor ')).toEqual(['is-admin', 'is-editor']);
  });
  it('rejects mixed arrays at the boundary', () => {
    expect(isConditionInput(['is-admin', 1])).toBe(false);
    expect(isConditionInput(['is-admin'])).toBe(true);
  });
});
