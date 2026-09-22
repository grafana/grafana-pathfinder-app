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

  it('maps a section with no author id under its path, so its acknowledgement can evidence a position', () => {
    const index = computeGuideBlockIndex([markdown(), section([markdown(), interactive()]), markdown()]);

    expect(index.containerEndPositions.get('section:blocks[1]')).toBe(3);
  });

  it('omits an id-less section whose path a snippet-ref shifted, rather than crediting another section', () => {
    // Post-inlining the first section sits where the second one is keyed here,
    // so registering either would credit the wrong section's end position —
    // and progress is monotonic, so that could never be corrected downward.
    const index = computeGuideBlockIndex([
      { type: 'snippet-ref', blocks: [] },
      section([markdown(), interactive()]),
      section([markdown()]),
    ]);

    expect([...index.containerEndPositions.keys()]).toEqual([]);
  });

  it('still registers an id-bearing section after a snippet-ref, whose id no splice can shift', () => {
    const index = computeGuideBlockIndex([{ type: 'snippet-ref', blocks: [] }, section([markdown()], 'setup')]);

    expect(index.containerEndPositions.get('section-setup')).toBe(2);
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

describe('branchChildPositions', () => {
  const resolveStepId = (block: CountableBlock, context: { parentSectionId: string; index: number }) =>
    block.type === 'interactive' ? `${context.parentSectionId}:${context.index}` : undefined;

  it("maps branch child step IDs to the conditional's position", () => {
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
    // Branch children map to the conditional's position.
    expect(index.branchChildPositions.get('conditional-true:blocks[1]:0')).toBe(2);
    expect(index.branchChildPositions.get('conditional-true:blocks[1]:1')).toBe(2);
    expect(index.branchChildPositions.get('conditional-false:blocks[1]:0')).toBe(2);
    // The conditional still counts as one block.
    expect(index.totalBlockCount).toBe(3);
  });

  it('produces no mappings for empty branches', () => {
    const index = computeGuideBlockIndex(
      [
        {
          type: 'conditional',
          whenTrue: [],
          whenFalse: [],
        },
      ],
      { resolveStepId }
    );

    expect(index.branchChildPositions.size).toBe(0);
  });

  it('produces no mappings when the conditional follows a snippet-ref (path shifted)', () => {
    const index = computeGuideBlockIndex(
      [
        { type: 'snippet-ref', blocks: [] },
        {
          type: 'conditional',
          whenTrue: [interactive()],
          whenFalse: [interactive()],
        },
      ],
      { resolveStepId }
    );

    // The conditional itself is registered (it has no derived step ID).
    expect(index.totalBlockCount).toBe(2);
    // But its branch children are not, because the path was shifted.
    expect(index.branchChildPositions.size).toBe(0);
  });

  it('excludes later siblings of a snippet-ref inside a branch, but includes earlier ones', () => {
    const index = computeGuideBlockIndex(
      [
        {
          type: 'conditional',
          whenTrue: [interactive('t1'), { type: 'snippet-ref', blocks: [] }, interactive('t2')],
          whenFalse: [interactive('f1')],
        },
      ],
      { resolveStepId }
    );

    // The first interactive in whenTrue is included.
    expect(index.branchChildPositions.has('conditional-true:blocks[0]:0')).toBe(true);
    // The snippet-ref itself is included (it counts as a block, but has no derived step ID from resolveStepId).
    // The interactive after the snippet-ref is excluded.
    expect(index.branchChildPositions.has('conditional-true:blocks[0]:2')).toBe(false);
    // whenFalse has no snippet-ref, so all its children are included.
    expect(index.branchChildPositions.has('conditional-false:blocks[0]:0')).toBe(true);
  });

  it('is empty when no resolver is supplied', () => {
    const index = computeGuideBlockIndex([
      {
        type: 'conditional',
        whenTrue: [interactive()],
        whenFalse: [interactive()],
      },
    ]);

    expect(index.branchChildPositions.size).toBe(0);
  });

  it('maps multiple branch children to the same conditional position', () => {
    const index = computeGuideBlockIndex(
      [
        markdown(),
        {
          type: 'conditional',
          whenTrue: [interactive(), interactive(), interactive()],
          whenFalse: [interactive(), interactive()],
        },
        markdown(),
      ],
      { resolveStepId }
    );

    // All true-branch children map to position 2.
    expect(index.branchChildPositions.get('conditional-true:blocks[1]:0')).toBe(2);
    expect(index.branchChildPositions.get('conditional-true:blocks[1]:1')).toBe(2);
    expect(index.branchChildPositions.get('conditional-true:blocks[1]:2')).toBe(2);
    // All false-branch children map to position 2.
    expect(index.branchChildPositions.get('conditional-false:blocks[1]:0')).toBe(2);
    expect(index.branchChildPositions.get('conditional-false:blocks[1]:1')).toBe(2);
  });

  it('handles nested conditionals by mapping nested branch children to the outer conditional', () => {
    // Nested conditionals: the inner conditional's branch children should map to the
    // OUTER conditional's position, so any interactive step inside the nested
    // conditional credits the outer conditional.
    const index = computeGuideBlockIndex(
      [
        {
          type: 'conditional',
          id: 'outer',
          whenTrue: [
            interactive('t1'),
            {
              type: 'conditional',
              id: 'inner',
              whenTrue: [interactive('inner-t1')],
              whenFalse: [interactive('inner-f1')],
            },
          ],
          whenFalse: [],
        },
      ],
      { resolveStepId }
    );

    // Outer conditional is at position 1.
    expect(index.positionsById.get('outer')).toBe(1);
    // Inner conditional is NOT counted separately (it's inside the opaque outer conditional).
    expect(index.positionsById.has('inner')).toBe(false);
    expect(index.totalBlockCount).toBe(1);

    // The outer conditional's direct child (interactive at index 0) maps to position 1.
    expect(index.branchChildPositions.get('conditional-true:blocks[0]:0')).toBe(1);
    // The inner conditional is at index 1 in the outer's whenTrue branch.
    // The inner conditional's whenTrue branch children map to position 1 (the outer conditional).
    expect(index.branchChildPositions.get('conditional-true:blocks[0].whenTrue[1]:0')).toBe(1);
    // The inner conditional's whenFalse branch children also map to position 1.
    expect(index.branchChildPositions.get('conditional-false:blocks[0].whenTrue[1]:0')).toBe(1);
    // All three interactives (one outer, two nested) should be mapped.
    expect(index.branchChildPositions.size).toBe(3);
  });

  it('handles sections inside branches by recursing into their children', () => {
    // When a section is inside a conditional branch, the section's children should
    // map to the conditional's position using the section's runtime ID as parentSectionId.
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
    // Section's children use the section's runtime ID as parentSectionId.
    expect(index.branchChildPositions.get('section-inner-section:0')).toBe(2);
    expect(index.branchChildPositions.get('section-inner-section:1')).toBe(2);
    // Total still counts just the 3 top-level blocks.
    expect(index.totalBlockCount).toBe(3);
  });

  it('handles id-less sections inside branches using path-based namespace', () => {
    const index = computeGuideBlockIndex(
      [
        {
          type: 'conditional',
          whenTrue: [
            {
              type: 'section',
              blocks: [interactive()],
            },
          ],
          whenFalse: [],
        },
      ],
      { resolveStepId }
    );

    // Section without an ID gets a path-based namespace.
    // The section is at blocks[0].whenTrue[0], so its namespace is 'section:blocks[0].whenTrue[0]'.
    expect(index.branchChildPositions.get('section:blocks[0].whenTrue[0]:0')).toBe(1);
  });

  it('handles assistant containers inside branches', () => {
    const index = computeGuideBlockIndex(
      [
        {
          type: 'conditional',
          whenTrue: [
            {
              type: 'assistant',
              blocks: [interactive(), interactive()],
            },
          ],
          whenFalse: [],
        },
      ],
      { resolveStepId }
    );

    // Assistant uses a path-based namespace.
    expect(index.branchChildPositions.get('assistant:blocks[0].whenTrue[0]:0')).toBe(1);
    expect(index.branchChildPositions.get('assistant:blocks[0].whenTrue[0]:1')).toBe(1);
  });

  it('handles collapsible containers inside branches', () => {
    const index = computeGuideBlockIndex(
      [
        {
          type: 'conditional',
          whenTrue: [
            {
              type: 'collapsible',
              blocks: [interactive()],
            },
          ],
          whenFalse: [],
        },
      ],
      { resolveStepId }
    );

    // Collapsible has no step context (namespace.id is undefined), so its children
    // should not be collected.
    expect(index.branchChildPositions.size).toBe(0);
  });

  it('handles deeply nested structures inside branches', () => {
    // Section > Conditional > Section > Interactive
    const index = computeGuideBlockIndex(
      [
        {
          type: 'conditional',
          id: 'outer',
          whenTrue: [
            {
              type: 'section',
              id: 'section1',
              blocks: [
                {
                  type: 'conditional',
                  id: 'inner',
                  whenTrue: [
                    {
                      type: 'section',
                      id: 'section2',
                      blocks: [interactive('deep')],
                    },
                  ],
                  whenFalse: [],
                },
              ],
            },
          ],
          whenFalse: [],
        },
      ],
      { resolveStepId }
    );

    // The deeply nested interactive should map to the outer conditional (position 1).
    expect(index.branchChildPositions.get('section-section2:0')).toBe(1);
    expect(index.totalBlockCount).toBe(1);
  });

  it('produces no mappings for branches with only non-completable blocks', () => {
    // Markdown blocks are non-completable (they don't emit completion evidence).
    // The resolver returns undefined for markdown, so no step IDs are collected.
    const index = computeGuideBlockIndex(
      [
        {
          type: 'conditional',
          whenTrue: [markdown('t1'), markdown('t2')],
          whenFalse: [markdown('f1')],
        },
      ],
      { resolveStepId }
    );

    // No step IDs collected because markdown blocks have no step IDs from resolveStepId.
    expect(index.branchChildPositions.size).toBe(0);
    expect(index.totalBlockCount).toBe(1);
  });

  it('handles one-sided conditionals with only whenTrue populated', () => {
    // A conditional with only whenTrue populated (whenFalse is empty or undefined).
    const index = computeGuideBlockIndex(
      [
        markdown('before'),
        {
          type: 'conditional',
          id: 'one-sided',
          whenTrue: [interactive('t1'), interactive('t2')],
          whenFalse: [], // Empty whenFalse
        },
        markdown('after'),
      ],
      { resolveStepId }
    );

    // Conditional is at position 2.
    expect(index.positionsById.get('one-sided')).toBe(2);
    // whenTrue children are mapped.
    expect(index.branchChildPositions.get('conditional-true:blocks[1]:0')).toBe(2);
    expect(index.branchChildPositions.get('conditional-true:blocks[1]:1')).toBe(2);
    // whenFalse is empty, so no mappings for it.
    expect(index.branchChildPositions.size).toBe(2);
    expect(index.totalBlockCount).toBe(3);
  });
});
