import {
  ALIGNED_BY_CONSTRUCTION_SOURCES,
  NEEDS_ALIGNMENT_CHECK_SOURCES,
  isAlignedByConstruction,
} from './launch-sources';

describe('isAlignedByConstruction', () => {
  it('returns true for every aligned-by-construction source', () => {
    for (const source of ALIGNED_BY_CONSTRUCTION_SOURCES) {
      expect(isAlignedByConstruction(source)).toBe(true);
    }
  });

  it('returns false for every needs-alignment-check source', () => {
    for (const source of NEEDS_ALIGNMENT_CHECK_SOURCES) {
      expect(isAlignedByConstruction(source)).toBe(false);
    }
  });

  it('returns false for an unknown source (default to evaluating alignment)', () => {
    expect(isAlignedByConstruction('some_new_surface')).toBe(false);
  });

  it('returns false when source is undefined', () => {
    expect(isAlignedByConstruction(undefined)).toBe(false);
  });

  it('returns false when source is the empty string', () => {
    expect(isAlignedByConstruction('')).toBe(false);
  });

  it('does not classify any source as both aligned and needing alignment', () => {
    for (const source of ALIGNED_BY_CONSTRUCTION_SOURCES) {
      expect(NEEDS_ALIGNMENT_CHECK_SOURCES.has(source)).toBe(false);
    }
  });
});
