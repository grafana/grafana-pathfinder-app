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

/**
 * Floor-raising signal fired when a `reftarget` field is written. Targets
 * the failure mode in hardening doc issue #3 ("agents invent selectors
 * because the CLI can't tell verified from invented and the runtime no-ops
 * silently"). The signal is intentionally soft — the CLI does not have the
 * ground truth needed to convert this into a validation error, so this
 * lives on `warnings[]` instead. Pairs with the description-hardening on
 * `reftarget` fields (task 7) and the layer-3 / layer-2 "never invent
 * selectors" rules (tasks 2 / 5).
 *
 * `path` is a free-form locator string (e.g. `blocks[2]/reftarget`,
 * `blocks[2].steps[0]/reftarget`, `<id>/reftarget`) describing where the
 * write landed in the artifact, so a reviewer can grep for the warning and
 * find the field without re-parsing.
 */
export function unverifiedSelectorWarning(path: string): OutcomeWarning {
  return {
    code: 'UNVERIFIED_SELECTOR',
    message:
      'reftarget set without verification. The CLI cannot confirm a selector matches the live Grafana DOM — confirm against a running Grafana instance before publishing. A wrong selector silently breaks the guide at runtime; the validator cannot catch this.',
    path,
  };
}

/**
 * Internal predicate: a value is a "non-empty selector" when it is a string
 * with at least one non-whitespace character. Centralized so the three
 * `runX` consumers all decide the same way.
 */
export function isNonEmptySelector(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
