---
name: refactor
description: Execute high-risk refactors of large or intertwined components per the High-Risk Refactor Guidelines wiki — investigation, phased planning, and atomic-commit execution with subagent fan-out and worktree isolation. Use when the user invokes /refactor-investigate, /refactor-plan, or /refactor-execute, or asks to refactor a large component, split a complex hook, decompose a singleton, extract from a monolith, or otherwise restructure intertwined code.
---

# Refactor

High-risk refactors orchestrated through three independently-callable commands. All guideline content lives in the [High-Risk Refactor Guidelines wiki](https://github.com/grafana/grafana-pathfinder-app/wiki/High-Risk-Refactor-Guidelines) — this skill references it live; no content is duplicated here.

## Usage

```
/refactor-investigate <target>   # Investigate the target and produce INVESTIGATION.md
/refactor-plan                   # Read INVESTIGATION.md and produce PLAN.md
/refactor-execute                # Execute PLAN.md with atomic commits and LOG.md
```

Each command is callable independently. If called out of order, halt and tell the user which command to run first.

## Subagent context

All subagent prompt templates live in **`.cursor/skills/refactor/SUBAGENTS.md`**. Read that file before spawning any subagent, then pass only the relevant section into the subagent prompt. Do NOT paste SUBAGENTS.md content into the main conversation context.

## Wiki referencing

**Every command begins with a `WebFetch`** of:

```
https://github.com/grafana/grafana-pathfinder-app/wiki/High-Risk-Refactor-Guidelines
```

Extract only the sections relevant to the current command (e.g., the pattern descriptions for the confirmed patterns, or the hard-gate list for execute). Pass those sections verbatim as `{{WIKI_SECTION}}` into subagent prompts.

If `WebFetch` fails, halt immediately with:

> `WIKI_UNREACHABLE — start the refactor only when the wiki is reachable, since this skill defers all guideline content to it.`

No stale fallback. No caching to disk.

## State files

```
worktree/.refactor/
├── INVESTIGATION.md     # protocol level, inventories, confirmed patterns
├── PLAN.md              # phase table, per-phase tests, tripwires, decisions
└── LOG.md               # short execution log: findings, decisions, deviations
```

These files are gitignored (`.refactor/` in `.gitignore`). The only committed artifact is the curated SUMMARY.md written on landing (see Command 3).

---

## Command 1: `/refactor-investigate <target>`

### Step 1 — Worktree setup

Check `git worktree list` for existing `pathfinder-refactor-*` worktrees and surface them. If none matches, create:

```
git worktree add ../pathfinder-refactor-<slug> -b refactor/<slug>
```

Switch to the worktree. Create `.refactor/` directory.

### Step 2 — Wiki fetch

`WebFetch` the wiki (see above). Extract: risk classification criteria, pattern definitions A–K, and conditional inventory trigger rules.

### Step 3 — Risk router (inline, no subagent)

Count files in blast radius, check `src/validation/import-graph.ts` tier for target, scan target source for signals:

| Signal                                                 | Pattern hint                             |
| ------------------------------------------------------ | ---------------------------------------- |
| `setTimeout` / `setInterval` / `requestAnimationFrame` | Pattern F (timing)                       |
| `Map<` / `Set<` / `CustomEvent`                        | Pattern G/J (event/contract)             |
| `data-test` attributes                                 | Contract surface — conditional inventory |
| `localStorage`                                         | Storage contract — Pattern J             |
| top-level `await`                                      | Pattern K (bootstrap)                    |
| root-level file                                        | Pattern K                                |

Propose protocol level — **just-do-it / lightweight / full** — with one-line evidence per signal. Present to user for confirmation before proceeding.

### Step 4 — Investigation fan-out

Read SUBAGENTS.md. Spawn parallel Explore subagents using the templates for each:

| Subagent                   | When                                                     |
| -------------------------- | -------------------------------------------------------- |
| Consumer Map               | Always                                                   |
| Internal Dep Chain         | Always                                                   |
| Tier Audit                 | Always                                                   |
| Contract Surface Inventory | Pattern J/K signals or `data-test` / `localStorage` hits |
| Timing Contract Inventory  | Pattern F signals (`setTimeout`, `rAF`, etc.)            |
| Cross-System Invariant Map | Pattern G/J signals (`CustomEvent`, `Map<`, `Set<`)      |
| Startup Timeline           | Pattern K signals (root-level file, top-level `await`)   |

Each subagent receives: `{{TARGET_FILE}}`, `{{WIKI_SECTION}}` (relevant portion), and any pattern-specific fields from SUBAGENTS.md. Each returns a structured report under 300 words — never code.

### Step 5 — Combine into INVESTIGATION.md

Write `.refactor/INVESTIGATION.md` with:

- Protocol level and evidence summary
- One section per completed subagent report
- Blank sections for any skipped conditional inventories (note why skipped)

### Step 6 — Pattern Selector

Read SUBAGENTS.md and spawn the **Pattern Selector** Explore subagent. It reads INVESTIGATION.md and proposes the top 1–2 patterns from A–K with evidence from the inventories.

Present the pattern proposal to the user for confirmation in chat. Append the confirmed selection to INVESTIGATION.md.

---

## Command 2: `/refactor-plan`

### Step 1 — Guard

Read `.refactor/INVESTIGATION.md`. If missing:

> `INVESTIGATION.md not found — run /refactor-investigate <target> first.`

### Step 2 — Wiki fetch

`WebFetch` the wiki. Extract the sections for the confirmed patterns and the "Seam tripwires" section.

### Step 3 — Phase ordering

Propose phase order (low → medium → high risk) with one-line rationale per phase. Present to user for confirmation before spawning subagents.

### Step 4 — Per-phase parallel subagents

For **each phase**, spawn two subagents in parallel using SUBAGENTS.md templates:

- **Pre-test design** (Plan) — disposable contract/smoke tests that prove the pre-extraction behavior
- **Tripwire enumeration** (Explore) — finds existing tests and identifies seam tripwires per the wiki's "Seam tripwires" section

### Step 5 — Decision register

Surface cross-cutting decisions the user must resolve before Phase 1 begins:

- Mocking strategy for extracted module
- Import style (barrel vs. direct)
- Interface changes (new types vs. inline)
- Consumer migration timing (in-phase vs. post-phase)

Write these as an open decision register in PLAN.md. User must resolve each one in chat before execute begins.

### Step 6 — Write PLAN.md

Write `.refactor/PLAN.md` containing:

- Phase table (phase N, scope, risk level, rationale)
- Per-phase: pre-test plan, extraction scope, post-test plan, tripwire list
- Hard-gate triggers specific to this refactor (derived from wiki + target signals)
- Decision register (resolved before execute)
- Rollback triggers (domain-specific invariants from the invariant inventories)

---

## Command 3: `/refactor-execute`

### Step 1 — Guard

Read `.refactor/PLAN.md`. If missing:

> `PLAN.md not found — run /refactor-plan first.`

Confirm the decision register is fully resolved. If any decision is open, list the unresolved items and halt.

### Step 2 — Phase 0 baseline

Capture baseline metrics before any code changes:

```
npm run typecheck
npm run test:ci      # record pass count and wall time
npm run build
```

Append to `.refactor/LOG.md`:

```
## Phase 0 — Baseline
- typecheck: pass
- test:ci: N tests, Xs
- build: pass
- timestamp: <ISO>
```

### Step 3 — Execute phases

For each phase in order:

**3a. Backup branch (high-risk phases only)**

```
git branch refactor-<slug>-pre-phase-N
```

**3b. Wiki fetch (once per phase)**
`WebFetch` wiki. Extract section for this phase's pattern.

**3c. Pre-test commit**

- Spawn **Pattern Extraction Guide** Explore subagent (SUBAGENTS.md) to confirm the extraction approach before writing code.
- Write the pre-test (disposable contract/smoke test proving current behavior).
- Run it: `npx jest <test-file> --no-coverage` — must pass against current code.
- Commit: `test: pre-extraction contract for <phase scope>`

**3d. Extract commit**

- Perform the extraction. One atomic commit per logical move.
- Commit: `refactor: extract <X> from <source>`
- No feature changes. No formatting changes. No unrelated file edits.

**3e. Post-test commit**

- Write permanent unit tests for the new module.
- Run: `npx jest <test-file> --no-coverage` — must pass.
- Commit: `test: unit tests for extracted <X>`

**3f. Checkpoint**

```
npm run prettier && npm run typecheck && npm run lint && npm run test:ci -- <slice>
```

Run full `npm run test:ci` once per phase. Run `npm run e2e` after orchestration, storage, event, or bootstrap changes.

**3g. Hard-gate check** (see below — halt if any gate trips)

**3h. LOG.md entry**
Append to `.refactor/LOG.md`:

```
## Phase N — <scope>
- Approach: <one line>
- Tripwires triggered: <list or none>
- Deviations: <list or none>
- Anomalies: <list or none>
- Gate overrides: <list or none>
```

### Step 4 — Consumer migration

For each consumer being migrated, spawn a **Consumer Pre-Survey** Explore subagent (SUBAGENTS.md) scoped to that call site before touching the file. The main agent only loads the consumer it is actively touching.

### Step 5 — On landing

When all phases pass and `npm run check` + `npm run e2e` are clean:

1. **Synthesize** `docs/developer/refactors/<slug>/SUMMARY.md` from INVESTIGATION.md, PLAN.md, and LOG.md. This is a curated summary — not a concatenation:
   - Target and motivation
   - Patterns used and why
   - Phase outline (one line per phase)
   - Tripwires that paid off
   - Surprises encountered
   - Candidate wiki improvements (patterns, gates, or heuristics that should be updated)

2. Commit: `docs: refactor summary for <slug>`

3. Offer next steps:
   - `push` — push branch and open a PR
   - `merge` — rebase onto main and merge locally
   - `cleanup` — remove worktree (`git worktree remove ../pathfinder-refactor-<slug>`)
   - `status` — list all active refactor worktrees

---

## Hard-gate enforcement

Halt and ask the user when any of the following trips:

| Gate                        | Trigger                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| Test suite failure          | `npm run test:ci` fails at any checkpoint                                                |
| Compile failure             | TypeScript no longer compiles                                                            |
| Architecture violation      | New `ALLOWED_VERTICAL_VIOLATIONS` / `ALLOWED_LATERAL_VIOLATIONS` entry would be required |
| Bootstrap contamination     | Root-level file gains a new import                                                       |
| Untested seam               | A high-risk seam has no tripwire                                                         |
| Repeated extraction failure | Same extraction fails twice with different implementations                               |
| Order change                | Cleanup order, startup order, or async interleaving changes                              |
| Contract mutation           | Contract surface changes name, payload, storage key, or fallback order                   |
| Consumer behavior change    | Consumer-visible behavior must change                                                    |

**User responses:**

- `fix` — return to extraction with a new approach; LOG.md gets the failed-attempt entry
- `--override <reason>` — proceed; reason recorded in LOG.md with timestamp
- Anything else — halt indefinitely

No silent overrides.

---

## Subagent strategy

| Subagent                   | Phase                            | Type    | Thoroughness | Source       |
| -------------------------- | -------------------------------- | ------- | ------------ | ------------ |
| Consumer Map               | Investigate                      | Explore | medium       | SUBAGENTS.md |
| Internal Dep Chain         | Investigate                      | Explore | medium       | SUBAGENTS.md |
| Tier Audit                 | Investigate                      | Explore | quick        | SUBAGENTS.md |
| Contract Surface Inventory | Investigate (conditional)        | Explore | medium       | SUBAGENTS.md |
| Timing Contract Inventory  | Investigate (conditional)        | Explore | medium       | SUBAGENTS.md |
| Cross-System Invariant Map | Investigate (conditional)        | Explore | medium       | SUBAGENTS.md |
| Startup Timeline           | Investigate (conditional)        | Explore | medium       | SUBAGENTS.md |
| Pattern Selector           | Investigate (after fan-out)      | Explore | quick        | SUBAGENTS.md |
| Pre-test design            | Plan (per phase, parallel)       | Plan    | n/a          | SUBAGENTS.md |
| Tripwire enumeration       | Plan (per phase, parallel)       | Explore | medium       | SUBAGENTS.md |
| Consumer Pre-Survey        | Execute (per consumer, parallel) | Explore | quick        | SUBAGENTS.md |
| Pattern Extraction Guide   | Execute (per phase)              | Explore | quick        | SUBAGENTS.md |

---

## Hard constraints

1. **NEVER skip the per-phase pre/extract/post-test sandwich.**
2. **NEVER modify existing test assertions** during the refactor (exceptions per wiki).
3. **NEVER batch unrelated structural moves** into one commit.
4. **ALWAYS use a worktree**, one per refactor target.
5. **ALWAYS halt on hard gates**; require explicit `--override <reason>`.
6. **ALWAYS `WebFetch` the wiki** at the start of each command — never operate from cached content.
7. **ALWAYS produce the SUMMARY.md** leave-behind on landing.
