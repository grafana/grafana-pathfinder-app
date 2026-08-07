import { VALID_BLOCK_TYPES } from '../../types/json-guide.schema';
import { BLOCK_TYPE_GROUPS, BLOCK_TYPE_METADATA, PALETTE_EXCLUDED_BLOCK_TYPES } from './constants';
import type { BlockType } from './types';

/**
 * `BlockPalette` renders by mapping `BLOCK_TYPE_GROUPS`, so a block type absent
 * from every group is unreachable in the UI with no other symptom — it can still
 * have metadata, a form, and a schema. `challenge` was in exactly that state.
 *
 * The compile-time partition check in `constants.ts` proves coverage; these
 * assertions add the properties types can't express (no duplicates, metadata
 * present) and give a readable failure.
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

  it('has palette metadata for every grouped block type', () => {
    const withoutMetadata = grouped.filter((type) => !BLOCK_TYPE_METADATA[type]);
    expect(withoutMetadata).toEqual([]);
  });

  it('exposes the challenge block in the palette', () => {
    expect(grouped).toContain('challenge');
  });
});
