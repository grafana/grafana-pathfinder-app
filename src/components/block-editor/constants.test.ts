import { VALID_BLOCK_TYPES } from '../../types/json-guide.schema';
import { BLOCK_TYPE_GROUPS, BLOCK_TYPE_METADATA, BLOCK_TYPE_ORDER, PALETTE_EXCLUDED_BLOCK_TYPES } from './constants';
import type { BlockType } from './types';

/**
 * `BlockPalette` renders the intersection of `BLOCK_TYPE_GROUPS` and
 * `BLOCK_TYPE_ORDER`, so a block type absent from either is unreachable in the
 * UI with no other symptom — it can still have metadata, a form, and a schema.
 * `challenge` was in exactly that state.
 *
 * The compile-time partition check in `constants.ts` proves group coverage and
 * `BLOCK_TYPE_ORDER` is derived from the groups; these assertions add the
 * properties types can't express (no duplicates, usable metadata) and give a
 * readable failure.
 */
describe('block palette registry', () => {
  const grouped = BLOCK_TYPE_GROUPS.flatMap((group) => group.types as readonly BlockType[]);
  const excluded = PALETTE_EXCLUDED_BLOCK_TYPES as readonly BlockType[];

  it('covers every block type exactly once, or excludes it deliberately', () => {
    const missing = [...VALID_BLOCK_TYPES].filter(
      (type) => !grouped.includes(type as BlockType) && !excluded.includes(type as BlockType)
    );
    expect(missing).toEqual([]);
  });

  it('never lists a block type in two groups', () => {
    const duplicates = grouped.filter((type, index) => grouped.indexOf(type) !== index);
    expect(duplicates).toEqual([]);
  });

  it('never both groups and excludes the same block type', () => {
    expect(grouped.filter((type) => excluded.includes(type))).toEqual([]);
  });

  it('offers every non-excluded block type in the palette order', () => {
    const reachable = [...VALID_BLOCK_TYPES].filter((type) => !excluded.includes(type as BlockType)).sort();
    expect([...BLOCK_TYPE_ORDER].sort()).toEqual(reachable);
  });

  it('gives every grouped block type a non-empty name and description', () => {
    const unusable = grouped.filter((type) => {
      const meta = BLOCK_TYPE_METADATA[type];
      return !meta.name.trim() || !meta.description.trim();
    });
    expect(unusable).toEqual([]);
  });

  it('exposes the challenge block in the palette', () => {
    expect(grouped).toContain('challenge');
  });
});
