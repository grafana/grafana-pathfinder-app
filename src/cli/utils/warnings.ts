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
 * - `PLACEHOLDER_SELECTOR` — emitted by `pathfinder_finalize_for_app_platform`
 *   for every `reftarget` still holding a `TODO-` placeholder selector.
 * - `SECTION_STEP_LIST` — emitted by `runAddBlock` / `runEditBlock` when a
 *   `markdown` block directly inside a `section` starts with a list marker;
 *   the section numbers its children, so the list renders double-numbered.
 * - `INPUT_NORMALIZED` — emitted by `runAddBlock` / `runEditBlock` (and
 *   future siblings) whenever the CLI rewrites a user-supplied input into
 *   its canonical form (M3 — see `src/cli/utils/input-normalizers.ts`).
 *   First consumer: YouTube watch / short / shorts URLs converted to
 *   embed form (hardening doc issue #2). Teach-on-write — the agent
 *   sees what got rewritten so it learns the canonical form for next
 *   time, instead of round-tripping through a validation failure.
 */

import type { OutcomeWarning } from './output';
import { readJsonGuideAliasedField } from '../../types/json-guide-aliases';
import { CONTAINER_CHILD_KEYS, CONTAINER_NON_BLOCK_CHILD_KEYS } from './package-io/tree';

const PLACEHOLDER_SELECTOR_PATTERN = /data-testid=["']?TODO-/;

export function placeholderSelectorWarnings(blocks: unknown, prefix = 'blocks'): OutcomeWarning[] {
  if (!Array.isArray(blocks)) {
    return [];
  }
  return blocks.flatMap((node: unknown, i): OutcomeWarning[] => {
    if (typeof node !== 'object' || node === null) {
      return [];
    }
    const record = node as Record<string, unknown>;
    const path = `${prefix}[${i}]`;
    const reftarget = readJsonGuideAliasedField(record, 'reftarget');
    const own: OutcomeWarning[] =
      typeof reftarget === 'string' && PLACEHOLDER_SELECTOR_PATTERN.test(reftarget)
        ? [
            {
              code: 'PLACEHOLDER_SELECTOR',
              message:
                'Placeholder selector. This step will not run until it gets a verified selector (Pick in the block editor). Tell the user.',
              path: `${path}/reftarget`,
            },
          ]
        : [];
    const type = String(record.type);
    const childKeys = [...(CONTAINER_CHILD_KEYS[type] ?? []), ...(CONTAINER_NON_BLOCK_CHILD_KEYS[type] ?? [])];
    return [...own, ...childKeys.flatMap((key) => placeholderSelectorWarnings(record[key], `${path}.${key}`))];
  });
}

/**
 * Composition nudge fired when an agent adds a `multistep` block. Targets
 * the failure mode in hardening doc issue #8 ("agents default to multistep
 * and noop without warrant"): agents reach for `multistep` as the
 * least-effort container; this warning pairs with the
 * `interactiveRules` surface in `pathfinder_authoring_start` to push them
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

const LIST_MARKER_PATTERN = /^\s*(\d+[.)]|[-*+])\s/;

export function startsWithListMarker(content: unknown): boolean {
  if (typeof content !== 'string') {
    return false;
  }
  const firstLine = content.split('\n').find((line) => line.trim().length > 0);
  return firstLine !== undefined && LIST_MARKER_PATTERN.test(firstLine);
}

export function sectionStepListWarning(path: string): OutcomeWarning {
  return {
    code: 'SECTION_STEP_LIST',
    message:
      'Sections number their children. Write this step as plain sentences with no list, one step per `markdown` block; a list here renders double-numbered.',
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

/**
 * Teach-on-write signal fired when the CLI rewrites a user-supplied input
 * into its canonical form (M3 — see `input-normalizers.ts`). Pair with the
 * normalized value being persisted: the agent sees what changed (so it
 * learns the canonical form for next time) and the call succeeds in one
 * round-trip instead of two.
 *
 * `field` is the dotted field name (e.g. `src`); `from` and `to` are the
 * original and rewritten values, included verbatim so a reviewer can grep
 * for either form.
 */
export function inputNormalizedWarning(field: string, from: string, to: string): OutcomeWarning {
  return {
    code: 'INPUT_NORMALIZED',
    message: `${field} normalized: \`${from}\` → \`${to}\`. The CLI accepts both forms; use the canonical form (right-hand side) next time to avoid the round-trip.`,
    path: field,
  };
}
