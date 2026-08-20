/**
 * Ratchet: the tier-1 completion-affordance set must stay in step with the
 * tier-4 runtime tracked-step registry.
 *
 * `src/lib/guide-stats` cannot import `STEP_TYPE_PARSE_KEYS` — that would be an
 * upward tier import — so this test is the mechanism instead. It is the
 * counterpart of the container-classification totality test in
 * `block-index.test.ts`, and it exists because a block type added to a
 * rendering-oriented list for a rendering reason must not silently change
 * whether a stamped guide is completable.
 *
 * Precedent: `content-renderer.registry-parity.test.ts`,
 * `step-type-registry.tripwire.test.ts`.
 */

import { STEP_TYPE_PARSE_KEYS } from '../../components/interactive-tutorial/step-type-registry';
import { INTERACTIVE_BLOCK_TYPES } from '../../constants/json-guide-classification';
import { VALID_BLOCK_TYPES } from '../../types/json-guide.schema';
import { computeGuideBlockIndex } from './block-index';
import {
  COMPLETION_AFFORDANCE_BLOCK_TYPES,
  NON_COMPLETABLE_INTERACTIVE_BLOCK_TYPES,
  emitsCompletionEvidence,
} from './completion-affordance';

/**
 * Every tracked parse key, mapped to the block type that emits it.
 * `datasource-check-step` is an authored shape of `input`, not a block type.
 */
const PARSE_KEY_TO_BLOCK_TYPE: Record<string, string> = {
  'interactive-step': 'interactive',
  'interactive-multi-step': 'multistep',
  'interactive-guided': 'guided',
  'quiz-block': 'quiz',
  'terminal-step': 'terminal',
  'terminal-connect-step': 'terminal-connect',
  'code-block-step': 'code-block',
  'challenge-block': 'challenge',
  'datasource-check-step': 'input',
};

/** The one authored `input` shape the parser splits out as a tracked step. */
const TRACKED_INPUT = {
  type: 'input',
  inputType: 'datasource',
  dataCheckQuery: 'up',
  dataCheckBlocking: true,
};

describe('completion affordance parity with the runtime step registry', () => {
  it('maps every tracked parse key to a block type', () => {
    const unmapped = STEP_TYPE_PARSE_KEYS.filter((key) => PARSE_KEY_TO_BLOCK_TYPE[key] === undefined);

    expect(unmapped).toEqual([]);
  });

  it('claims no parse key the registry does not have', () => {
    const registry = new Set<string>(STEP_TYPE_PARSE_KEYS);
    const stale = Object.keys(PARSE_KEY_TO_BLOCK_TYPE).filter((key) => !registry.has(key));

    expect(stale).toEqual([]);
  });

  it('counts exactly the unconditionally-tracked block types as completable', () => {
    const fromRegistry = STEP_TYPE_PARSE_KEYS.map((key) => PARSE_KEY_TO_BLOCK_TYPE[key]).filter(
      (type) => type !== 'input'
    );

    expect([...COMPLETION_AFFORDANCE_BLOCK_TYPES].sort()).toEqual([...new Set(fromRegistry)].sort());
  });

  it('treats a blocking datasource input as completable and every other input as passive', () => {
    expect(emitsCompletionEvidence(TRACKED_INPUT)).toBe(true);
    expect(emitsCompletionEvidence({ type: 'input' })).toBe(false);
    expect(emitsCompletionEvidence({ type: 'input', inputType: 'text' })).toBe(false);
    expect(emitsCompletionEvidence({ ...TRACKED_INPUT, dataCheckBlocking: false })).toBe(false);
    expect(emitsCompletionEvidence({ ...TRACKED_INPUT, dataCheckQuery: '   ' })).toBe(false);
    expect(emitsCompletionEvidence({ ...TRACKED_INPUT, inputType: 'datasource', dataCheckQuery: undefined })).toBe(
      false
    );
  });

  it('never treats a block type with no parse key as completable', () => {
    for (const type of NON_COMPLETABLE_INTERACTIVE_BLOCK_TYPES) {
      expect(emitsCompletionEvidence({ type })).toBe(false);
    }
  });

  it('classifies every block type in the schema, so a new one must declare itself', () => {
    const declared = new Set<string>([
      ...COMPLETION_AFFORDANCE_BLOCK_TYPES,
      ...NON_COMPLETABLE_INTERACTIVE_BLOCK_TYPES,
      'input',
    ]);
    const interactiveButUndeclared = [...INTERACTIVE_BLOCK_TYPES].filter((type) => !declared.has(type));

    expect(interactiveButUndeclared).toEqual([]);
    expect([...declared].filter((type) => !VALID_BLOCK_TYPES.has(type))).toEqual([]);
  });

  it('does not simply mirror the rendering-oriented interactive list', () => {
    const renderInteractive = new Set<string>(INTERACTIVE_BLOCK_TYPES);
    const completable = new Set<string>(COMPLETION_AFFORDANCE_BLOCK_TYPES);
    const renderOnly = [...renderInteractive].filter((type) => !completable.has(type));

    expect(renderOnly.sort()).toEqual(['grot-guide', 'input']);
  });
});

describe('guides whose final block cannot emit completion evidence', () => {
  it('does not report a plain input as the final interactive block', () => {
    const index = computeGuideBlockIndex([{ type: 'markdown' }, { type: 'input', inputType: 'text' }]);

    expect(index.totalBlockCount).toBe(2);
    expect(index.interactiveBlockCount).toBe(0);
    expect(index.finalInteractivePosition).toBe(0);
    expect(index.finalInteractivePosition).not.toBe(index.totalBlockCount);
  });

  it('does not report a grot-guide as the final interactive block', () => {
    const index = computeGuideBlockIndex([{ type: 'markdown' }, { type: 'markdown' }, { type: 'grot-guide' }]);

    expect(index.finalInteractivePosition).toBe(0);
    expect(index.finalInteractivePosition).not.toBe(index.totalBlockCount);
  });

  it('does report a blocking datasource input as the final interactive block', () => {
    const index = computeGuideBlockIndex([{ type: 'markdown' }, TRACKED_INPUT]);

    expect(index.interactiveBlockCount).toBe(1);
    expect(index.finalInteractivePosition).toBe(index.totalBlockCount);
  });
});
