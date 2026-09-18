/**
 * Behavioural tests for the position-to-percentage rule.
 */

import { computeGuideBlockIndex, type CountableBlock } from './block-index';
import { furthestEvidencedPosition, guideProgress, guideProgressAtPosition } from './progress';

const markdown = (id?: string): CountableBlock => ({ type: 'markdown', ...(id ? { id } : {}) });
const interactive = (id?: string): CountableBlock => ({ type: 'interactive', ...(id ? { id } : {}) });

describe('guideProgressAtPosition', () => {
  it('is n over total', () => {
    const index = computeGuideBlockIndex([markdown(), markdown(), markdown(), markdown()]);

    expect(guideProgressAtPosition(index, 1).percent).toBe(25);
    expect(guideProgressAtPosition(index, 3).percent).toBe(75);
    expect(guideProgressAtPosition(index, 3).fraction).toBeCloseTo(0.75);
  });

  it('is zero before any evidence', () => {
    const index = computeGuideBlockIndex([markdown(), markdown()]);

    expect(guideProgressAtPosition(index, 0)).toMatchObject({ percent: 0, complete: false });
  });

  it('is zero for an empty guide rather than dividing by zero', () => {
    const progress = guideProgressAtPosition(computeGuideBlockIndex([]), 0);

    expect(progress).toMatchObject({ percent: 0, fraction: 0, complete: false });
  });

  it('clamps a position past the end and a negative position', () => {
    const index = computeGuideBlockIndex([markdown(), markdown()]);

    expect(guideProgressAtPosition(index, 99).position).toBe(2);
    expect(guideProgressAtPosition(index, -5).position).toBe(0);
  });

  it('reaches 100% at the last block', () => {
    const index = computeGuideBlockIndex([markdown(), markdown(), markdown()]);

    expect(guideProgressAtPosition(index, 3)).toMatchObject({ percent: 100, complete: true });
  });

  it('reaches 100% from the final block when that block is interactive', () => {
    const index = computeGuideBlockIndex([markdown(), markdown(), interactive('doit')]);

    expect(index.finalCompletablePosition).toBe(index.totalBlockCount);
    expect(guideProgressAtPosition(index, 3)).toMatchObject({ percent: 100, fraction: 1, complete: true });
  });

  it('stops short of 100% when prose follows the final interactive block', () => {
    const index = computeGuideBlockIndex([markdown(), interactive('doit'), markdown(), markdown()]);

    expect(index.totalBlockCount).toBe(4);
    expect(index.finalCompletablePosition).toBe(2);
    expect(guideProgressAtPosition(index, 2)).toMatchObject({ percent: 50, complete: false });
  });

  it('does not shortcut an earlier interactive block to 100%', () => {
    const index = computeGuideBlockIndex([interactive('first'), markdown(), interactive('last'), markdown()]);

    expect(guideProgressAtPosition(index, 1)).toMatchObject({ percent: 25, complete: false });
    expect(guideProgressAtPosition(index, 3)).toMatchObject({ percent: 75, complete: false });
    expect(guideProgressAtPosition(index, 4)).toMatchObject({ percent: 100, complete: true });
  });

  it('treats a guide with no interactive block the same as any other', () => {
    const index = computeGuideBlockIndex([markdown(), markdown(), markdown(), markdown()]);

    expect(guideProgressAtPosition(index, 3)).toMatchObject({ percent: 75, complete: false });
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('treats a %s position as no progress rather than leaking NaN or a false 100%%', (_label, bad) => {
    const index = computeGuideBlockIndex([markdown(), markdown(), markdown()]);

    expect(guideProgressAtPosition(index, bad)).toMatchObject({
      position: 0,
      fraction: 0,
      percent: 0,
      complete: false,
    });
  });

  it('never reports 100% while incomplete, however large the denominator', () => {
    const index = computeGuideBlockIndex(Array.from({ length: 250 }, () => markdown()));

    const oneShort = guideProgressAtPosition(index, 249);

    expect(oneShort.fraction).toBeCloseTo(0.996);
    expect(oneShort).toMatchObject({ percent: 99, complete: false });
    expect(guideProgressAtPosition(index, 250)).toMatchObject({ percent: 100, complete: true });
  });
});

describe('furthestEvidencedPosition', () => {
  const index = computeGuideBlockIndex([
    markdown('intro'),
    { type: 'section', id: 'setup', blocks: [markdown('a'), interactive('b')] },
    markdown('outro'),
  ]);

  it('takes the furthest signal regardless of arrival order', () => {
    const forwards = furthestEvidencedPosition(index, [
      { kind: 'do-it', blockId: 'b' },
      { kind: 'do-it', blockId: 'a' },
    ]);

    expect(forwards).toBe(3);
    expect(furthestEvidencedPosition(index, [{ kind: 'do-it', blockId: 'a' }])).toBe(2);
  });

  it('treats "mark as complete" on a section as reaching its last block', () => {
    expect(furthestEvidencedPosition(index, [{ kind: 'mark-section-complete', blockId: 'section-setup' }])).toBe(3);
  });

  it('treats "mark as complete" on the guide as reaching the end', () => {
    expect(furthestEvidencedPosition(index, [{ kind: 'mark-guide-complete' }])).toBe(4);
  });

  it('ignores signals naming a block that is not counted', () => {
    expect(furthestEvidencedPosition(index, [{ kind: 'do-it', blockId: 'gone' }])).toBe(0);
    expect(furthestEvidencedPosition(index, [{ kind: 'do-it' }])).toBe(0);
    expect(furthestEvidencedPosition(index, [{ kind: 'mark-section-complete', blockId: 'section-intro' }])).toBe(0);
  });

  it('ignores no evidence at all', () => {
    expect(furthestEvidencedPosition(index, [])).toBe(0);
  });
});

describe('guideProgress', () => {
  it('turns the raw signals of a guide ending in a "Do it" into 100%', () => {
    const index = computeGuideBlockIndex([{ type: 'section', blocks: [markdown('brief'), interactive('run')] }]);

    expect(guideProgress(index, [{ kind: 'do-it', blockId: 'run' }])).toMatchObject({
      position: 2,
      totalBlockCount: 2,
      percent: 100,
      complete: true,
    });
  });

  it('reaches 100% only on "Mark as complete" for a guide whose last block is prose', () => {
    const index = computeGuideBlockIndex([
      { type: 'section', blocks: [markdown('brief'), interactive('run')] },
      markdown('well-done'),
    ]);

    expect(guideProgress(index, [{ kind: 'do-it', blockId: 'run' }])).toMatchObject({
      position: 2,
      percent: 66,
      complete: false,
    });
    expect(guideProgress(index, [{ kind: 'mark-guide-complete' }])).toMatchObject({ percent: 100, complete: true });
  });

  it('leaves a guide with no interactive block at 0% until it is marked complete', () => {
    const index = computeGuideBlockIndex([markdown('a'), markdown('b'), markdown('c'), markdown('d')]);

    expect(guideProgress(index, [])).toMatchObject({ percent: 0, complete: false });
    expect(guideProgress(index, [{ kind: 'mark-guide-complete' }])).toMatchObject({ percent: 100, complete: true });
  });
});

describe('evidence keyed by runtime step id', () => {
  // The runtime dispatches a "Do it" under the parser's stepId, and almost no
  // block in the library carries an author id for `positionsById` to match.
  const index = computeGuideBlockIndex([markdown(), interactive(), interactive('authored')], {
    resolveStepId: (block, context) => (block.type === 'interactive' ? `derived-${context.index}` : undefined),
  });

  it('credits a position for an anonymous block the resolver keyed', () => {
    expect(guideProgress(index, [{ kind: 'do-it', blockId: 'derived-1' }])).toMatchObject({ position: 2 });
  });

  it('falls back to the author id when the resolver keys the block under something else', () => {
    expect(guideProgress(index, [{ kind: 'do-it', blockId: 'authored' }])).toMatchObject({ position: 3 });
  });

  it('credits nothing for a step id no block in this guide carries', () => {
    expect(furthestEvidencedPosition(index, [{ kind: 'do-it', blockId: 'derived-9' }])).toBe(0);
  });
});

describe('branch child evidence', () => {
  const resolveStepId = (block: CountableBlock, context: { parentSectionId: string; index: number }) =>
    block.type === 'interactive' ? `${context.parentSectionId}:${context.index}` : undefined;

  it("completing a branch child step returns the conditional's position", () => {
    const index = computeGuideBlockIndex(
      [
        markdown('before'),
        {
          type: 'conditional',
          id: 'cond',
          whenTrue: [interactive('t1'), interactive('t2')],
          whenFalse: [interactive('f1')],
        },
        markdown('after'),
      ],
      { resolveStepId }
    );

    // The conditional is at position 2.
    expect(index.positionsById.get('cond')).toBe(2);
    // Completing a whenTrue child credits position 2.
    expect(guideProgress(index, [{ kind: 'do-it', blockId: 'conditional-true:blocks[1]:0' }])).toMatchObject({
      position: 2,
    });
    // Completing a whenFalse child credits position 2.
    expect(guideProgress(index, [{ kind: 'do-it', blockId: 'conditional-false:blocks[1]:0' }])).toMatchObject({
      position: 2,
    });
  });

  it('completing branch children from both branches returns the same conditional position', () => {
    const index = computeGuideBlockIndex(
      [
        {
          type: 'conditional',
          whenTrue: [interactive()],
          whenFalse: [interactive()],
        },
      ],
      { resolveStepId }
    );

    // Both branches credit the same position.
    expect(furthestEvidencedPosition(index, [{ kind: 'do-it', blockId: 'conditional-true:blocks[0]:0' }])).toBe(1);
    expect(furthestEvidencedPosition(index, [{ kind: 'do-it', blockId: 'conditional-false:blocks[0]:0' }])).toBe(1);
  });

  it('branchChildPositions takes precedence over positionsByStepId when the same key exists', () => {
    // This test verifies the lookup order: branchChildPositions is checked before positionsByStepId.
    // We construct a scenario where a counted block and a branch child could have the same step ID.
    // This is contrived (shouldn't happen in real guides), but validates that branch child aliases
    // take precedence since they're more specific and intentionally created.
    const customResolver = (block: CountableBlock, context: { parentSectionId: string; index: number }) => {
      // Give the first block a step ID that happens to collide with a branch child's key format.
      if (block.type === 'interactive' && context.parentSectionId === '__standalone__' && context.index === 0) {
        return 'conditional-true:blocks[1]:0'; // Simulate a collision with branch child key
      }
      return block.type === 'interactive' ? `${context.parentSectionId}:${context.index}` : undefined;
    };

    const index = computeGuideBlockIndex(
      [
        interactive('first'), // Position 1, step ID will be 'conditional-true:blocks[1]:0'
        {
          type: 'conditional',
          whenTrue: [interactive()], // Would normally generate 'conditional-true:blocks[1]:0'
          whenFalse: [],
        },
      ],
      { resolveStepId: customResolver }
    );

    // The first interactive at position 1 has the colliding step ID.
    expect(index.positionsByStepId.get('conditional-true:blocks[1]:0')).toBe(1);
    // The branch child ALSO maps to position 2 (the conditional).
    expect(index.branchChildPositions.get('conditional-true:blocks[1]:0')).toBe(2);
    // When we look up this step ID, branchChildPositions (position 2) should win over
    // positionsByStepId (position 1), since branch child aliases are more specific.
    expect(furthestEvidencedPosition(index, [{ kind: 'do-it', blockId: 'conditional-true:blocks[1]:0' }])).toBe(2);
  });

  it('reaches 100% when completing a branch child in a guide ending with a conditional', () => {
    const index = computeGuideBlockIndex(
      [
        markdown(),
        {
          type: 'conditional',
          whenTrue: [interactive()],
          whenFalse: [interactive()],
        },
      ],
      { resolveStepId }
    );

    expect(index.totalBlockCount).toBe(2);
    expect(guideProgress(index, [{ kind: 'do-it', blockId: 'conditional-true:blocks[1]:0' }])).toMatchObject({
      position: 2,
      percent: 100,
      complete: true,
    });
  });

  it('completing a step inside a section inside a branch credits the conditional', () => {
    // When a section is inside a conditional branch, its children should credit the conditional.
    const index = computeGuideBlockIndex(
      [
        markdown('before'),
        {
          type: 'conditional',
          id: 'cond',
          whenTrue: [
            {
              type: 'section',
              id: 'inner-section',
              blocks: [interactive('s1'), interactive('s2')],
            },
          ],
          whenFalse: [],
        },
        markdown('after'),
      ],
      { resolveStepId }
    );

    // Conditional is at position 2.
    expect(index.positionsById.get('cond')).toBe(2);
    // Completing a step inside the section credits the conditional.
    expect(guideProgress(index, [{ kind: 'do-it', blockId: 'section-inner-section:0' }])).toMatchObject({
      position: 2,
    });
    expect(guideProgress(index, [{ kind: 'do-it', blockId: 'section-inner-section:1' }])).toMatchObject({
      position: 2,
    });
  });

  it('completing a step inside a nested conditional credits the outer conditional', () => {
    // When a conditional is nested inside another conditional's branch, completing a step
    // inside the nested conditional should credit the OUTER conditional.
    const index = computeGuideBlockIndex(
      [
        markdown('before'),
        {
          type: 'conditional',
          id: 'outer',
          whenTrue: [
            {
              type: 'conditional',
              id: 'inner',
              whenTrue: [interactive('inner-t1')],
              whenFalse: [interactive('inner-f1')],
            },
          ],
          whenFalse: [],
        },
        markdown('after'),
      ],
      { resolveStepId }
    );

    // Outer conditional is at position 2.
    expect(index.positionsById.get('outer')).toBe(2);
    expect(index.totalBlockCount).toBe(3);
    // Completing a step in the nested conditional's whenTrue branch credits the outer conditional.
    expect(
      guideProgress(index, [{ kind: 'do-it', blockId: 'conditional-true:blocks[1].whenTrue[0]:0' }])
    ).toMatchObject({
      position: 2,
    });
    // Completing a step in the nested conditional's whenFalse branch also credits the outer conditional.
    expect(
      guideProgress(index, [{ kind: 'do-it', blockId: 'conditional-false:blocks[1].whenTrue[0]:0' }])
    ).toMatchObject({
      position: 2,
    });
  });

  it('returns 0 for unknown branch child signal', () => {
    // A step ID that doesn't correspond to any branch child should return 0.
    const index = computeGuideBlockIndex(
      [
        {
          type: 'conditional',
          whenTrue: [interactive()],
          whenFalse: [interactive()],
        },
      ],
      { resolveStepId }
    );

    // A completely unknown step ID returns 0.
    expect(furthestEvidencedPosition(index, [{ kind: 'do-it', blockId: 'nonexistent-branch-step' }])).toBe(0);
    // A step ID that looks like it could be from a branch but isn't in this guide also returns 0.
    expect(furthestEvidencedPosition(index, [{ kind: 'do-it', blockId: 'conditional-true:blocks[99]:0' }])).toBe(0);
  });
});
