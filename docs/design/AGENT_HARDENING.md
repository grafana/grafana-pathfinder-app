# Agent hardening — phased design

Status: design, not yet planned or implemented. Hand-off document for a future planning agent.

## Purpose

This document captures a prioritized backlog of work to harden the agent-operating layer of this repo — `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/`, `.cursor/skills/`, `CONCERNS.md`, `architecture.test.ts`, hooks, and related infrastructure — so that AI agents can be relied on to move fast inside the codebase without sacrificing quality or guardrails.

It is the output of an architectural audit conducted 2026-05-19 across two parallel investigations (guardrail audit + codebase architectural map) plus a cross-check against an independent second-opinion review. Findings are cited with file paths and line numbers so a future agent can verify before acting.

## Foundational framing

This repo now has **two architectures**:

1. **The product architecture** — the React + TS frontend, Go backend, MCP server, CLI, and so on. Treated as executable truth: tested in CI, ratcheted by `architecture.test.ts`, surfaced in `CONCERNS.md`.
2. **The agent-operating architecture** — `AGENTS.md`, `CLAUDE.md`, the tier model documentation, `.cursor/rules/`, `.cursor/skills/`, the concerns registry, `CONTEXT_INDEX.md`, slash commands, hooks. Currently treated as prose: edited by hand, validated by humans, drifts silently from the product architecture.

**Hardening principle**: drag the agent-operating architecture into the same regime as the product architecture — accurate, versioned, sync-checked, mechanically enforced where possible, measurable where not.

Phases A–E are ordered so each phase makes the next one cheaper:

- **A — Fix the lies**: make the prose accurate. Prerequisite for everything else.
- **B — Mechanical enforcement**: make the prose mandatory. Converts behavioral guardrails (agent must remember to invoke) into harness-fired ones.
- **C — Governance suite + observability**: make the prose measurable. Once enforcement exists, ask: is it effective?
- **D — Threat model + least-agency**: make the prose adversarial-aware. Cover the OWASP/NIST 2026 agent-system threat surface.
- **E — Maturity moves**: make the prose improve over time.

## Verified findings (evidence base)

These findings were verified by reading the cited files. Future agents should re-verify before acting, since fixes may have landed in the interim.

### F-1 Tier numbering is inverted between docs and code

`AGENTS.md` (lines 71–75) and `src/validation/import-graph.ts` (lines 20–40) describe different tier models. Not just different allowlists — different _numbering_ and _tier count_.

| Concept                                                                        | `AGENTS.md` claims     | `import-graph.ts` enforces |
| ------------------------------------------------------------------------------ | ---------------------- | -------------------------- |
| Tier count                                                                     | 4 (0–3)                | 5 (0–4)                    |
| Engines (`context-engine`, `interactive-engine`, etc.)                         | Tier 1                 | Tier 2                     |
| Support (`lib`, `security`, `global-state`, `utils`, `validation`, `recovery`) | Tier 3                 | Tier 1                     |
| `integrations`                                                                 | Listed inside "Tier 3" | Its own Tier 3             |
| `hooks`                                                                        | Listed inside "Tier 3" | Tier 2                     |
| UI (`components`, `pages`)                                                     | Tier 2                 | Tier 4                     |

An agent that reads `AGENTS.md` and reasons about dependencies will form a mental model the ratchet rejects. The ratchet wins, but the agent burns a cycle being wrong, and a human reviewing the PR forms the same wrong mental model.

### F-2 `prevent-doc-drift` references a section that no longer exists in `AGENTS.md`

`.cursor/skills/prevent-doc-drift/SKILL.md:267` instructs the skill to edit a `Subsystem tiers and key relationships` section. The current `AGENTS.md` has `Frontend tier model` (line 70) — no section with the cited name. The skill is editing a target that already moved. Other references in the same skill should also be audited.

### F-3 `CONTEXT_INDEX.md` overstates auto-load behavior in Claude Code

`.cursor/rules/*.mdc` files use YAML frontmatter (`globs:`, `alwaysApply:`) that Cursor honors but Claude Code does not. `CONTEXT_INDEX.md` and `CLAUDE.md` imply rules are auto-triggered by globs. In Claude Code, they are discoverable-only — loaded when something explicitly cites them (typically `pr-review.md`). The papered-over chain works in practice but the doc is wrong about how.

### F-4 F1–F6 security-rule IDs lack cross-file consistency audit

`secure/SKILL.md:65-68` references F1, F3, F4, F5, F6 with specific semantics. `frontend-security.mdc`, `pr-review.md`, and `CONCERNS.md` also reference F-codes. No source-of-truth file is designated; no test asserts the IDs and semantics agree across files. A reviewer agent and a security-skill agent could disagree on what `F2` even is. (Partial verification — full audit is part of A4.)

### F-5 ESLint `no-restricted-imports` manually mirrors `TIER_MAP`

`eslint.config.mjs:1-9` explicitly names `architecture.test.ts` as source of truth, but the rules are hand-maintained. Two sources of truth, one will drift.

### F-6 Root-level `src/` files have no tier enforcement

`src/validation/import-graph.ts:53-58` (in a code comment) acknowledges that root-level files have `topLevelDir=null` and are unconstrained by tier rules. Today only `module.tsx` and `constants.ts` exist there, but an agent dropping `src/helpers.ts` would be silently uncovered.

### F-7 Import-graph analysis covers relative imports only

`import-graph.ts` resolves relative paths. If TS path aliases (`@/foo`, etc.) are introduced, the ratchet does not see them. Latent risk.

### F-8 Refactor skill has a hard runtime dependency on a live wiki

`.cursor/skills/refactor/SKILL.md:26-39` uses `WebFetch` to load guidelines from a wiki at start, and halts with `WIKI_UNREACHABLE` on failure with no cached fallback. Deliberate brittleness — one URL change breaks the entire high-risk refactor flow.

### F-9 `/review` is not mechanically triggered

The concern registry, reviewer fleet, and routing tables in `CONCERNS.md` + `.cursor/rules/pr-review.md` are operationally sound but invocation is by agent cooperation. Husky pre-commit runs prettier only. There is no `Stop` hook, no PR-creation hook, no CI gate that confirms `/review` ran on a diff before merge.

### F-10 `prevent-doc-drift` apply mode has no commit footprint

`maintain-docs` has 13+ merged PRs prefixed `skill:maintain-docs` from 2025-04 through 2026 (verified via `git log`). `prevent-doc-drift` has no equivalent name footprint — strong signal that the apply mode (which is the part designed to edit `AGENTS.md`/`CLAUDE.md` in the same PR) is not actually running.

### F-11 Convergence hotspot inside the tier rules

`src/components/docs-panel/docs-panel.tsx` is 2,681 LOC with 42 imports. It depends on every Tier 1 engine, six `global-state/` singletons, three integrations, and lazy-loads three more heavy components. The tier model has nothing to say about it because all edges point the right direction. Recent commit history shows nearly every feature lands here. The tier ratchet enforces _direction_ of dependencies; it does not enforce _concentration_.

### F-12 Focused Jest runs require `--coverage=false` to pass

`npm run test:ci` applies global coverage thresholds. Running a focused subset can exit non-zero despite all tests passing. Agents misread this as broken tests. Verified: `npm run test:ci -- src/validation/architecture.test.ts src/validation/import-graph.test.ts --coverage=false` passes.

---

## Phase A — Fix the lies

These items correct incorrect statements the agent currently reads as truth. Cheapest possible work; no behavior change in product code; massive correctness gain. Suitable as a single PR.

| id  | item                                       | problem (cite)                       | proposed change                                                                                                                                                                                                                                                    | acceptance criteria                                                                                                                                                              | effort | depends on |
| --- | ------------------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- |
| A1  | Reconcile tier model docs with `TIER_MAP`  | F-1                                  | Pick `import-graph.ts` numbering as canonical (it is the executable truth). Rewrite the tier section in `AGENTS.md` and `CLAUDE.md` to match — same number of tiers, same numbering, same grouping. Update `systemPatterns.mdc` and `CONTEXT_INDEX.md` references. | Tier counts, numbers, and group memberships agree across `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/systemPatterns.mdc`, `docs/developer/CONTEXT_INDEX.md`, and `import-graph.ts`. | 2–4h   | —          |
| A2  | Tier-doc-sync test                         | F-1 will regress without enforcement | Add a test (in `architecture.test.ts` or a new `src/validation/governance.test.ts`) that parses the tier section of `AGENTS.md` and asserts equality with `TIER_MAP`.                                                                                              | Test fails on any tier doc/code divergence. Runs in `npm run test:ci`.                                                                                                           | 1–2h   | A1         |
| A3  | Fix `prevent-doc-drift` section references | F-2                                  | Audit every section name referenced in `prevent-doc-drift/SKILL.md` against current `AGENTS.md`/`CLAUDE.md` headings. Rewrite stale references. Add a sync test (see C4).                                                                                          | All section names referenced in the skill exist in their target docs.                                                                                                            | 2h     | A1         |
| A4  | F-code consistency audit                   | F-4                                  | Cross-reference F1–F6 ID/semantics across `CONCERNS.md`, `frontend-security.mdc`, `pr-review.md`, `secure/SKILL.md`. Designate `CONCERNS.md` as source-of-truth. Other files link rather than restate.                                                             | Each F-code is defined once; all other references match by ID and short summary.                                                                                                 | 3–4h   | —          |
| A5  | Fix `CONTEXT_INDEX.md` auto-load claims    | F-3                                  | Rewrite "auto-triggered by globs" language to "discoverable via — explicitly cited by `pr-review.md`/skill X when context indicates Y". Acknowledge that glob auto-load is Cursor-only.                                                                            | No doc implies Claude Code auto-loads `.mdc` rules. (Optional: add a `UserPromptSubmit` hook in Phase B that does provide auto-load semantics, then update wording again.)       | 2–3h   | —          |

**Suggested commit shape**: one PR, one commit per item, in the order above.

---

## Phase B — Mechanical enforcement

Convert behavioral guardrails (agent has to remember to invoke) into mechanical ones (the harness fires them). Highest leverage on agent slip-rate.

| id  | item                                | problem (cite) | proposed change                                                                                                                                                                                                                                                              | acceptance criteria                                                                                                                                             | effort   | depends on |
| --- | ----------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------- |
| B1  | `Stop`-hook gating `/review`        | F-9            | Add a Claude Code `Stop` hook (settings.json) that detects an uncommitted or unmerged diff and refuses end-of-turn unless `/review` has run on the current diff. Persist last-reviewed diff hash to a `.claude/state/` file.                                                 | When a diff exists and `/review` has not run, end-of-turn is blocked with a clear message. When `/review` ran, end-of-turn proceeds.                            | 1–2 days | —          |
| B2  | `prevent-doc-drift` apply-mode hook | F-10           | Hook fires on the same trigger as B1. Runs `prevent-doc-drift` in apply mode against the diff. Produces edits as part of the PR.                                                                                                                                             | At least one PR demonstrates `prevent-doc-drift` apply-mode edits landing in the same PR as the triggering change.                                              | 1–2 days | A3         |
| B3  | Concentration ratchet               | F-11           | Extend `architecture.test.ts` with metrics-based ratchets: max imports per file, max LOC per Tier-4 file, max engines transitively touched per component, max `global-state` singletons used per file. Seed the allowlist with today's offenders. Allowlist may only shrink. | New violations are blocked. Allowlist entries lack `noExceptionReason` only if they have an issue/PR link. Documented in `architecture.test.ts` header comment. | 1 day    | A1, A2     |
| B4  | Root-level src tier coverage        | F-6            | Assign explicit tiers to entries in `ROOT_LEVEL_ALLOWED_FILES`. Extend `import-graph.ts` to enforce tier rules on root-level files (currently `topLevelDir=null`).                                                                                                           | Adding a new root-level file with an upward import is blocked.                                                                                                  | 2–3h     | A1         |
| B5  | ESLint/`TIER_MAP` sync              | F-5            | Either generate `eslint.config.mjs`'s `no-restricted-imports` from `TIER_MAP` at build time, or add a test that asserts ESLint rules and `TIER_MAP` are in agreement.                                                                                                        | A tier change in `import-graph.ts` either updates ESLint automatically or fails the sync test.                                                                  | 3–4h     | A1, A2     |
| B6  | TS-alias coverage in import graph   | F-7            | Add `tsconfig.paths` resolution to the import scanner in `import-graph.ts`. Add tests using a synthetic aliased import.                                                                                                                                                      | An alias-based upward import is detected as a violation.                                                                                                        | 4–6h     | —          |
| B7  | Tighten husky pre-commit            | F-9            | Extend `.husky/pre-commit` to run `npm run typecheck` and a focused governance test subset (architecture + tier-sync + ESLint sync) in addition to prettier.                                                                                                                 | Pre-commit catches tier and governance regressions locally. Total runtime budget remains under ~30s.                                                            | 2h       | A2, B5     |
| B8  | Fix `--coverage=false` UX           | F-12           | Either default focused Jest runs to no-coverage, or split `npm run test:ci` from a separate `npm run test:coverage`. Document in `AGENTS.md`.                                                                                                                                | An agent running `npm run test:ci -- <focused path>` does not get false-failure from coverage thresholds.                                                       | 2–3h     | —          |

---

## Phase C — Governance suite and observability

Once enforcement is in place, measure effectiveness. This phase makes the agent-operating layer self-validating and answers "are the guardrails working?"

| id  | item                       | problem / motivation                                                                                                                  | proposed change                                                                                                                                                                                                                                                                                                                                                                                | acceptance criteria                                                                                                                                           | effort   | depends on     |
| --- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------- |
| C1  | Repo-governance test suite | The agent-operating layer needs its own test surface, equivalent to `architecture.test.ts` for the product layer.                     | Create `src/validation/governance.test.ts` (or `tests/governance/`) asserting: instruction-file link integrity (every relative link in `AGENTS.md`/`CLAUDE.md` resolves); tier-doc sync (A2); ESLint/`TIER_MAP` sync (B5); F-code consistency (A4); every top-level `src/` dir has a concern entry in `CONCERNS.md`; every skill referenced by `AGENTS.md` exists; focused-test command works. | Suite runs in `npm run test:ci`. Adding a new top-level dir, skill, or rule without updating concerns/AGENTS.md fails the suite.                              | 2–3 days | A2, A3, A4, B5 |
| C2  | Agent-run telemetry        | No signal today on which guardrails are aspirational vs. effective. F-10 was only detectable by reading `git log` for skill prefixes. | Write a JSON-lines file (e.g. `~/.claude/projects/<slug>/telemetry.jsonl`, gitignored) on every skill invocation: skill name, timestamp, diff hash, duration, concerns flagged, tokens consumed (where available). Hook-driven.                                                                                                                                                                | Two weeks of telemetry data shows per-skill invocation counts and per-concern hit rates. A `/telemetry` slash command (or simple script) summarizes the file. | 1–2 days | B1, B2         |
| C3  | `/review` eval suite       | The concern registry has no measured precision/recall. F-4 inconsistencies might be silently affecting review behavior.               | Build a fixture set of synthetic PRs in `tests/agent-evals/` with planted concerns (one R-code, one F-code, one QC-code, one combination, one negative). Add a runner that invokes `/review` on each and scores hits.                                                                                                                                                                          | A scored report (per-concern precision/recall) can be produced on demand. Optional: schedule weekly.                                                          | 2–3 days | A4, B1         |
| C4  | Skill-reference graph test | F-2 is one instance of a class of bug: prose in one file references prose in another that no longer matches.                          | Add a test that walks every skill (`.cursor/skills/*/SKILL.md`) and rule (`.cursor/rules/*.mdc`), extracts referenced files/sections/concerns, and asserts each target resolves.                                                                                                                                                                                                               | A renamed `AGENTS.md` heading or moved doc file fails the test. Added to `npm run test:ci`.                                                                   | 4–6h     | A1, A3         |

---

## Phase D — Threat model and least-agency

Cover the agent-system threat surface as framed by OWASP Agentic Top 10 and the NIST AI Agent Standards Initiative (2026). Specific attack surface for this repo: MCP tools (TS server now, post-#888), `WebFetch`-loaded refactor guidelines, terminal/SSH streaming in `pkg/plugin/stream.go`, agent-authored code reaching a customer-facing plugin.

| id  | item                                    | problem (cite / motivation)                                                                              | proposed change                                                                                                                                                                                                                                                                                                                                                                       | acceptance criteria                                                                                                                                             | effort   | depends on |
| --- | --------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------- |
| D1  | Agent threat model document             | No enumerated threat model for agent operation today.                                                    | Create `docs/design/AGENT_THREATS.md`. Enumerate: tool misuse (MCP tool used destructively); context poisoning (a fetched guide telling the agent to do X); goal hijack (a PR description prompting the reviewer); credential/privilege abuse (terminal/SSH paths in `pkg/`); supply-chain (skill drift, npm); cascading failure across multi-agent chains. Map each to a mitigation. | Document exists, is referenced from `AGENTS.md` "PR reviews" section, and each threat has at least one named mitigation (existing or planned).                  | 1–2 days | —          |
| D2  | Refactor-skill cached-baseline fallback | F-8                                                                                                      | Check in a `.cursor/skills/refactor/wiki-baseline.md` snapshot. Modify the skill to fall back to the snapshot with a staleness warning if `WebFetch` fails. Wiki remains canonical; baseline is fallback.                                                                                                                                                                             | Refactor skill no longer halts on `WIKI_UNREACHABLE`; warns instead.                                                                                            | 4–6h     | —          |
| D3  | MCP tool allowlisting + dry-run         | D1 / OWASP "least agency". MCP server migrated to TS in #888 — natural moment to add policy.             | Categorize MCP tools by blast radius (read / local-write / external-effect). Tools in the external-effect category require explicit confirmation or run in dry-run mode first.                                                                                                                                                                                                        | Each MCP tool declares a blast-radius category. External-effect tools either prompt or dry-run by default. Documented in `docs/design/HOSTED-AUTHORING-MCP.md`. | 1–2 days | D1         |
| D4  | Terminal/SSH session audit log          | `pkg/plugin/stream.go` + `terminal.go` provide SSH-bridged terminal access. OWASP "immutable tool logs". | Add audit logging of session lifecycle (open/close/command-executed) to a tamper-evident sink. Document the audit channel in `docs/developer/CODA.md`.                                                                                                                                                                                                                                | Every terminal session emits open/close events with session id; every executed command is logged at least at the metadata level.                                | 1–2 days | D1         |
| D5  | Skill versioning + checksum             | D1 / supply chain. Skill drift silently changes review behavior across PRs.                              | Add a `version:` field to each `SKILL.md` frontmatter, plus a hash committed alongside. CI verifies hash matches content.                                                                                                                                                                                                                                                             | A modified skill file without a version bump fails CI.                                                                                                          | 4–6h     | C1         |

---

## Phase E — Maturity moves

Lower urgency. Compound over time. Suitable for "tax-the-PR" inclusion (one item per refactor PR) rather than dedicated work.

| id  | item                                          | proposed change                                                                                                                                                                                                                        | acceptance criteria                                                                                                       | effort   | depends on |
| --- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------- | ---------- |
| E1  | Reference-implementation exemplars            | Mark PR #885 (`interactive-section` Tier-A+B extraction) as the canonical decomposition exemplar for components. Add a "compare to" pointer in `.cursor/rules/pr-review.md` for component-size and component-coupling concerns.        | An R-code or QC-code concern explicitly references the exemplar.                                                          | 2–3h     | —          |
| E2  | Cost/token budgets per skill                  | Use C2 telemetry to set per-skill token budgets. Route first-pass triage through Haiku where appropriate; reserve Opus for high-confidence specialist passes.                                                                          | Budgets documented in each `SKILL.md` frontmatter. CI does not enforce but telemetry surfaces outliers.                   | 1 day    | C2         |
| E3  | Decompose `docs-panel.tsx`                    | Drive `src/components/docs-panel/docs-panel.tsx` (2,681 LOC, 42 imports) down using the `interactive-section` template: extract tab-lifecycle, auto-launch wiring, panel-mode coordination, workshop glue into named hooks/components. | File size and import count drop below the ratchet allowlist entries set in B3. The ratchet allowlist shrinks accordingly. | 3–5 days | B3         |
| E4  | Maintain-docs / prevent-doc-drift convergence | Audit whether `maintain-docs` (periodic) and `prevent-doc-drift` (per-PR, B2) overlap. Decide retention of both, or consolidate.                                                                                                       | Each skill has a clearly distinct trigger and output. Or one is retired with redirection.                                 | 4–6h     | B2, C2     |

---

## Recommended sequencing

A future planning agent should produce a phase plan in roughly this order:

1. **PR 1 — "stop lying to the agent"**: A1 + A2 + A3 + A4 + A5. Single PR, single review. No product behavior change. ~1.5 days work, all from prose and one or two test files.
2. **PR 2 — "make the agent do the things it claims to do"**: B1 + B2. ~2–3 days. The largest behavior change in the backlog — every PR after this will have `/review` and `prevent-doc-drift` running mechanically.
3. **PR 3 — "close the ratchet loopholes"**: B3 + B4 + B5 + B6 + B7 + B8. ~3–4 days. Can be split if review burden is high; B3 and B5 are independent.
4. **PR 4 — "make it measurable"**: C1 + C4 first (sync tests), then C2 (telemetry), then C3 (eval suite). ~5–7 days total.
5. **PRs 5–7 — Phase D**: start with D1 (threat model document — informs the rest), then D2 in parallel, then D3 + D4 as resources allow.
6. **Phase E**: opportunistic, no fixed schedule.

After PR 2, the system is dramatically tighter and telemetry will reveal which Phase C and Phase D items are actually load-bearing.

## Out of scope

- Restructuring or splitting the GSD methodology — those skills are external to this repo's primary agent loop.
- Adding new product features.
- Changes to `docs/design/` beyond this file and `AGENT_THREATS.md` (D1).
- Replacing `architecture.test.ts` — the tier ratchet is exemplary; this work _extends_ it.

## Open questions for the planning agent

1. Is there an existing `Stop`-hook implementation pattern in this repo's `.claude/settings.json` to mirror, or is B1 net-new?
2. Should telemetry (C2) be opt-in or always-on? Privacy and noise implications for a multi-developer team.
3. For B3 (concentration ratchet), what are reasonable starting thresholds? Suggest: seed from current 90th-percentile values, ratchet quarterly.
4. For D3 (MCP allowlist), does the post-#888 TS MCP server already have a tool-categorization mechanism, or does this require schema additions?

## Provenance

- Audit conducted 2026-05-19 by Claude Opus 4.7.
- Cross-checked against a second-opinion review from an independent agent the same day; both agents agreed on F-1 (tier mismatch), F-2 (prevent-doc-drift staleness), F-4 (F-code consistency), F-6 (root-level src), F-7 (TS aliases), F-8 (refactor wiki), F-9 (no mechanical `/review`), F-12 (`--coverage=false`). F-3, F-5, F-10, F-11 originated in this audit.
- Findings cite file paths and line numbers from the repo state at commit `aa5908ce` (main branch tip at audit time).
