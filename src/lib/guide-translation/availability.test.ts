import { isLocaleAvailable } from './availability';

describe('isLocaleAvailable', () => {
  it('is available when every unit is complete', () => {
    expect(isLocaleAvailable([{ complete: true }, { complete: true }], false)).toBe(true);
  });

  it('is unavailable when any unit is incomplete and there is no latch', () => {
    expect(isLocaleAvailable([{ complete: true }, { complete: false }], false)).toBe(false);
  });

  it('stays available when the latch is stamped, whatever the units say', () => {
    expect(isLocaleAvailable([{ complete: false }], true)).toBe(true);
    expect(isLocaleAvailable([], true)).toBe(true);
  });
});
