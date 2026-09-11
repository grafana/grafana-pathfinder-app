/**
 * Behavioural tests for the canonical block-count rule (decision 2026-08-19).
 */

import { KNOWN_FIELDS, VALID_BLOCK_TYPES } from '../../types/json-guide.schema';
import type { JsonBlock } from '../../types/json-guide.types';
import {
  computeGuideBlockIndex,
  OPAQUE_PARENT_BLOCK_TYPES,
  TRANSPARENT_CONTAINER_BLOCK_TYPES,
  type CountableBlock,
} from './block-index';

function markdown(id?: string): CountableBlock {
  return { type: 'markdown', ...(id ? { id } : {}) };
}

function interactive(id?: string): CountableBlock {
  return { type: 'interactive', ...(id ? { id } : {}) };
}

function section(blocks: CountableBlock[], id?: string): CountableBlock {
  return { type: 'section', blocks, ...(id ? { id } : {}) };
}

describe('computeGuideBlockIndex', () => {
  it('counts an empty guide as zero', () => {
    const index = computeGuideBlockIndex([]);

    expect(index.totalBlockCount).toBe(0);
    expect(index.blocks).toEqual([]);
    expect(index.finalCompletablePosition).toBe(0);
  });

  it('tolerates missing and malformed block arrays', () => {
    expect(computeGuideBlockIndex(undefined).totalBlockCount).toBe(0);
    expect(computeGuideBlockIndex([{ type: 'section' }]).totalBlockCount).toBe(0);
    expect(computeGuideBlockIndex([undefined as unknown as CountableBlock, markdown()]).totalBlockCount).toBe(1);
  });

  it('does not count a section itself — five blocks in a section contribute five, not six', () => {
    const index = computeGuideBlockIndex([section([markdown(), markdown(), markdown(), markdown(), markdown()])]);

    expect(index.totalBlockCount).toBe(5);
    expect(index.sectionCount).toBe(1);
  });

  it('excludes every transparent container from the denominator while counting its contents', () => {
    for (const type of TRANSPARENT_CONTAINER_BLOCK_TYPES) {
      const index = computeGuideBlockIndex([{ type, blocks: [markdown(), markdown()] }]);

      expect(index.totalBlockCount).toBe(2);
    }
  });

  it('counts nested containers once over, in document order', () => {
    const index = computeGuideBlockIndex([
      markdown('intro'),
      section([markdown('a'), { type: 'assistant', blocks: [interactive('b')] }, markdown('c')]),
      markdown('outro'),
    ]);

    expect(index.totalBlockCount).toBe(5);
    expect(index.blocks.map((block) => block.id)).toEqual(['intro', 'a', 'b', 'c', 'outro']);
    expect(index.blocks.map((block) => block.position)).toEqual([1, 2, 3, 4, 5]);
  });

  it('records the structural path of every counted block', () => {
    const index = computeGuideBlockIndex([markdown(), section([markdown(), interactive()])]);

    expect(index.blocks.map((block) => block.path)).toEqual([[0], [1, 0], [1, 1]]);
  });

  it('counts multistep and guided as exactly one block each, ignoring their steps', () => {
    const index = computeGuideBlockIndex([
      { type: 'multistep', id: 'ms' },
      { type: 'guided', id: 'g' },
    ]);

    expect(index.totalBlockCount).toBe(2);
    expect(index.positionsById.get('ms')).toBe(1);
    expect(index.positionsById.get('g')).toBe(2);
  });

  it('counts a multistep with many steps as one block', () => {
    const multistep = { type: 'multistep', steps: [{}, {}, {}, {}] } as unknown as CountableBlock;

    expect(computeGuideBlockIndex([multistep]).totalBlockCount).toBe(1);
  });

  it('counts a conditional as one block and does not descend into either branch', () => {
    const index = computeGuideBlockIndex([
      markdown('before'),
      {
        type: 'conditional',
        id: 'cond',
        whenTrue: [markdown('t1'), interactive('t2')],
        whenFalse: [markdown('f1')],
      },
      markdown('after'),
    ]);

    expect(index.totalBlockCount).toBe(3);
    expect(index.blocks.map((block) => block.id)).toEqual(['before', 'cond', 'after']);
    expect(index.positionsById.has('t2')).toBe(false);
  });

  it('treats a conditional as non-interactive, so a branch interactive is not the final step', () => {
    const index = computeGuideBlockIndex([
      interactive('early'),
      { type: 'conditional', whenTrue: [interactive('hidden')], whenFalse: [] },
    ]);

    expect(index.finalCompletablePosition).toBe(1);
    expect(index.completableBlockCount).toBe(1);
  });

  it('never descends into an opaque parent, whatever child key it uses', () => {
    for (const type of OPAQUE_PARENT_BLOCK_TYPES) {
      const index = computeGuideBlockIndex([
        { type, blocks: [markdown()], whenTrue: [markdown()], whenFalse: [markdown()] },
      ]);

      expect(index.totalBlockCount).toBe(1);
    }
  });

  it('tracks interactive blocks and the final interactive position', () => {
    const index = computeGuideBlockIndex([markdown(), interactive(), markdown(), interactive(), markdown()]);

    expect(index.completableBlockCount).toBe(2);
    expect(index.finalCompletablePosition).toBe(4);
  });

  it('maps a container to its last counted descendant, keyed as the runtime section id', () => {
    const index = computeGuideBlockIndex([markdown(), section([markdown(), interactive()], 'setup'), markdown()]);

    expect(index.containerEndPositions.get('section-setup')).toBe(3);
  });

  it('omits containers with no counted descendants from the container-end map', () => {
    const index = computeGuideBlockIndex([section([], 'empty')]);

    expect(index.containerEndPositions.has('section-empty')).toBe(false);
  });

  it('keeps the first position when ids are duplicated', () => {
    const index = computeGuideBlockIndex([markdown('dup'), markdown('dup')]);

    expect(index.positionsById.get('dup')).toBe(1);
  });

  it('keeps the first container end when container ids are duplicated', () => {
    const index = computeGuideBlockIndex([
      section([markdown('a'), markdown('b')], 'dup'),
      markdown(),
      markdown(),
      section([markdown('c'), markdown('d')], 'dup'),
    ]);

    expect(index.containerEndPositions.get('section-dup')).toBe(2);
  });

  it('counts a snippet-ref as one block and does not descend into it', () => {
    const index = computeGuideBlockIndex([
      markdown('before'),
      { type: 'snippet-ref', id: 'ref', blocks: [markdown('s1'), markdown('s2'), interactive('s3')] },
      markdown('after'),
    ]);

    expect(index.totalBlockCount).toBe(3);
    expect(index.blocks.map((block) => block.id)).toEqual(['before', 'ref', 'after']);
    expect(index.positionsById.has('s3')).toBe(false);
    expect(index.finalCompletablePosition).toBe(0);
  });

  it('excludes a positionsByStepId entry for every sibling after a snippet-ref, but keeps the ref itself and earlier siblings', () => {
    const resolveStepId = jest.fn(
      (_block: CountableBlock, context: { parentSectionId: string; index: number }) =>
        `${context.parentSectionId}:${context.index}`
    );

    const index = computeGuideBlockIndex(
      [interactive(), { type: 'snippet-ref', blocks: [] }, interactive(), interactive()],
      { resolveStepId }
    );

    // Post-inlining the snippet-ref's real expansion size shifts every later
    // sibling's runtime step id, which this pre-inlining traversal cannot
    // know without waiting on the snippet CDN — so it must not guess.
    expect(index.positionsByStepId.size).toBe(2);
    expect(index.positionsByStepId.get('__standalone__:0')).toBe(1); // before the ref
    expect(index.positionsByStepId.get('__standalone__:1')).toBe(2); // the ref itself
    expect(index.positionsByStepId.has('__standalone__:2')).toBe(false); // after the ref
    expect(index.positionsByStepId.has('__standalone__:3')).toBe(false); // after the ref
  });

  it('excludes blocks nested inside a sibling that follows a snippet-ref', () => {
    const resolveStepId = (_block: CountableBlock, context: { parentSectionId: string; index: number }) =>
      `${context.parentSectionId}:${context.index}`;

    const index = computeGuideBlockIndex([{ type: 'snippet-ref', blocks: [] }, section([interactive()])], {
      resolveStepId,
    });

    // The id-less section's own key is derived from its PRE-inlining sibling
    // index, which the expansion shifts — so its children must not claim a
    // step id either, or they claim one the runtime gives another block.
    expect(index.positionsByStepId.has('section:blocks[1].blocks:0')).toBe(false);
    expect(index.positionsByStepId.get('__standalone__:0')).toBe(1);
    expect(index.positionsByStepId.size).toBe(1);
  });

  it('keeps step ids inside an id-bearing section that follows a snippet-ref', () => {
    const resolveStepId = (_block: CountableBlock, context: { parentSectionId: string; index: number }) =>
      `${context.parentSectionId}:${context.index}`;

    const index = computeGuideBlockIndex([{ type: 'snippet-ref', blocks: [] }, section([interactive()], 'b')], {
      resolveStepId,
    });

    // `section-b` is the runtime namespace whatever the splice does to the
    // outer array, and the child's index is its position inside the section —
    // so this position is knowable and must not be given up.
    expect(index.positionsByStepId.get('section-b:0')).toBe(2);
  });

  it('still excludes an id-less section nested inside an id-bearing one that follows a snippet-ref', () => {
    const resolveStepId = (_block: CountableBlock, context: { parentSectionId: string; index: number }) =>
      `${context.parentSectionId}:${context.index}`;

    const index = computeGuideBlockIndex(
      [{ type: 'snippet-ref', blocks: [] }, section([section([interactive()])], 'b')],
      { resolveStepId }
    );

    // The inner section takes its namespace from a json path that still
    // carries the shifted outer index.
    expect(index.positionsByStepId.has('section:blocks[1].blocks[0].blocks:0')).toBe(false);
    expect(index.positionsByStepId.size).toBe(1);
  });

  it('does not let a snippet-ref in one section suppress step ids in a sibling section', () => {
    const resolveStepId = (_block: CountableBlock, context: { parentSectionId: string; index: number }) =>
      `${context.parentSectionId}:${context.index}`;

    const index = computeGuideBlockIndex(
      [section([{ type: 'snippet-ref', blocks: [] }, interactive()], 'a'), section([interactive()], 'b')],
      { resolveStepId }
    );

    expect(index.positionsByStepId.has('section-b:0')).toBe(true);
  });
});

/**
 * Every schema block type must be deliberately classified. Runtime defaults an
 * unclassified type to countable-once, which is the safe direction; these tests
 * are what force a new block type to be classified rather than defaulted.
 */
describe('block-type classification', () => {
  const transparent = new Set<string>(TRANSPARENT_CONTAINER_BLOCK_TYPES);
  const opaque = new Set<string>(OPAQUE_PARENT_BLOCK_TYPES);

  /** Types that hold no children at all, so counting one is the only option. */
  const PLAIN_BLOCK_TYPES = [
    'markdown',
    'divider',
    'html',
    'image',
    'video',
    'callout',
    'interactive',
    'quiz',
    'input',
    'terminal',
    'terminal-connect',
    'code-block',
    'challenge',
    'grot-guide',
  ];

  it('partitions the schema exactly — no type unclassified, none classified twice', () => {
    const classified = [...TRANSPARENT_CONTAINER_BLOCK_TYPES, ...OPAQUE_PARENT_BLOCK_TYPES, ...PLAIN_BLOCK_TYPES];

    expect(classified.filter((type) => !VALID_BLOCK_TYPES.has(type))).toEqual([]);
    expect([...VALID_BLOCK_TYPES].filter((type) => !classified.includes(type))).toEqual([]);
    expect(classified.filter((type, at) => classified.indexOf(type) !== at)).toEqual([]);
  });

  it('classifies every schema type that carries child blocks as a container, never as plain', () => {
    const childFields = ['blocks', 'whenTrue', 'whenFalse'];
    const carriesChildren = [...VALID_BLOCK_TYPES].filter((type) =>
      childFields.some((field) => KNOWN_FIELDS[type]?.has(field))
    );

    expect(carriesChildren.length).toBeGreaterThan(0);
    expect(carriesChildren.filter((type) => !transparent.has(type) && !opaque.has(type))).toEqual([]);
  });

  it('counts each classified type the way its classification says', () => {
    for (const type of VALID_BLOCK_TYPES) {
      const index = computeGuideBlockIndex([
        { type, blocks: [markdown(), markdown()], whenTrue: [markdown()], whenFalse: [markdown()] },
      ]);

      expect([type, index.totalBlockCount]).toEqual([type, transparent.has(type) ? 2 : 1]);
    }
  });
});

describe('CountableBlock', () => {
  it('accepts the JsonBlock union without a cast', () => {
    const blocks: JsonBlock[] = [
      { type: 'markdown', content: 'hi' },
      {
        type: 'section',
        title: 'Setup',
        blocks: [{ type: 'interactive', action: 'button', reftarget: 'Save', content: 'Save it' }],
      },
      { type: 'conditional', conditions: ['is-admin'], whenTrue: [], whenFalse: [] },
    ];
    const countable: readonly CountableBlock[] = blocks;

    expect(computeGuideBlockIndex(countable).totalBlockCount).toBe(3);
  });
});
