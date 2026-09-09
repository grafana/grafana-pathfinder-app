/**
 * Which block types can emit completion evidence.
 *
 * This is a different question from "which blocks render interactively", and
 * conflating the two leaves a guide stranded short of 100% on its own
 * interactive path: a block counted as completable that emits no evidence can
 * become the guide's final counted block, so the furthest evidenced position
 * can never reach the denominator and the reader is left with only the "Mark as
 * complete" button. It also makes `finalCompletablePosition` misreport the tail
 * it is the authoring signal for. `content-renderer.tsx` excludes `input-block`
 * from its step count for exactly this reason.
 *
 * The runtime authority is `STEP_TYPE_PARSE_KEYS` in
 * `src/components/interactive-tutorial/step-type-registry.ts`. That is tier 4,
 * so this tier-1 module cannot import it; `completion-affordance.parity.test.ts`
 * is the ratchet that keeps the two in step, and it fails when a parse key is
 * added, removed, or remapped.
 *
 * ⚠ TRACKED STEP TYPE REGISTRY — site 3 of 3. See
 * `.cursor/rules/tracked-step-types.mdc`.
 */

import type { JsonBlock } from '../../types/json-guide.types';

/**
 * Block types that always emit completion evidence. One entry per tracked
 * parse key, except `datasource-check-step`, which is an authored shape of
 * `input` rather than a block type of its own — see
 * {@link emitsCompletionEvidence}.
 */
export const COMPLETION_AFFORDANCE_BLOCK_TYPES = [
  'interactive',
  'multistep',
  'guided',
  'quiz',
  'terminal',
  'terminal-connect',
  'code-block',
  'challenge',
] as const satisfies ReadonlyArray<JsonBlock['type']>;

/**
 * Block types that render interactively but emit no completion evidence, so
 * they must never count as completable.
 *
 * `grot-guide` has no parse key at all. `input` is absent from both lists
 * because it is the one conditional case.
 */
export const NON_COMPLETABLE_INTERACTIVE_BLOCK_TYPES = ['grot-guide'] as const satisfies ReadonlyArray<
  JsonBlock['type']
>;

const AFFORDANCE_SET: ReadonlySet<string> = new Set(COMPLETION_AFFORDANCE_BLOCK_TYPES);

/** The fields {@link emitsCompletionEvidence} needs to judge an `input` block. */
export interface CompletionAffordanceBlock {
  type: string;
  inputType?: string;
  dataCheckQuery?: string;
  dataCheckBlocking?: boolean;
}

/**
 * Whether this block can emit evidence that the reader completed it.
 *
 * `input` is tracked in exactly one authored shape: a blocking datasource
 * check, which the parser splits out as `datasource-check-step`. Every other
 * input renders passive, so counting it as completable would inflate the
 * denominator with a block the reader can never satisfy. The condition below
 * mirrors `convertInputBlock` in `src/docs-retrieval/json-parser.ts`.
 */
export function emitsCompletionEvidence(block: CompletionAffordanceBlock): boolean {
  if (AFFORDANCE_SET.has(block.type)) {
    return true;
  }

  return (
    block.type === 'input' &&
    block.inputType === 'datasource' &&
    typeof block.dataCheckQuery === 'string' &&
    block.dataCheckQuery.trim().length > 0 &&
    block.dataCheckBlocking === true
  );
}
