/**
 * Soft-feedback warnings emitted by the authoring CLI's `runX` functions
 * (M2 — see [`docs/design/MCP-AGENT-UX-HARDENING.md`](../../../docs/design/MCP-AGENT-UX-HARDENING.md)).
 *
 * Warnings ride on `SuccessOutcome.warnings`; they do not fail the call.
 * Centralizing the constructors here keeps codes consistent between the CLI
 * and the MCP `outcomeResult` passthrough, and gives future hardening slices
 * a single place to add new codes without grepping through every runner.
 *
 * **Registry of codes** (extend in lockstep with `docs/developer/MCP_SERVER.md`):
 *
 * - `MULTISTEP_COMPOSITION_HINT` — emitted by `runAddBlock` when a multistep
 *   block is appended. Soft nudge toward separate sibling blocks for loose
 *   sequences (hardening doc issue #8).
 * - `UNVERIFIED_SELECTOR` — emitted by `runAddBlock` / `runAddStep` /
 *   `runEditBlock` whenever a non-empty `reftarget` is written. The CLI
 *   cannot verify selectors against the live Grafana DOM, so this is a
 *   floor-raising signal, not a validation pass (hardening doc issue #3).
 *   _Added in task 8._
 */

import type { OutcomeWarning } from './output';

/**
 * Composition nudge fired when an agent adds a `multistep` block. Targets
 * the failure mode in hardening doc issue #8 ("agents default to multistep
 * and noop without warrant"): agents reach for `multistep` as the
 * least-effort container; this warning pairs with the
 * `compositionRules` surface in `pathfinder_authoring_start` to push them
 * toward separate sibling blocks when the steps are loose.
 */
export function multistepCompositionHint(): OutcomeWarning {
  return {
    code: 'MULTISTEP_COMPOSITION_HINT',
    message:
      'multistep is for tightly-coupled ordered steps. Prefer separate sibling blocks for loose sequences, and never write `action: noop` steps as filler — write a markdown block instead.',
  };
}
