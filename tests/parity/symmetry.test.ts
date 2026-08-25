/**
 * Guard tests for the parity symmetry assertion itself.
 *
 * The launch-path matrix is expected to be red, so these prove the helper is
 * red for the right reason — and, more importantly, that the ways of quietly
 * making a parity matrix pass are all closed.
 */

import { assertSymmetric, type SymmetryEntry } from './symmetry';

const options = { subject: 'the test subject', intentionalDifferences: [] };

function entry<T>(path: string, family: string, value: T): SymmetryEntry<T> {
  return { path, family, adapter: () => value };
}

describe('assertSymmetric', () => {
  it('passes when every path agrees', async () => {
    await expect(
      assertSymmetric([entry('a', 'f', { id: 1 }), entry('b', 'g', { id: 1 })], options)
    ).resolves.toBeUndefined();
  });

  it('ignores property order, which is not disagreement', async () => {
    await expect(
      assertSymmetric([entry('a', 'f', { x: 1, y: 2 }), entry('b', 'g', { y: 2, x: 1 })], options)
    ).resolves.toBeUndefined();
  });

  it('fails when paths disagree, naming the dissenters', async () => {
    await expect(
      assertSymmetric([entry('a', 'f', { id: 1 }), entry('b', 'g', { id: 1 }), entry('c', 'h', { id: 2 })], options)
    ).rejects.toThrow(/disagree.*[\s\S]*Unexplained dissent:[\s\S]*- c/);
  });

  it('fails on an empty table, so deleting the cases is not a fix', async () => {
    await expect(assertSymmetric([], options)).rejects.toThrow(/is empty/);
  });

  it('fails on a declared path with no adapter', async () => {
    await expect(
      assertSymmetric([entry('a', 'f', { id: 1 }), { path: 'b', family: 'g', adapter: undefined }], options)
    ).rejects.toThrow(/declares paths with no adapter:[\s\S]*- b/);
  });

  it('fails on duplicate path names, which would hide a case', async () => {
    await expect(assertSymmetric([entry('a', 'f', { id: 1 }), entry('a', 'g', { id: 1 })], options)).rejects.toThrow(
      /duplicate path names: a/
    );
  });

  it('accepts a divergence covered by an intentional-difference entry', async () => {
    await expect(
      assertSymmetric([entry('a', 'f', { id: 1 }), entry('b', 'g', { id: 1 }), entry('c', 'h', { id: 2 })], {
        subject: 'the test subject',
        intentionalDifferences: [{ paths: ['c'], reason: 'c is special', tracking: 'owner/repo#1' }],
      })
    ).resolves.toBeUndefined();
  });

  it('fails a stale entry whose paths now agree', async () => {
    await expect(
      assertSymmetric([entry('a', 'f', { id: 1 }), entry('b', 'g', { id: 1 })], {
        subject: 'the test subject',
        intentionalDifferences: [{ paths: ['b'], reason: 'b used to differ', tracking: 'owner/repo#1' }],
      })
    ).rejects.toThrow(/Stale INTENTIONAL_PATH_DIFFERENCES[\s\S]*- \[b\]/);
  });

  it('fails a stale entry naming a path that no longer exists', async () => {
    await expect(
      assertSymmetric([entry('a', 'f', { id: 1 }), entry('b', 'g', { id: 2 })], {
        subject: 'the test subject',
        intentionalDifferences: [
          { paths: ['b'], reason: 'b differs', tracking: 'owner/repo#1' },
          { paths: ['gone'], reason: 'retired path', tracking: 'owner/repo#2' },
        ],
      })
    ).rejects.toThrow(/Stale INTENTIONAL_PATH_DIFFERENCES[\s\S]*- \[gone\]/);
  });

  it('awaits async adapters', async () => {
    await expect(
      assertSymmetric(
        [
          { path: 'a', family: 'f', adapter: async () => ({ id: 1 }) },
          { path: 'b', family: 'g', adapter: () => ({ id: 1 }) },
        ],
        options
      )
    ).resolves.toBeUndefined();
  });
});
