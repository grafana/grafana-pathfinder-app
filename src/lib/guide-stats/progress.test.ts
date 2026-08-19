/**
 * Behavioural tests for the position-to-percentage rule, including the
 * "final step is interactive means 100%" special case.
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

  it('yields 100% when the final interactive block is reached, despite trailing prose', () => {
    const index = computeGuideBlockIndex([markdown(), interactive('doit'), markdown(), markdown()]);

    expect(index.totalBlockCount).toBe(4);
    expect(index.finalInteractivePosition).toBe(2);
    expect(guideProgressAtPosition(index, 2)).toMatchObject({ percent: 100, fraction: 1, complete: true });
  });

  it('does not shortcut earlier interactive blocks to 100%', () => {
    const index = computeGuideBlockIndex([interactive('first'), markdown(), interactive('last'), markdown()]);

    expect(guideProgressAtPosition(index, 1)).toMatchObject({ percent: 25, complete: false });
    expect(guideProgressAtPosition(index, 3)).toMatchObject({ percent: 100, complete: true });
  });

  it('offers no interactive shortcut for a guide with no interactive blocks', () => {
    const index = computeGuideBlockIndex([markdown(), markdown(), markdown(), markdown()]);

    expect(guideProgressAtPosition(index, 3)).toMatchObject({ percent: 75, complete: false });
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
    expect(furthestEvidencedPosition(index, [{ kind: 'mark-section-complete', blockId: 'setup' }])).toBe(3);
  });

  it('treats "mark as complete" on the guide as reaching the end', () => {
    expect(furthestEvidencedPosition(index, [{ kind: 'mark-guide-complete' }])).toBe(4);
  });

  it('ignores signals naming a block that is not counted', () => {
    expect(furthestEvidencedPosition(index, [{ kind: 'do-it', blockId: 'gone' }])).toBe(0);
    expect(furthestEvidencedPosition(index, [{ kind: 'do-it' }])).toBe(0);
    expect(furthestEvidencedPosition(index, [{ kind: 'mark-section-complete', blockId: 'intro' }])).toBe(0);
  });

  it('ignores no evidence at all', () => {
    expect(furthestEvidencedPosition(index, [])).toBe(0);
  });
});

describe('guideProgress', () => {
  it('turns the raw signals of a guide ending in a "Do it" into 100%', () => {
    const index = computeGuideBlockIndex([
      { type: 'section', blocks: [markdown('brief'), interactive('run')] },
      markdown('well-done'),
    ]);

    expect(guideProgress(index, [{ kind: 'do-it', blockId: 'run' }])).toMatchObject({
      position: 2,
      totalBlockCount: 3,
      percent: 100,
      complete: true,
    });
  });

  it('leaves a guide with no interactive block at 0% until it is marked complete', () => {
    const index = computeGuideBlockIndex([markdown('a'), markdown('b'), markdown('c'), markdown('d')]);

    expect(guideProgress(index, [])).toMatchObject({ percent: 0, complete: false });
    expect(guideProgress(index, [{ kind: 'mark-guide-complete' }])).toMatchObject({ percent: 100, complete: true });
  });
});
