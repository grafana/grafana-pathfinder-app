/**
 * Parity between the completion numerator's keys and the parser's.
 *
 * The runtime dispatches a completed "Do it" under the parser's `props.stepId`,
 * so `positionsByStepId` has to be keyed by exactly that value. Only a handful
 * of blocks in the published library carry an author id, which means a step id
 * the resolver derives differently — or does not derive at all — resolves
 * position 0 and the guide reads 0% while looking healthy. That failure is
 * silent everywhere else, so it is pinned here.
 *
 * The sweep iterates the whole completable set rather than a sample: a block
 * type the resolver misses is precisely the case that produces the silent zero,
 * and the three types the AI-fix apply path happened to need are not the nine
 * that can emit evidence.
 *
 * Lives in `src/lib/guide-stats/` deliberately. `docs/design/CONCERNS.md` maps
 * this directory to the `completion-records` concern, so a PR that weakens the
 * file activates that concern's reviewer with the contract anchor loaded.
 */

import { resolveCountedBlockStepId, resolveStepIdForBlock } from '../../global-state/guide-step-id-resolver';
import { parseJsonGuide } from '../../docs-retrieval/json-parser';
import type { ParsedElement } from '../../types/content.types';
import type { JsonBlock, JsonGuide } from '../../types/json-guide.types';
import { computeGuideBlockIndex } from './block-index';
import { COMPLETION_AFFORDANCE_BLOCK_TYPES, emitsCompletionEvidence } from './completion-affordance';
import fs from 'fs';
import path from 'path';

/**
 * Every shape that can emit completion evidence. `input` appears as its one
 * tracked authored form — a blocking datasource check — because that is the
 * only input the parser splits out as a step.
 */
const COMPLETABLE_SHAPES: ReadonlyArray<{ shape: string; block: JsonBlock }> = [
  {
    shape: 'interactive',
    block: { type: 'interactive', action: 'highlight', reftarget: 'nav[aria-label="Nav"]', content: 'Do it' },
  },
  {
    shape: 'multistep',
    block: {
      type: 'multistep',
      content: 'Do these',
      steps: [
        { action: 'highlight', reftarget: 'a' },
        { action: 'button', reftarget: 'b' },
      ],
    },
  },
  {
    shape: 'guided',
    block: { type: 'guided', content: 'Follow along', steps: [{ action: 'highlight', reftarget: 'c' }] },
  },
  {
    shape: 'quiz',
    block: {
      type: 'quiz',
      question: 'Which panel type shows a time series?',
      choices: [
        { id: 'a', text: 'Time series', correct: true },
        { id: 'b', text: 'Table' },
      ],
    },
  },
  { shape: 'terminal', block: { type: 'terminal', command: 'kubectl get pods', content: 'Run it' } },
  { shape: 'terminal-connect', block: { type: 'terminal-connect', buttonText: 'Connect', content: 'Connect first' } },
  {
    shape: 'code-block',
    block: { type: 'code-block', reftarget: '[data-testid="editor"]', code: 'up', content: 'Paste it' },
  },
  {
    shape: 'challenge',
    block: {
      type: 'challenge',
      title: 'Build a dashboard',
      brief: 'Make one panel.',
      successCriteria: 'has-dashboard-named:mine',
    },
  },
  {
    shape: 'input',
    // The schema requires an explicit id on a blocking data check, so this is
    // the one completable shape whose step id is always the author's.
    block: {
      type: 'input',
      id: 'pick-a-datasource',
      prompt: 'Pick a data source',
      inputType: 'datasource',
      variableName: 'ds',
      dataCheckQuery: 'up',
      dataCheckBlocking: true,
    },
  },
] as unknown as ReadonlyArray<{ shape: string; block: JsonBlock }>;

/** Every `props.stepId` the parser assigned, in document order. */
function collectStepIds(elements: readonly ParsedElement[]): string[] {
  const ids: string[] = [];
  const walk = (nodes: ReadonlyArray<ParsedElement | string>): void => {
    for (const node of nodes) {
      if (typeof node === 'string') {
        continue;
      }
      const stepId = node.props?.stepId;
      if (typeof stepId === 'string' && stepId.length > 0) {
        ids.push(stepId);
      }
      if (node.children) {
        walk(node.children);
      }
    }
  };
  walk(elements);
  return ids;
}

/** Wrap blocks in the minimum a guide needs to pass schema validation. */
function guideOf(blocks: readonly JsonBlock[]): JsonGuide {
  return { schemaVersion: '1.0.0', id: 'parity-fixture', title: 'Parity fixture', blocks } as JsonGuide;
}

function parseStepIds(guide: JsonGuide): string[] {
  const result = parseJsonGuide(guide);
  expect(result.errors ?? []).toEqual([]);
  return collectStepIds(result.data?.elements ?? []);
}

const withResolver = (blocks: readonly JsonBlock[]) =>
  computeGuideBlockIndex(blocks, { resolveStepId: resolveCountedBlockStepId });

describe('step-id parity with the parser, over the completable set', () => {
  it('covers every block type that can emit completion evidence', () => {
    // Read the coverage off the fixture's own block, never off its `shape`
    // label: a label is hand-written and can drift from what it names, and a
    // mislabelled entry would drop a whole type from the sweep while the suite
    // stayed green. `shape` is a test title and nothing more.
    const covered = new Set(COMPLETABLE_SHAPES.map((entry) => entry.block.type));
    const uncovered = [...COMPLETION_AFFORDANCE_BLOCK_TYPES, 'input'].filter((type) => !covered.has(type));

    expect(uncovered).toEqual([]);
  });

  it('treats every fixture shape as completable, so the sweep measures what it claims to', () => {
    const passive = COMPLETABLE_SHAPES.filter((entry) => !emitsCompletionEvidence(entry.block));

    expect(passive.map((entry) => entry.shape)).toEqual([]);
  });

  describe.each(COMPLETABLE_SHAPES)('$shape', ({ block }) => {
    it('derives the id the parser assigns, at the top level', () => {
      const blocks: JsonBlock[] = [{ type: 'markdown', content: 'Preamble' } as unknown as JsonBlock, block];
      const index = withResolver(blocks);

      expect([...index.positionsByStepId.entries()]).toEqual([[parseStepIds(guideOf(blocks))[0]!, 2]]);
    });

    it('derives the id the parser assigns, inside a section', () => {
      const blocks: JsonBlock[] = [
        {
          type: 'section',
          id: 'setup',
          title: 'Setup',
          blocks: [{ type: 'markdown', content: 'Preamble' }, block],
        } as unknown as JsonBlock,
      ];
      const index = withResolver(blocks);

      expect([...index.positionsByStepId.entries()]).toEqual([[parseStepIds(guideOf(blocks))[0]!, 2]]);
    });

    it('derives the id the parser assigns, inside an anonymous section', () => {
      // `id` is optional on a section, and without one the parser keys its
      // children on the section's JSON path instead. That branch decides the
      // numerator key for every completable inside an unnamed section.
      const blocks: JsonBlock[] = [
        {
          type: 'section',
          title: 'Setup',
          blocks: [{ type: 'markdown', content: 'Preamble' }, block],
        } as unknown as JsonBlock,
      ];
      const index = withResolver(blocks);

      expect([...index.positionsByStepId.entries()]).toEqual([[parseStepIds(guideOf(blocks))[0]!, 2]]);
    });

    it('derives the id the parser assigns, inside an assistant block in a section', () => {
      // The assistant namespace is keyed on the block's JSON path rather than
      // an id, so the counter has to spell the path the parser's way.
      const blocks: JsonBlock[] = [
        {
          type: 'section',
          id: 'setup',
          title: 'Setup',
          blocks: [
            { type: 'markdown', content: 'Preamble' },
            { type: 'assistant', blocks: [{ type: 'markdown', content: 'Aside' }, block] },
          ],
        } as unknown as JsonBlock,
      ];
      const index = withResolver(blocks);

      expect([...index.positionsByStepId.entries()]).toEqual([[parseStepIds(guideOf(blocks))[0]!, 3]]);
    });
  });

  it('gives an anonymous block in a section a different id from the same block at the top level', () => {
    const block = COMPLETABLE_SHAPES[0]!.block;
    const top = resolveStepIdForBlock(block, { parentSectionId: '__standalone__', index: 0 });
    const nested = resolveStepIdForBlock(block, { parentSectionId: 'section-setup', index: 0 });

    expect(top).toBeDefined();
    expect(top).not.toBe(nested);
  });

  it('treats an empty author id as no id, exactly as the parser does', () => {
    const blocks: JsonBlock[] = [{ ...COMPLETABLE_SHAPES[0]!.block, id: '' } as unknown as JsonBlock];
    const index = withResolver(blocks);

    expect([...index.positionsByStepId.entries()]).toEqual([[parseStepIds(guideOf(blocks))[0]!, 1]]);
  });

  it('leaves the map empty when no resolver is injected', () => {
    const index = computeGuideBlockIndex([COMPLETABLE_SHAPES[0]!.block]);

    expect(index.positionsByStepId.size).toBe(0);
  });
});

describe('step-id parity on the bundled corpus', () => {
  const BUNDLED_DIR = path.resolve(__dirname, '../../bundled-interactives');
  const guides = fs
    .readdirSync(BUNDLED_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(BUNDLED_DIR, name, 'content.json')))
    .map((name) => ({
      name,
      guide: JSON.parse(fs.readFileSync(path.join(BUNDLED_DIR, name, 'content.json'), 'utf-8')) as JsonGuide,
    }));

  it('finds bundled guides to sweep', () => {
    expect(guides.length).toBeGreaterThan(0);
  });

  it.each(guides)('$name resolves every completable block to a parser step id', ({ guide }) => {
    const index = withResolver(guide.blocks);
    const assigned = new Set(parseStepIds(guide));

    const unresolved = index.blocks
      .filter((counted) => counted.completable)
      .filter(
        (counted) => ![...index.positionsByStepId.entries()].some(([, position]) => position === counted.position)
      )
      .map((counted) => `${counted.type}@${counted.position}`);
    const foreign = [...index.positionsByStepId.keys()].filter((stepId) => !assigned.has(stepId));

    expect(unresolved).toEqual([]);
    expect(foreign).toEqual([]);
  });
});
