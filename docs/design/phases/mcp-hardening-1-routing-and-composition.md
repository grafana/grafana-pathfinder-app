# MCP hardening, slice 1 — routing, composition, and selector discipline

> Hardening follow-up to [P3 — TypeScript MCP server](./ai-authoring-3-ts-mcp.md).
> Source design: [MCP-AGENT-UX-HARDENING.md](../MCP-AGENT-UX-HARDENING.md).
> Scope: issues **#3, #7, #8** + cross-cutting mechanisms **M1** (three-layer hint surface) and **M2** (structured `warnings[]`).
> Branch: `mcp-hardening-routing-and-composition`.
> Tracking issue: _to be filed_.

**Status:** Complete
**Started:** 2026-05-12
**Completed:** 2026-05-12

---

## Goal

When an MCP-aware agent (Grafana Assistant, Claude Desktop, Cursor, Claude Code) connects to `pathfinder-cli mcp`, three things become true that aren't true today:

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
- [ ] `pathfinder-cli mcp` stdio + HTTP transports work against current `main` (smoke: `npx pathfinder-cli mcp --help`, MCP Inspector connect).
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
- [x] **4. `triggers` + `_start` description.** ✓ _Complete (2026-05-12)._ Added `triggers: string[]` (sourced from `PATHFINDER_TRIGGER_PHRASES`) and `notFor: string[]` (sourced from `PATHFINDER_NOT_FOR`) to `AUTHORING_CONTEXT` in `authoring-start.ts`. Tool description was already use-case-led from task 3 — task 4 is just the payload field addition. Same `agent-routing.ts` constants now feed three places: layer 3 (`server-instructions.ts`), layer 2 (this `_start` payload), and the lib-level unit tests in `server-instructions.test.ts`. Decision logged below promotes OQ6 from "proposed" to resolved. New test in `server.test.ts` asserts both fields appear and contain the canonical anchor phrase. 97 MCP tests pass (+2 new).

### Issue #8 — composition opinionation

- [x] **5. Distilled `compositionRules` in `_start`.** ✓ _Complete (2026-05-12)._ Added `compositionRules: string[]` to `AUTHORING_CONTEXT` with **11 distilled rules** sourced from `grafana/interactive-tutorials` `.cursor/authoring-guide.mdc` (fetched via `gh api`). The three load-bearing anchors from the slice plan are present (multistep-vs-sibling, no-noop-filler, never-invent-reftarget); the other 8 cover single-step multistep collapse, section vs. markdown headings, on-page anchoring, generous requirements, `verify` on state changes, prose discipline, button-text-over-selector, and lazy-render guidance. Comfortably under the 15-rule target — 25-rule ceiling left intact as headroom. Test in `server.test.ts` guards the rule count (≥3, ≤20), presence of all three load-bearing anchors, and budget headroom. OQ7 promoted to a resolved decision-log entry. 98 MCP tests pass (+1 new).
- [x] **6. `MULTISTEP_COMPOSITION_HINT` warning.** ✓ _Complete (2026-05-12)._ `runAddBlock` (`src/cli/commands/add-block.ts`) now appends a `MULTISTEP_COMPOSITION_HINT` warning to its outcome when `args.type === 'multistep'` AND the append actually happened (no warning on idempotent `--if-absent` no-ops). The warning constructor lives in **`src/cli/utils/warnings.ts`** (new shared module), positioned as the registry for every soft-feedback code in the slice — task 8 will add `UNVERIFIED_SELECTOR` to the same module. Message also incorporates the noop-as-filler anti-pattern from `compositionRules` so it's a one-line nudge covering both failure modes. Three unit tests in `commands.test.ts` (positive case, other-types negative, idempotent no-op negative) + one MCP-level integration test in `server.test.ts` confirming the warning surfaces verbatim through `outcomeResult` end-to-end. 368 CLI tests pass.

### Issue #3 — selector discipline

- [x] **7. Sharpen `reftarget` field descriptions.** ✓ _Complete (2026-05-12)._ Tightened `.describe()` text on all 4 `reftarget` sites in `src/types/json-guide.schema.ts`. The two structurally-identical step/interactive sites share the canonical text from the plan (selector + "do NOT invent" + (a)/(b)/(c) alternatives + "validator cannot catch this"). The two specialized sites (code-block targeting Monaco, conditional styling hook) adapt the canonical pattern but keep the discipline (`do NOT invent or guess` + `validator cannot catch this`) — the suggested alternatives differ because "use `action: button`" isn't applicable for non-button targets. No callers grep on description text; CLI / type tests stay green.
- [x] **8. `UNVERIFIED_SELECTOR` warning on writes.** ✓ _Complete (2026-05-12)._ Three runners now emit a soft `UNVERIFIED_SELECTOR` warning whenever a non-empty `reftarget` is written: `runAddBlock` (path `<position>/reftarget`, e.g. `blocks[0]/reftarget`), `runAddStep` (path `<position>/reftarget`, e.g. `blocks[0].steps[2]/reftarget`), and `runEditBlock` (path `<id:X>/reftarget`, anchored on the block id because edits don't have positional addresses). Helper + shared `isNonEmptySelector` predicate live in `src/cli/utils/warnings.ts`. The edit-block warning fires only when `'reftarget'` is in the `changed` set — content-only edits on a block with a pre-existing reftarget do NOT re-arm the warning (the original write was the moment of risk). 7 new unit tests in `commands.test.ts` (positive + noop-negative + unchanged-negative across all three runners) + 1 new MCP-end integration test in `server.test.ts` confirming the warning surfaces through `outcomeResult` end-to-end. 376 CLI tests pass.

### Docs + cross-cutting

- [x] **9. Integration tests.** ✓ _Complete (2026-05-12)._ New dedicated test file `src/cli/mcp/__tests__/hardening-flow.test.ts` walks the canonical agent flow (`_start` → `create_package` → `add_block(markdown)` → `add_block(multistep)` → `add_step(reftarget=…)`) and asserts every hardening surface fires at the right layer: layer 3 (`getInstructions()`), layer 2 (`_start.triggers` + `_start.compositionRules`), outcome-time `MULTISTEP_COMPOSITION_HINT` on the multistep add, outcome-time `UNVERIFIED_SELECTOR` on the step add with `reftarget`. Also includes a markdown-control assertion to confirm the warning channel doesn't false-fire on unrelated calls. The focused per-surface tests in `server.test.ts` / `commands.test.ts` remain; this file is the composition guard.
- [x] **10. Update `docs/developer/MCP_SERVER.md`.** ✓ _Complete (2026-05-12)._ Added two new sections under "Tool surface": **Server-level instructions** describes the layer-3 handshake surface, summarizes what the string covers (routing / `reftarget` discipline / composition), and points at the 30-line ceiling enforced by the unit test. **Outcome warnings** documents the `warnings[]` shape on success responses, includes a code registry table (`MULTISTEP_COMPOSITION_HINT`, `UNVERIFIED_SELECTOR`) with emitting runner and meaning, and clarifies that warnings are never errors and never trigger retry. Prettier reformatted the docs table.
- [x] **11. Update `docs/design/MCP-AGENT-UX-HARDENING.md`.** ✓ _Complete (2026-05-12)._ Added a `**Status (2026-05-12).**` annotation to each of issues #3, #7, and #8 naming the slice and summarizing what landed for each. Updated OQ4, OQ6, and OQ7 with `_Resolved 2026-05-12 (slice 1)._` prefixes pointing at this slice's decision log. Replaced the empty Decision log section with a slice-1 summary entry that cross-references the per-issue status notes and lists the deferred items (M4 catalog, #1/#2/#4/#5, Assistant-team rollout coordination).

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

### 2026-05-12 — OQ6: trigger vocabulary source — hand-curated, single-source in `agent-routing.ts`

- **Decision:** The starter vocabulary lives in `src/cli/mcp/lib/agent-routing.ts` as four exported readonly arrays (phrases, verbs, nouns, anti-routing). Three consumers read from it: `lib/server-instructions.ts` (layer 3), `tools/authoring-start.ts` (layer 2), and `lib/__tests__/server-instructions.test.ts` (regression guard). The starter list itself is curated from the 2026-05-08 Grafana Assistant session in hardening-doc issue #7.
- **Alternatives considered:** Generate from production telemetry once it exists; co-own with the Assistant team via a tracked vocabulary doc; inline the strings directly at each call site.
- **Rationale:** Production telemetry doesn't exist yet, so generated-from-data is premature. Cross-team ownership has coordination cost we don't need to pay until rollout. Inlining at call sites is the failure mode this file exists to prevent — layer 2 and layer 3 must stay in sync. Single-source-then-evolve is the cheapest correct path until telemetry can drive evolution.
- **Touches:** `src/cli/mcp/lib/agent-routing.ts`, `src/cli/mcp/lib/server-instructions.ts`, `src/cli/mcp/tools/authoring-start.ts`.

### 2026-05-12 — OQ7: best-practices distillation — inline in `_start.compositionRules`

- **Decision:** Distilled 11 rules inline in `AUTHORING_CONTEXT.compositionRules`, sourced from `grafana/interactive-tutorials` `.cursor/authoring-guide.mdc`. Comfortably under the 15-rule target.
- **Alternatives considered:** Separate `pathfinder_authoring_best_practices` tool (on-demand fetch); bulk-inline the upstream guide; per-block-type hints only.
- **Rationale:** The upstream guide is ~300 lines; the cost of getting the agent to the right composition shape early is paid once per session, but the costs of bad composition (noop multisteps, invented selectors, missing requirements) compound across every hop. Inline rules also pair cleanly with the layer-3 server `instructions` so the three load-bearing rules (#3 selectors, #8 multistep, #8 noop) appear in both surfaces — agents see them before tool selection AND when they call `_start`. The separate-tool escape hatch is still preserved in code comments above the constant; trigger to revisit is a 20-rule cap on the inline list.
- **Touches:** `src/cli/mcp/tools/authoring-start.ts`.

---

## Deviations

_Empty at draft._

---

## Handoff to next phase

- **M2 `warnings[]` is now the canonical place for soft hints.** `SuccessOutcome.warnings: OutcomeWarning[]` is wired end-to-end (CLI text + JSON, MCP `outcomeResult` passthrough). Next slice's `ARTIFACT_MUTATED` (#1) and YouTube auto-normalize feedback (#2) plug in here without further plumbing — just add a constructor to `src/cli/utils/warnings.ts` and the code registry table in `docs/developer/MCP_SERVER.md`.
- **M1 layer 3 is load-bearing.** `buildServer` passes `instructions` through `ServerOptions`; extending the string is a single edit in `src/cli/mcp/lib/server-instructions.ts`. A unit test enforces a 30-line ceiling; if you want to add a 4th rule, weigh against moving content to `_start` (paid once per session, not every connect) first.
- **Trigger vocabulary single-sourced in `agent-routing.ts`.** Four readonly arrays (phrases, verbs, nouns, anti-routing) consumed by both `server-instructions.ts` (layer 3) and `tools/authoring-start.ts` (layer 2). Extend; don't rewrite. The 2026-05-08 Grafana Assistant session in hardening-doc issue #7 is the canonical reference.
- **`compositionRules` length budget informally enforced at 15 rules; hard ceiling 20.** Ships at 11. The escape hatch for further growth (separate `pathfinder_authoring_best_practices` tool) is documented above the constant in `authoring-start.ts`. Triggering it requires a deliberate decision; default is to keep inline.
- **Selector catalog (M4) deferred.** Still hinges on OQ3 (catalog source of truth). Until then, the `UNVERIFIED_SELECTOR` warning is the floor — agents that write a reftarget get a soft signal even though the CLI cannot verify it. Issue #3 closed at the four-layer-reinforcement bar; selector catalog would raise the floor further by making the right thing easy.
- **Edit-block warning path uses `<id:X>/reftarget` form**, distinct from add-block / add-step which use `<position>/reftarget`. Anchored on the block id because edits don't have positional addresses. Reviewers grepping for the warning need to expect both shapes.
- **Hardening doc statuses updated.** Issues #3 / #7 / #8 in `docs/design/MCP-AGENT-UX-HARDENING.md` now carry **Status (2026-05-12)** annotations and OQ4/OQ6/OQ7 are marked resolved. Decision rationale lives in this slice's decision log; the hardening doc points back here rather than duplicating content.
- **8 atomic commits prefixed `MCP-HARDEN-1:`.** `git log --grep 'MCP-HARDEN-1'` is the audit trail.
- **376 CLI tests pass.** The composition guard at `src/cli/mcp/__tests__/hardening-flow.test.ts` is the smoke test for this slice — drive that test if you change any hint surface.
