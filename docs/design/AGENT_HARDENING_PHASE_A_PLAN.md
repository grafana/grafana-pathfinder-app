# Agent hardening — Phase A implementation plan

Branch: `agent-hardening/phase-a`
Source design doc: [`docs/design/AGENT_HARDENING.md`](AGENT_HARDENING.md)
Scope: Phase A only (items A1–A5). Phases B–E are explicitly out of scope.

## Context

`docs/design/AGENT_HARDENING.md` is an architectural audit identifying twelve verified findings (F-1 through F-12) where the agent-operating layer of this repo (`AGENTS.md`, `CLAUDE.md`, `.cursor/rules/`, `.cursor/skills/`, `CONCERNS.md`, …) is out of sync with the code it describes. Phase A targets the five cheapest, highest-correctness items — all of them prose fixes plus one new test — under the banner "stop lying to the agent." The design doc itself recommends Phase A as a single PR before any mechanical-enforcement work begins.

Concrete state captured during exploration (so executors do not re-derive it):

- **Tier numbering is inverted between docs and code.** `src/validation/import-graph.ts:20-40` defines 5 tiers (0–4) with engines at Tier 2, support libs at Tier 1, components/pages at Tier 4. `AGENTS.md:68-75` and `.cursor/rules/systemPatterns.mdc:85-92` describe 4 tiers (0–3) with engines at Tier 1, UI at Tier 2, support at Tier 3. Reconciliation must adopt the code's numbering (it is the executable source of truth).
- **F-code definitions disagree, not just drift.** `frontend-security.mdc:14-155` defines F1=untrusted SVG, F2=safe React bindings, F3=URLs as objects, F4=sanitize HTML, F5=insecure DOM, F6=URL validation. `pr-review.md:240-245` has F1 and F2 swapped (its F1 = "dangerouslySetInnerHTML" matches canonical F4; its F2 = "untrusted SVG" matches canonical F1). `secure/SKILL.md:50-61` aligns with `frontend-security.mdc`. The design doc proposed `CONCERNS.md` as source of truth, but `CONCERNS.md` does not actually define F-codes — it only routes to `frontend-security.mdc`. **This plan designates `frontend-security.mdc` as canonical** since that is what the codebase already treats as authoritative.
- **`prevent-doc-drift` references stale section names.** `.cursor/skills/prevent-doc-drift/SKILL.md:267` mentions "Subsystem tiers and key relationships" — a section name that exists in neither current `AGENTS.md` nor post-A1 `AGENTS.md`. Real AGENTS.md sections are "Frontend tier model" and "Frontend subsystem reference."
- **CONTEXT_INDEX overstates auto-load.** `docs/developer/CONTEXT_INDEX.md:3` says "Many are auto-triggered by glob patterns in `.cursor/rules/*.mdc` frontmatter." In Claude Code this is false — Cursor honors `globs:`/`alwaysApply:`, Claude Code does not. `CLAUDE.md:108` repeats the claim for `frontend-security.mdc`.
- **No tier-doc-sync test exists.** `src/validation/architecture.test.ts` (315 lines) enforces tier rules in code but never reads any `.md`/`.mdc` file. A2's test is net-new but plugs naturally into the existing test file (it already imports `TIER_MAP` and has a "Tier map completeness" describe block at lines 158-198 that is the obvious neighbour for the new test).

## Scope

**In scope (Phase A only):**

- A1 — Reconcile tier model docs with `TIER_MAP`
- A2 — Add tier-doc-sync test
- A3 — Fix `prevent-doc-drift` stale section references
- A4 — F-code consistency audit + cross-file alignment
- A5 — Fix `CONTEXT_INDEX.md` / `CLAUDE.md` auto-load claims

**Out of scope on this branch (deferred to later branches):**

- Phase B mechanical enforcement (Stop hooks, concentration ratchet, ESLint/TIER_MAP sync, alias coverage, husky tightening, `--coverage=false` UX)
- Phase C governance suite + observability
- Phase D threat model + least-agency
- Phase E maturity moves
- Any change to product code under `src/components/`, `src/context-engine/`, etc. (Phase A is documentation + one test only.)

## Execution model and status tracking

Each task block below has a **Status** line. Any agent picking up a task MUST:

1. Set Status to `in-progress (<agent-name>, <YYYY-MM-DD>)` before doing work.
2. Fill in `Files touched`, `Notes`, and any deviations from the plan when work completes.
3. Set Status to `done (<agent-name>, <YYYY-MM-DD>, commit <sha>)` after the commit lands.
4. Update `## Overall progress` at the top of the file.

Sub-checkboxes inside each task are for the executing agent to tick off as they go.

## Overall progress

- [x] Pre-flight (commit AGENT_HARDENING.md + this plan)
- [x] A1 — Reconcile tier model docs
- [ ] A2 — Tier-doc-sync test
- [ ] A3 — Fix prevent-doc-drift section refs
- [ ] A4 — F-code consistency audit
- [ ] A5 — Fix CONTEXT_INDEX auto-load claims
- [ ] Final verification (`npm run check` clean)

---

## Pre-flight — land design doc + plan on branch

**Status:** done (Claude Opus 4.7, 2026-05-20, commit 7507c04b)

**Why first:** The design doc is currently untracked on `main`. Both it and this plan need to be on the branch before tasks A1–A5 run so executors can reference them by path.

**Steps:**

- [x] Copy plan file to `docs/design/AGENT_HARDENING_PHASE_A_PLAN.md`
- [x] `git add docs/design/AGENT_HARDENING.md docs/design/AGENT_HARDENING_PHASE_A_PLAN.md`
- [x] Commit with message: `docs(agent-hardening): add Phase A design doc and implementation plan`
- [x] Record SHA in Notes below

**Files touched:**

- `docs/design/AGENT_HARDENING.md` (new, moved from untracked)
- `docs/design/AGENT_HARDENING_PHASE_A_PLAN.md` (new)

**Notes:**

- Pre-commit hook (lint-staged + prettier) reformatted the markdown to normalize wrapping and spacing. No content changes. Committed in the same SHA.

---

## A1 — Reconcile tier model docs with `TIER_MAP`

**Status:** done (Claude Opus 4.7, 2026-05-20, commit 7a11cb35)
**Effort:** 2–4h
**Depends on:** Pre-flight
**Citation:** F-1 in AGENT_HARDENING.md

**Goal:** `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/systemPatterns.mdc`, and `docs/developer/CONTEXT_INDEX.md` all describe the same tier model that `src/validation/import-graph.ts` enforces.

**Canonical tier model (from `src/validation/import-graph.ts:20-40` — adopt verbatim):**

```
Tier 0 — Types & constants: types, constants
Tier 1 — Support: lib, security, styles, global-state, utils, validation, recovery
Tier 2 — Engines & hooks: context-engine, docs-retrieval, interactive-engine,
         requirements-manager, learning-paths, package-engine, hooks
Tier 3 — Integrations: integrations
Tier 4 — UI: components, pages
```

Plus the excluded set (not tiered, excluded from analysis): `test-utils`, `cli`, `bundled-interactives`, `img`, `locales`.

**Steps:**

- [x] Rewrite `AGENTS.md:68-75` ("Frontend tier model" bullet list) to use 5-tier numbering above
- [x] Update `AGENTS.md:98-133` ("Frontend subsystem reference" section) to label each subsystem with its corrected tier number — AGENTS.md has no such section; the subsystem catalogue lives only in `.cursor/rules/systemPatterns.mdc` (covered by the next step)
- [x] Rewrite `.cursor/rules/systemPatterns.mdc:85-92` to match (currently 4-tier prose, same content shape as AGENTS.md)
- [x] Update `.cursor/rules/systemPatterns.mdc` subsystem reference section (line 133+) tier labels
- [x] Scan `CLAUDE.md` for any tier references (exploration found none, but verify) — none found
- [x] Scan `docs/developer/CONTEXT_INDEX.md` for tier references — none found
- [x] Spot-check `docs/developer/` deep-dives for tier mentions: `engines/`, `utils/README.md`, `constants/README.md`, `learning-paths/README.md` — only hits are content-fetch fallback tiers in `engines/context-engine.md` and an E2E test-attribute tier in `E2E_TESTING_CONTRACT.md`, both unrelated to the import-tier model
- [x] Run `rg -n "Tier [0-3]" --type md AGENTS.md CLAUDE.md docs/ .cursor/rules/` to confirm no stale 4-tier references remain
- [x] Commit: `docs(agent-hardening): reconcile tier model prose with import-graph TIER_MAP (A1)`

**Acceptance criteria:**

- Tier counts, numbers, and group memberships agree across `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/systemPatterns.mdc`, `docs/developer/CONTEXT_INDEX.md`, and `src/validation/import-graph.ts`.
- `npm run test:ci -- src/validation/architecture.test.ts --coverage=false` still passes (this task does not touch test code).

**Files touched:**

- `AGENTS.md` — rewrote the "Frontend tier model" bullet list (lines 68–78) to the 5-tier model and added an "Excluded from tier analysis" line plus pointer to `TIER_MAP`.
- `.cursor/rules/systemPatterns.mdc` — rewrote the tier-model bullet list (lines 85–95) and reorganized the "Frontend subsystem reference" section (lines 96–135): every subsystem now lives under the correct tier header, `hooks` moves up to Tier 2 with the engines, `integrations` gets its own Tier 3 block, and `test-utils`/`cli`/`bundled-interactives`/`locales`/`img` are split into a clearly-labeled "Excluded from tier analysis" group.

**Notes:**

- AGENTS.md does not contain a "Frontend subsystem reference" section (the per-subsystem catalogue lives only in `.cursor/rules/systemPatterns.mdc`). The plan's step referencing `AGENTS.md:98-133` was a misread of the file; the equivalent edits landed in `systemPatterns.mdc` instead. Noted in the step checkbox.
- `CLAUDE.md` and `docs/developer/CONTEXT_INDEX.md` have no tier-number references — left untouched.
- `docs/developer/engines/context-engine.md` mentions "Tier 1/2/3" but those refer to the content-fetch fallback strategy (external recommender → bundled → static links), not the import-graph tier model — left untouched.
- `docs/developer/E2E_TESTING_CONTRACT.md:259` mentions "Tier 2 attribute" referring to E2E selector attribute classification — unrelated to import tiers, left untouched.
- `docs/history/package-implementation-record.md` already uses the correct 5-tier numbering (it was written after `validation` was moved to Tier 1) — left untouched.
- The pre-commit hook (lint-staged + prettier) ran but produced no changes for the two edited files.
- `AGENTS.md` has a "Key dependency edges" table listing `recovery → requirements-manager`. Under the new tier model, recovery (Tier 1) cannot import from requirements-manager (Tier 2). Verified via `rg`: `src/recovery/` only imports from `types/` (Tier 0), so the table entry describes a conceptual recovery-vs-requirements relationship rather than an actual code-level edge. The architecture test still passes. Leaving as-is — clarifying that table is outside A1's scope and the test wouldn't catch it; flag for a future cleanup pass if desired.
- Verification: `npm run test:ci -- src/validation/architecture.test.ts --coverage=false` passed (7/7 tests, ratchet still `vertical=4 lateral=9 barrel=0`).

---

## A2 — Tier-doc-sync test

**Status:** not-started
**Effort:** 1–2h
**Depends on:** A1
**Citation:** F-1 prevention (so A1 cannot regress)

**Goal:** A test that parses the tier prose in `AGENTS.md` and `.cursor/rules/systemPatterns.mdc` and fails if it disagrees with `TIER_MAP`.

**Decision: extend `src/validation/architecture.test.ts` rather than creating a new `governance.test.ts`.** Rationale: the existing file already imports `TIER_MAP` and has a "Tier map completeness" `describe` block at lines 158-198 — the new test is the natural cousin. Creating a separate file duplicates Jest config wiring for one test.

**Implementation sketch:**

- Add a new `describe('Tier documentation sync', ...)` block after line 314.
- Read `AGENTS.md` and `.cursor/rules/systemPatterns.mdc` via `fs.readFileSync`.
- Parse the tier bullet list out of each file with a regex anchored to the section heading. Be tolerant of formatting (extra whitespace, backticks around dir names).
- Assert: every entry in `TIER_MAP` appears in each doc with the matching tier number; no doc lists a directory that is not in `TIER_MAP`.
- Provide a clear failure message naming the divergent directory and the two tier values.

**Steps:**

- [ ] Draft the parser (small, regex-based, no new deps)
- [ ] Add the describe block in `src/validation/architecture.test.ts`
- [ ] Confirm the test passes against post-A1 docs
- [ ] Confirm the test fails if you temporarily flip a tier in `AGENTS.md` (manual sanity check; revert)
- [ ] Run `npm run test:ci -- src/validation/architecture.test.ts --coverage=false`
- [ ] Commit: `test(validation): assert tier docs stay in sync with TIER_MAP (A2)`

**Acceptance criteria:**

- Test runs as part of `npm run test:ci`.
- Test fails on any tier doc/code divergence with a clear message.
- No new npm dependencies added.

**Files touched:**

**Notes:**

---

## A3 — Fix `prevent-doc-drift` stale section references

**Status:** not-started
**Effort:** 2h
**Depends on:** A1 (so updated section content can be referenced if needed)
**Citation:** F-2

**Goal:** Every section name referenced in `.cursor/skills/prevent-doc-drift/SKILL.md` exists in its target doc.

**Known stale reference (from exploration):**

- Line 267: `AGENTS.md "Subsystem tiers and key relationships"` — should be `AGENTS.md "Frontend tier model"` (for tier-list adjustments) or `AGENTS.md "Frontend subsystem reference"` (for per-subsystem entries). Decide which fits the example context.
- Line 267: "Tier-1 list" wording — after A1 lands, the new tier-1 entries are `lib`, `security`, `styles`, `global-state`, `utils`, `validation`, `recovery`. Engines are now Tier-2. Update the example accordingly.

**Steps:**

- [ ] Walk the entire `prevent-doc-drift/SKILL.md` (319 lines) and extract every quoted section reference (e.g., `"Code organization"`, `"Frontend subsystem reference"`, `"On-demand context"`, `"HTTP resource API"`, etc.)
- [ ] For each reference, `grep` the target doc(s) for the section heading; flag mismatches
- [ ] Rewrite mismatches; update examples whose "Detected updates" outputs reference the now-corrected tier numbers from A1
- [ ] Cross-check that example PRs in the skill still type-check against the rules table at lines 79-101
- [ ] Commit: `docs(prevent-doc-drift): align section references and tier examples with current docs (A3)`

**Acceptance criteria:**

- Every section name referenced in `prevent-doc-drift/SKILL.md` resolves to an existing heading in its target file.
- Example outputs (Example 1, 2, 3 in the skill) reflect the post-A1 tier numbering.

**Files touched:**

**Notes:**

---

## A4 — F-code consistency audit + alignment

**Status:** not-started
**Effort:** 3–4h
**Depends on:** —
**Citation:** F-4

**Goal:** F1–F6 have a single canonical definition; all other references either cite the canonical file by path or use matching IDs and one-line summaries.

**Canonical source: `.cursor/rules/frontend-security.mdc`** (deviation from design-doc note; rationale in Context section above — `CONCERNS.md` does not define F-codes, only routes to them; `frontend-security.mdc` is what the codebase already treats as canonical with Do/Don't examples and remediation patterns).

**Canonical numbering (from `frontend-security.mdc:14-155`):**

| ID  | Title                        | Lines   |
| --- | ---------------------------- | ------- |
| F1  | Avoid Untrusted SVGs         | 14–31   |
| F2  | Use Safe React Data Bindings | 35–50   |
| F3  | Don't Treat URLs as Strings  | 54–91   |
| F4  | Sanitize HTML and URLs       | 95–121  |
| F5  | Avoid Insecure DOM APIs      | 124–148 |
| F6  | Global URL & Link Validation | 152–155 |

**Known divergence to fix:**

- `.cursor/rules/pr-review.md:240-245` — F1 and F2 are swapped relative to canonical (and F3–F6 may also drift). Detection-table entries must match canonical IDs.
- `.cursor/skills/secure/SKILL.md:50-61` — already aligned; verify and leave alone.
- `docs/design/CONCERNS.md` — does not redefine F-codes today. Should add a one-line pointer ("F-codes are defined in `.cursor/rules/frontend-security.mdc`") for discoverability.

**Steps:**

- [ ] Re-read `frontend-security.mdc` and confirm the table above
- [ ] Rewrite `.cursor/rules/pr-review.md:240-245` detection table so F1–F6 match canonical IDs and short summaries
- [ ] Verify `.cursor/skills/secure/SKILL.md:50-61` against canonical; fix any drift
- [ ] Add a one-line pointer to `frontend-security.mdc` in `docs/design/CONCERNS.md` near the `security` concern entry (do not redefine F-codes there)
- [ ] `rg -n 'F[1-6]\b' --type md .cursor/ docs/` and confirm every hit either lives in `frontend-security.mdc` or matches its IDs
- [ ] Commit: `docs(security): align F-code IDs across pr-review, secure skill, and CONCERNS (A4)`

**Acceptance criteria:**

- Each of F1–F6 has exactly one definition site (`frontend-security.mdc`).
- All other references match by ID and short summary.
- `rg -n 'F[1-6]\b'` shows no contradictions.

**Files touched:**

**Notes:**

---

## A5 — Fix `CONTEXT_INDEX.md` / `CLAUDE.md` auto-load claims

**Status:** not-started
**Effort:** 2–3h
**Depends on:** —
**Citation:** F-3

**Goal:** No doc implies Claude Code auto-loads `.cursor/rules/*.mdc` files by glob. Cursor-specific behavior is called out as such.

**Known false claims to fix:**

- `docs/developer/CONTEXT_INDEX.md:3` — "Many are auto-triggered by glob patterns in `.cursor/rules/*.mdc` frontmatter; the rest are loaded by name."
- `CLAUDE.md:108` — "`.cursor/rules/frontend-security.mdc` — frontend security F1-F6 (auto-triggered on `*.ts`/`*.tsx`/`*.js`/`*.jsx`)"
- The "Auto-triggered by globs" column in `CONTEXT_INDEX.md` tables (`tracked-step-types.mdc`, `schema-coupling.mdc`, `frontend-security.mdc`, `testingStrategy.mdc`, `coda.mdc`) — these claims describe Cursor behavior, not Claude Code behavior.

**Rewrite strategy:**

- Preamble (`CONTEXT_INDEX.md:3-5`): replace "auto-triggered by glob patterns" with explicit "In Cursor, many `.mdc` files auto-load via `globs:` frontmatter. In Claude Code, these are discoverable-only — load them by name when working in the relevant domain. The 'Auto-triggered by globs' column documents the Cursor behavior for cross-tool reference."
- Per-row entries can keep the globs column (useful information) but the preamble must make clear it is Cursor-only metadata.
- `CLAUDE.md:108`: replace "auto-triggered on …" with "load when working in `*.ts`/`*.tsx`/`*.js`/`*.jsx` files".

**Steps:**

- [ ] Rewrite preamble at `CONTEXT_INDEX.md:3-5`
- [ ] Rewrite the table column header or add a note explaining the column is Cursor metadata
- [ ] Rewrite `CLAUDE.md:108` (frontend-security entry)
- [ ] `rg -n 'auto-triggered|auto-load|alwaysApply' --type md AGENTS.md CLAUDE.md docs/ .cursor/` and audit each hit
- [ ] Commit: `docs(context-index): clarify that .mdc glob auto-load is Cursor-only, not Claude Code (A5)`

**Acceptance criteria:**

- No doc implies Claude Code auto-loads `.mdc` rules by glob.
- The actual cross-tool behavior (Cursor: glob auto-load; Claude Code: explicit citation) is documented.

**Files touched:**

**Notes:**

---

## Final verification

**Status:** not-started
**Depends on:** A1–A5 all done

**Steps:**

- [ ] `npm run check` passes (typecheck + lint + prettier + lint:go + test:go + test:ci)
- [ ] `git log --oneline main..HEAD` shows the expected commit shape (pre-flight + 5 task commits + optional plan-update commit)
- [ ] `## Overall progress` checklist above is fully ticked
- [ ] Plan file's `Files touched` and `Notes` sections are filled in for every task
- [ ] Branch ready for PR (PR creation itself is out of scope for this branch — that comes later)

## Critical files reference

Quick lookup for executors:

| Purpose                         | Path                                                        |
| ------------------------------- | ----------------------------------------------------------- |
| Canonical tier definitions      | `src/validation/import-graph.ts:20-40`                      |
| Tier prose to rewrite (primary) | `AGENTS.md:68-92`, `.cursor/rules/systemPatterns.mdc:85-92` |
| Test harness to extend          | `src/validation/architecture.test.ts:158-314`               |
| Skill with stale section refs   | `.cursor/skills/prevent-doc-drift/SKILL.md:79-101, 264-268` |
| F-code canonical definitions    | `.cursor/rules/frontend-security.mdc:14-155`                |
| F-code swap to fix              | `.cursor/rules/pr-review.md:240-245`                        |
| F-code consistency check        | `.cursor/skills/secure/SKILL.md:50-61`                      |
| Auto-load false claims          | `docs/developer/CONTEXT_INDEX.md:3-5`, `CLAUDE.md:108`      |
| Design doc (source)             | `docs/design/AGENT_HARDENING.md`                            |
