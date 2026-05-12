# MCP hardening, slice 1 — routing, composition, and selector discipline

> Hardening follow-up to [P3 — TypeScript MCP server](./ai-authoring-3-ts-mcp.md).
> Source design: [MCP-AGENT-UX-HARDENING.md](../MCP-AGENT-UX-HARDENING.md).
> Scope: issues **#3, #7, #8** + cross-cutting mechanisms **M1** (three-layer hint surface) and **M2** (structured `warnings[]`).
> Branch: `mcp-hardening-routing-and-composition`.
> Tracking issue: _to be filed_.

**Status:** In progress
**Started:** 2026-05-12
**Completed:** _YYYY-MM-DD_

---

## Goal

When an MCP-aware agent (Grafana Assistant, Claude Desktop, Cursor, Claude Code) connects to `pathfinder-mcp`, three things become true that aren't true today:

1. **It can find us.** Server-level `instructions` and use-case-led tool descriptions tell the agent _when_ to reach for Pathfinder — closing the routing gap in issue #7 ("agents don't reach for Pathfinder MCP without explicit prompt vocabulary").
2. **It composes well.** `pathfinder_authoring_start` carries a distilled `compositionRules` section, and `pathfinder_add_block` emits soft type-aware warnings — closing the "everything is a multistep of noops" pattern in issue #8.
3. **It stops inventing selectors.** Every mutation that writes a `reftarget` gets an `UNVERIFIED_SELECTOR` warning, the field description hardens, and the server `instructions` reach the model before tool selection — closing the silently-broken-at-runtime failure in issue #3.

The cross-cutting plumbing (M1 layers 1+3, M2 `warnings[]`) is built once in this slice and is what lets a follow-up slice address #1, #2, and #4 cheaply.

**Out of scope (deferred to a later slice):**

- **M4 — selector catalog tool (`pathfinder_lookup_selector`).** Requires answering OQ3 (catalog source of truth). The description-time + outcome-time + server-instruction mitigations in this slice raise the floor without it.
- **Issue #1 — artifact ETag.** Independent fix; lands cleanly on top of M2 once it exists.
- **Issue #2 — YouTube URL normalization.** Independent; M3 plumbing not in this slice.
- **Issue #4 — step / choice block ids.** Schema-shape change; deserves its own design pass (OQ2).
- **Issue #5 — hop-over-hop growth.** Tracked in P5 GCS-sessions entry.
- **Best-practices as a separate tool (OQ7 alt).** This slice picks "inline in `_start`"; revisit only if the inline grows past a context-budget threshold.

---

## Preconditions

**Prior-phase exit criteria to re-verify before starting:**

- [ ] `npm run check` clean on `main`.
- [ ] `pathfinder-mcp` stdio + HTTP transports work against current `main` (smoke: `npx pathfinder-mcp --help`, MCP Inspector connect).
- [ ] Deployed Cloud Run instance reachable (so we can verify deployed behavior at exit — see [#6 runbook](../MCP-AGENT-UX-HARDENING.md#6-deployment--log-inspection-discoverability-for-future-agents) in `docs/developer/MCP_SERVER.md` once it lands).

**Surface area this phase touches:**

| File                                                                                           | Change                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/cli/utils/output.ts`                                                                      | Add `warnings?: Array<{ code, message, path? }>` to `SuccessOutcome`; render warnings in text + JSON formatters. **CLI contract change — additive, backwards-compatible.**         |
| `src/cli/mcp/tools/result.ts`                                                                  | `outcomeResult` already passes `outcome` verbatim; verify warnings flow through unchanged.                                                                                         |
| `src/cli/mcp/server.ts`                                                                        | Pass `instructions` to `new McpServer(...)`. New constant module for the instructions text.                                                                                        |
| `src/cli/mcp/tools/authoring-start.ts`                                                         | Add `triggers` + `compositionRules` to `AUTHORING_CONTEXT`. Reword `description` to lead with use case.                                                                            |
| `src/cli/mcp/tools/mutation-tools.ts`                                                          | Reword `description` on every `registerTool` to lead with use case (#7).                                                                                                           |
| `src/cli/mcp/tools/finalize.ts`                                                                | Same reword pass.                                                                                                                                                                  |
| `src/cli/mcp/tools/help.ts`, `inspection-tools.ts`, `artifact-tools.ts`, `repository-tools.ts` | Same reword pass.                                                                                                                                                                  |
| `src/cli/commands/add-block.ts`, `add-step.ts`, `edit-block.ts`                                | Emit `UNVERIFIED_SELECTOR` warning whenever a non-empty `reftarget` is written (issue #3). Emit `MULTISTEP_COMPOSITION_HINT` warning when a `multistep` block is added (issue #8). |
| `src/types/json-guide.schema.ts`                                                               | Tighten `.describe()` on every `reftarget` field (lines 115, 240, 473, 670).                                                                                                       |
| `docs/developer/MCP_SERVER.md`                                                                 | Document `warnings[]` shape, `UNVERIFIED_SELECTOR` and `MULTISTEP_COMPOSITION_HINT` codes, server `instructions` rationale.                                                        |
| `docs/design/MCP-AGENT-UX-HARDENING.md`                                                        | Update issues #3, #7, #8 with "Status: addressed in slice 1" + decision-log entries.                                                                                               |

**Public APIs that change:**

- `CommandOutcome.SuccessOutcome` gains optional `warnings`. CLI users see warnings in `--format json` and in text output. No existing call sites break.
- MCP `initialize` handshake response gains a non-empty `instructions` string (was missing). All compliant clients render it; non-compliant ones ignore it.

**Open questions to resolve during execution:**

- **OQ4 (warnings[] visibility):** Decision proposed here — surface in both CLI text output (compact line per warning) and `--format json` payload. CLI users benefit, contract change is additive. Confirm during task 1 review.
- **OQ6 (canonical trigger vocabulary):** This slice ships a starter list curated from observed agent prompts. Marked as "evolves with telemetry" in the doc — not a blocker. Source list goes in `src/cli/mcp/lib/agent-routing.ts` (new file).
- **OQ7 (best-practices distillation strategy):** Decision proposed — inline a curated subset in `pathfinder_authoring_start`. Revisit if context budget pressure appears.

---

## Tasks

Atomic-commit-sized. Reference slice ID in commit messages (`MCP-HARDEN-1: ...`).

### Plumbing (M1 + M2)

- [x] **1. M2 — `warnings[]` on `SuccessOutcome`.** ✓ _Complete (2026-05-12)._ Added `OutcomeWarning` type and `warnings?: OutcomeWarning[]` on `SuccessOutcome` in `src/cli/utils/output.ts`. Text renderer emits a `Warnings:` block (between `text` and `hints`) with one bullet per entry, format `CODE (path): message`. JSON renderer surfaces verbatim via the existing `JSON.stringify(outcome)` path (no extra code needed). Quiet mode suppresses warnings to preserve the one-line invariant; JSON mode still carries them. 5 new unit tests in `src/cli/__tests__/output.test.ts` (352 CLI tests pass).
- [x] **2. M1 layer 3 — server `instructions` wiring.** ✓ _Complete (2026-05-12)._ Two new modules under `src/cli/mcp/lib/`: `agent-routing.ts` (single-source trigger vocabulary — phrases, verbs, nouns, anti-routing) and `server-instructions.ts` (composes `SERVER_INSTRUCTIONS` from the routing constants + selector-discipline + composition-opinionation rules). Wired through `buildServer` (`src/cli/mcp/server.ts`) via `ServerOptions.instructions`. Two test files: integration test in `__tests__/server.test.ts` asserts `client.getInstructions()` returns non-empty and contains key anchors (`pathfinder_authoring_start`, `reftarget`, `multistep`, `noop`, `create a pathfinder`); unit test in `lib/__tests__/server-instructions.test.ts` guards the constants module against regressions (trigger list non-empty, line count ≤ 30, all three rule anchors present). 8 new tests across both files; 95 MCP tests pass.

### Issue #7 — routing

- [x] **3. Use-case-led tool descriptions.** ✓ _Complete (2026-05-12)._ Rewrote `description` on all 16 `registerTool` calls across 7 files (`authoring-start.ts`, `help.ts`, `inspection-tools.ts`, `artifact-tools.ts`, `finalize.ts`, `mutation-tools.ts`, `repository-tools.ts`). Authoring/repository tools lead with _"Use this tool when the user wants to …"_; meta-introspection tools (`pathfinder_help`, `pathfinder_inspect`, `pathfinder_validate`) lead with _"Use this when you need to …"_ Added a regression test in `server.test.ts` that grep-checks every registered tool description for the use-case-led opener via `/^Use this (tool )?(when|to)\b/i`. 13 server tests pass.
- [ ] **4. `triggers` + `_start` description.** Add `triggers: string[]` to `AUTHORING_CONTEXT` in `authoring-start.ts` listing the starter vocabulary from `agent-routing.ts` (e.g. `"create a pathfinder"`, `"write a tutorial"`, `"build a walkthrough"`, `"interactive guide"`, `"step-by-step"`). Reword the `pathfinder_authoring_start` tool description to lead with use case. _Same starter list seeds the server `instructions` from task 2 — single source._

### Issue #8 — composition opinionation

- [ ] **5. Distilled `compositionRules` in `_start`.** Add a `compositionRules: string[]` field to `AUTHORING_CONTEXT`. Source: `grafana/interactive-tutorials` `.cursor/authoring-guide.mdc` (fetch, curate, do not bulk inline). Minimum rules to include:
  - _"Prefer separate sibling blocks over a `multistep` block. Use `multistep` only when the steps must be completed in order and are tightly coupled."_
  - _"Never write a step with `action: noop` as filler. If there is nothing concrete for the user to do, write a markdown block describing what they would do instead."_
  - _"If you do not have a verified Grafana DOM selector for a `reftarget` field, do NOT write a step that requires one. Write a markdown block, use a `button` action with visible text matching, or ask the user."_
  - 3–5 more curated from upstream — total length ~15 lines max. **Distillation discipline is the load-bearing part of this task.** If the rule list exceeds ~25 lines, stop and propose the separate-tool variant from OQ7 instead.
- [ ] **6. `MULTISTEP_COMPOSITION_HINT` warning.** In `runAddBlock` (`src/cli/commands/add-block.ts`), when `type === 'multistep'`, append a warning to the outcome: `{ code: 'MULTISTEP_COMPOSITION_HINT', message: 'multistep is for tightly-coupled ordered steps. Prefer separate sibling blocks for loose sequences.' }`. Unit test: snapshot the outcome for an `add-block --type multistep` call and assert the warning is present.

### Issue #3 — selector discipline

- [ ] **7. Sharpen `reftarget` field descriptions.** Update `.describe()` text on every `reftarget` field in `src/types/json-guide.schema.ts` (4 occurrences at lines 115, 240, 473, 670). New text: _"Verified Grafana DOM selector. Do NOT invent or guess. If you do not have explicit knowledge of the selector, write a markdown block describing the action, use a `button` action with visible text, or ask the user. A wrong selector silently breaks the guide at runtime — the validator cannot catch this."_
- [ ] **8. `UNVERIFIED_SELECTOR` warning on writes.** In `runAddBlock`, `runAddStep`, and `runEditBlock`, after the mutation succeeds, inspect the written `flagValues` for a non-empty `reftarget`. If present, append `{ code: 'UNVERIFIED_SELECTOR', message: 'reftarget set without verification. Confirm against the live Grafana DOM before publishing.', path: '<block-path>/reftarget' }` to the outcome's `warnings[]`. Helper goes in `src/cli/utils/warnings.ts` (new file) so future warnings have a home. Unit tests per runner.

### Docs + cross-cutting

- [ ] **9. Integration tests.** Add to `src/cli/mcp/__tests__/` an end-to-end test that drives the MCP through `_start` → `create_package` → `add_block(markdown)` → `add_block(multistep)` → `add_step(reftarget=…)` and asserts: (a) `_start` payload contains `triggers` and `compositionRules`; (b) `add_block(multistep)` outcome contains `MULTISTEP_COMPOSITION_HINT`; (c) `add_step` with `reftarget` contains `UNVERIFIED_SELECTOR`; (d) MCP `initialize` response includes server `instructions`.
- [ ] **10. Update `docs/developer/MCP_SERVER.md`.** Add a "Warnings" section documenting the shape, the two codes shipped in this slice, and how clients should render them. Add a "Server instructions" section noting layer-3 hint surface and what it contains.
- [ ] **11. Update `docs/design/MCP-AGENT-UX-HARDENING.md`.** For issues #3, #7, #8: append "**Status (YYYY-MM-DD):** addressed in [slice 1](./phases/mcp-hardening-1-routing-and-composition.md)." Append decision-log entries with the OQ4/OQ6/OQ7 resolutions chosen here.

### Test plan

- **Unit:** `printOutcome` rendering with and without `warnings`; JSON-mode warnings round-trip; `agent-routing.ts` constants stable across import; `runAddBlock` warning emission for multistep and reftarget; `buildServer` produces an `McpServer` with non-empty `instructions`.
- **Integration:** End-to-end MCP exercise per task 9.
- **Manual:** Connect MCP Inspector to a local stdio run. Verify `initialize` response carries `instructions`. Drive `pathfinder_authoring_start` and confirm `triggers` + `compositionRules` appear.
- **Deployed verification:** Push to Cloud Run, drive through a real Grafana Assistant session, query Cloud Run logs for occurrences of `MULTISTEP_COMPOSITION_HINT` and `UNVERIFIED_SELECTOR` warning codes.
- **Reviewer commands:** `npm run check` (typecheck + lint + prettier + Go + tests), `npm run test:ci`.

### Verification (matches goal restated as checkboxes)

- [ ] MCP `initialize` response includes a non-empty `instructions` string. (Test + manual MCP Inspector verification.)
- [ ] Every `registerTool` description starts with _"Use this tool when…"_ or equivalent use-case framing.
- [ ] `pathfinder_authoring_start` payload contains `triggers` and `compositionRules` arrays.
- [ ] `pathfinder_add_block` with `type === 'multistep'` returns an outcome containing a `MULTISTEP_COMPOSITION_HINT` warning.
- [ ] `pathfinder_add_block` / `add_step` / `edit_block` writing a non-empty `reftarget` returns an outcome containing an `UNVERIFIED_SELECTOR` warning.
- [ ] `CommandOutcome` `warnings[]` is rendered in both `--format text` and `--format json` CLI output.
- [ ] `docs/developer/MCP_SERVER.md` documents the `warnings[]` shape and the two codes shipped here.
- [ ] `docs/design/MCP-AGENT-UX-HARDENING.md` issues #3, #7, #8 carry a "Status: addressed in slice 1" annotation.
- [ ] `npm run check` clean.

---

## Decision log

### 2026-05-12 — OQ4: `warnings[]` visibility — CLI + MCP, not MCP-only

- **Decision:** `warnings` are rendered in both CLI text output (between `text` and `hints`, suppressed in `--quiet`) and `--format json` payload. MCP layer surfaces verbatim via the existing `outcomeResult` path — no transformation.
- **Alternatives considered:** MCP-only (CLI users never see them); CLI text-only with no JSON exposure (would force MCP callers to render their own).
- **Rationale:** Additive to `SuccessOutcome`, no existing caller breaks. Single source of truth for the warning text. Quiet-mode users (one-line agent flows) still get the structured data via JSON if they care.
- **Touches:** `src/cli/utils/output.ts`, `src/cli/__tests__/output.test.ts`.

### Proposed at draft — to confirm or revise when their tasks land

- **OQ6 — trigger vocabulary source:** Hand-curated starter list in `src/cli/mcp/lib/agent-routing.ts`. Rationale: production telemetry doesn't exist yet; curated starter list is good enough for first rollout, evolves later with real prompts. Confirm at task 2 / task 4.
- **OQ7 — best-practices distillation:** Inline in `_start.compositionRules`, capped at ~15 lines. Rationale: cheaper to maintain than a separate tool; context budget is small at this scale. Revisit if list grows past ~25 lines (escape hatch: ship `pathfinder_authoring_best_practices` returning on-demand). Confirm at task 5.

---

## Deviations

_Empty at draft._

---

## Handoff to next phase

_Fill at exit. Anchor the next hardening slice (#1 ETag / #2 YouTube / #4 step ids) to what this slice now provides:_

- _M1 layer 3 is now load-bearing — next slice can extend the `SERVER_INSTRUCTIONS` text without redesigning the wiring._
- _M2 `warnings[]` is now the canonical place for soft hints — next slice's `ARTIFACT_MUTATED` (#1) and YouTube auto-normalize feedback (#2) plug in here._
- _Trigger vocabulary lives in `agent-routing.ts` — extend, don't rewrite, when telemetry suggests new terms._
- _`compositionRules` length budget enforced informally at ~15 lines — if next slice wants to add rules, weigh against the separate-tool escape hatch from OQ7._
- _Selector catalog (M4) is still deferred; the `UNVERIFIED_SELECTOR` warning is the floor until OQ3 is answered._
