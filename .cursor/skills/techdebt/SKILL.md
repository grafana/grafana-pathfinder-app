---
name: techdebt
description: 'Locate technical debt in a subsystem or architectural component of a codebase. Use when the user runs `/techdebt <subsystem>` or asks to audit a module for smells, duplication, prop drilling, dead code, or other debt patterns. Examples: "/techdebt src/auth", "find tech debt in components/docs-panel", "audit the interactive-engine for smells".'
---

# techdebt — Locate Technical Debt in a Subsystem

Confidence-tiered audit. Disqualifiers are hard filters, not soft considerations — they are what keeps the skill useful rather than noisy.

## When to Use

Triggered by `/techdebt <subsystem>`, by phrases like "find tech debt in X" / "audit Y for smells", as pre-refactor due diligence, or as a sub-agent from `/review` against a PR's changed files. **Requires a concrete target** — if the user gives none, ask for one; do not audit the whole repo.

## Invocation

```
/techdebt <subsystem>                    # all categories, high-confidence only
/techdebt <subsystem> --category A       # one category
/techdebt <subsystem> --category A,B     # subset
/techdebt <subsystem> --pattern B1       # single pattern
/techdebt <subsystem> --suggestive       # also emit suggestive-tier findings
```

Categories:

- **A** — Local syntactic (A1–A5). Single-file, fast.
- **B** — Cross-file structural / corpus similarity (B1–B4). Slowest — agent acts as similarity judge.
- **C** — Delegation and architectural / graph-level (C1–C5). Uses import graph + churn.
- **D** — Process debt (D1 Stale Memory Drift, D2 Test-Generation Debt).
- **E** — Operational debt / extraction seams (E1–E6). High-risk refactor targets: imperative resource managers, async state machines, singletons, module-level registries, contract-surface scatter, bootstrap orchestration. Each E finding is scoped small enough to act on in one session.

## Workflow

1. **Resolve target** → concrete file set. Accept directory, glob, or named subsystem (consult repo's `AGENTS.md` / architecture docs if the term is symbolic). Print resolved file count before continuing.
2. **Build inventory** in one pass:
   - File list with LOC
   - Exported symbols per file
   - Per-file churn: `git log --since="90 days ago" --pretty=format:"%H" -- <file> | wc -l`
   - Project dependencies: read `package.json` (for B3)
3. **Load [`PATTERNS.md`](PATTERNS.md)** from this skill directory. Re-read every invocation — do not rely on memory.
4. **Run each pattern** against the inventory:
   - **Category A**: read each file; scan for the signature.
   - **Category B**: agent is the similarity engine. Normalize bodies (strip imports, JSX scaffolding, comments) before comparing. Emit the explicit similarity claim in `Evidence` so it can be audited.
   - **Category C**: build a minimal import graph via `grep -rn "from ['\"]" <subsystem>`. Use `git log` for churn (C3). For C5, use distinct PR history from the contract-evolution gate when the target maps to a concern; never substitute directory-level commit counts.
   - **Category D**: D1 diffs `CLAUDE.md` / `AGENTS.md` / `.cursor/rules/` docs against current code; D2 reads test files and counts meaningful assertions.
   - **Category E**: targeted grep + read. E1 looks for paired resource APIs (`setInterval`/`addEventListener`/`*Observer`) with cleanup distance; E2 looks for `AbortController` + debounce + retry in the same function; E3 looks for `export const … = new X()` then traces importers; E4 looks for top-level `let` / `new Map()` / `new Set()` outside any function; E5 looks for repeated string literals matching CustomEvent / storage / testid / query-param patterns; E6 inspects the project's designated entry-point file(s).
5. **Check disqualifiers BEFORE emitting**. For every candidate hit, walk the pattern's disqualifier list. If any matches → drop the candidate. If a disqualifier cannot be verified, demote to **suggestive**. Never emit high-confidence with an unchecked disqualifier. The `Disqualifiers checked` field on each finding is the audit trail.
6. **Emit findings** grouped by confidence tier, ordered by hotspot score (`churn_90d × pattern_severity`) within each tier. Cap output at **10 high-confidence findings**; if more exist, emit a trailing `## Additional candidates (truncated)` line with counts per pattern ID. Prefer not-flagging when uncertain — false positives erode trust faster than missed findings.

## Confidence Tiers

- **High** — signature matched AND all disqualifiers ruled out. Default emit.
- **Suggestive** — signature partially matched, OR one or more disqualifiers couldn't be verified. Emit only with `--suggestive`.

## Output Format

Group findings by tier (High first, then Suggestive if requested). Within each tier, order by hotspot score descending.

### Per finding

```markdown
### [Pattern ID] — [pattern name]

- **Confidence**: high | suggestive
- **Locations**:
  - `path/to/file.ts:12-34` — `symbolName`
  - `path/to/other.ts:8-29` — `otherSymbol`
- **Evidence**: One paragraph: what was observed and why it matches the signature. For B-category, include the explicit similarity claim and what convinced you.
- **Disqualifiers checked**:
  - Not generated code (no `**/*.generated.*` match)
  - Functions have semantically distinct names — flagged anyway because behavior is identical
- **Hotspot**: churn 12 commits/90d (top 8%) — prioritize
- **Suggested action**: One or two sentences. Concrete: "Extract X into Y", "Replace with `lodash/debounce`", "Hoist this prop to context".
```

### Patterns with no findings

End the report with a compact line, **not** per-pattern sections:

```markdown
## No evidence found

A1, A3, A5 · B2, B4 · C1, C4 · D1
```

Do not spend output explaining what wasn't found.

### When nothing is found at all

> No tech debt found above the confidence threshold in `<subsystem>`. Run with `--suggestive` to include lower-confidence candidates.

## Example header

```
Resolved → <N> files, <LOC> LOC in <subsystem>
Inventory:
  - <N> exported symbols
  - Hottest files (90d): <file> (<commits>), …
  - Deps relevant to B3: <library list from package.json>
Running A1–E6…

High-confidence findings (<N>):
  <pattern ID> — <path>:<lines> (churn <N>)
  …

No evidence found: A1, A3 · B2, B4 · C2, C4 · D1
```

## Shallow-clone fallback

If `git log --since="90 days ago"` returns no history (shallow CI clones), set churn=1 for all files and note `Hotspot scoring degraded: shallow clone, no churn signal` in the output header. Findings remain valid; only the ordering loses fidelity.
