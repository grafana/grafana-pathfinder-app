---
name: prevent-doc-drift
description: Per-PR documentation-drift prevention. When a PR adds new code subsystems, scripts, skills, docs, plugin routes, feature flags, or changes architecture relationships, this skill produces the AGENTS.md, CLAUDE.md, and .cursor/rules/ updates needed in the same PR so agent guidance never falls behind the code. Use this on /review or directly before merge.
---

# Prevent doc drift

A **per-PR** doc-quality skill. It compares the PR diff against agent guidance files and updates them in the same PR so future agents are never working from a stale map.

This skill is paired with `.cursor/skills/maintain-docs/`:

- **`prevent-doc-drift` (this skill)** — runs on every PR; catches drift at the moment it's introduced.
- **`maintain-docs`** — runs periodically across the whole repo; catches drift that this skill missed.

Together they form a two-tier defence: the per-PR skill is the primary line, the periodic skill is the safety net.

## Hard constraints

These constraints are absolute and override any other instructions:

1. **Only modify documentation files.** Allowed: `AGENTS.md`, `CLAUDE.md`, `README.md` at repo root; any `*.md` or `*.mdc` under `.cursor/rules/`, `.cursor/skills/`, or `docs/developer/`. **Forbidden**: any source file (`.ts`, `.tsx`, `.js`, `.jsx`, `.go`, `.json`, `.css`, `.html`), config files, lockfiles, and **any file under `docs/design/`** (design docs are author-curated by humans via the `design-review` skill).
2. **Operate on the PR diff only.** Do not audit files outside the diff. If you find drift in a file the PR did not touch, add it to `docs/_maintenance-backlog.md` for `maintain-docs` to handle — do not silently fix it here.
3. **Never fabricate.** Only document features, subsystems, services, scripts, and relationships that the diff actually adds. If you cannot confirm something exists from the diff plus a focused code read, omit it.
4. **Before staging anything, verify the constraint.** Run `git diff --name-only` after edits and confirm every changed path is in the allowed list above. Abort if any disallowed file appears.
5. **One commit max.** All doc updates land as a single follow-up commit on the same PR branch (or, if invoked from `/review`, as a recommended diff block in the review output — see "Operating modes" below).
6. **Do not amend the PR's existing commits.** Create a new commit.

## Operating modes

The skill has two modes:

- **Apply mode** (default when invoked directly): the working tree is the PR branch. Apply edits, stage, commit with a clear message, push.
- **Review mode** (invoked from `/review`): output a single fenced patch block per file with the proposed edits. Do not modify the working tree. The reviewer agent embeds these in the review comment so the author can apply them.

Decide which mode applies based on context: if a `gh pr` command can determine the current branch is a PR branch and the user invoked this skill directly, use apply mode. If the parent is `/review`, use review mode.

## Workflow

### Phase 0 — Resolve the diff

1. Determine the base ref:
   - If on a PR branch: `gh pr view --json baseRefName -q .baseRefName`
   - Otherwise: `git merge-base HEAD main` (or whatever the repo's main branch is — check `git symbolic-ref refs/remotes/origin/HEAD`).
2. Capture the diff in three forms — you'll use each:
   - `git diff --name-status <base>...HEAD` (status flags A / M / D / R)
   - `git diff --stat <base>...HEAD` (line counts)
   - `git log <base>..HEAD --oneline` (commit subjects)
3. From `package.json`, read the current set of npm scripts: `jq -r '.scripts | keys[]' package.json` (you'll diff this against the table in AGENTS.md).

If the diff is empty or doc-only, exit cleanly with "no source changes — no drift possible."

### Phase 1 — Categorize changes

Walk the name-status output and bucket each path into one of these categories. A single file may land in multiple buckets; that's fine.

| Bucket                             | Matches (path patterns)                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **New frontend subsystem**         | New directory at `src/<dir>/` (any first commit of a path matching `src/<name>/...`)                    |
| **New backend file**               | New file at `pkg/**/*.go`                                                                               |
| **New developer doc**              | New file at `docs/developer/**/*.md`                                                                    |
| **New design doc**                 | New file at `docs/design/**/*.md` (we index it; we do **not** edit it)                                  |
| **New rule**                       | New file at `.cursor/rules/*.mdc` or `.cursor/rules/*.md`                                               |
| **New skill**                      | New directory at `.cursor/skills/<name>/` (look for new `SKILL.md`)                                     |
| **New npm script**                 | Diff of `package.json` adds a key under `.scripts`                                                      |
| **New plugin HTTP route**          | Diff of `pkg/plugin/resources.go` adds a `mux.Handle(...)` or `mux.HandleFunc(...)` call                |
| **New plugin stream message type** | Diff of `pkg/plugin/stream.go` or `pkg/plugin/terminal.go` adds a new `TerminalStreamOutput.Type` value |
| **New feature flag**               | Diff of `src/utils/openfeature.ts` or related adds a flag name                                          |
| **New `data-test-*` attribute**    | Diff adds a new test-id constant in `src/constants/testIds.ts` or sets a new `data-test-*` literal      |
| **Renamed / moved subsystem**      | Name-status `R<percent>` entries that change a `src/<dir>/` or `pkg/plugin/<file>` path                 |
| **Removed subsystem**              | Name-status `D` entries that empty out a `src/<dir>/` or `pkg/plugin/<file>` path                       |
| **Tier rule edit**                 | Diff of `src/validation/architecture.test.ts` or relevant ESLint config changes                         |

For each match, capture the path(s), surrounding diff context, and one-sentence summary of what the change does (read up to ~30 lines of the new file or the diff hunk if needed).

### Phase 2 — Detect required doc updates

For each bucket with hits, consult the rules table below. Each rule lists the target doc file(s) and exactly what edit is required.

| Bucket                                              | Target file(s)                                          | Required edit                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New frontend subsystem                              | `AGENTS.md`                                             | Add the directory to the inline tier list in "Frontend tier model" under the correct tier (Tier 0 types, Tier 1 support, Tier 2 engines/hooks, Tier 3 integrations, Tier 4 UI). AGENTS.md carries only the one-line tier summary; the annotated tier definitions and the "Key dependency edges" table live in `.cursor/rules/systemPatterns.mdc` — if the subsystem participates in a load-bearing import edge, add the row there (see the next row). |
| New frontend subsystem                              | `.cursor/rules/systemPatterns.mdc`                      | Add a one-paragraph entry in "Frontend subsystem reference" (purpose, entry point, tier), placed under the correct tier sub-heading.                                                                                                                                                                                                                                                                                                                  |
| New frontend subsystem                              | `docs/developer/CONTEXT_INDEX.md`                       | Add a row in the most relevant section (e.g., "Subsystem references") with path pattern (`src/<name>/*`), when-to-load description, and glob trigger (for the "Auto-triggered by globs" column — Cursor metadata, see CONTEXT_INDEX preamble) if the subsystem has a natural file-glob trigger.                                                                                                                                                       |
| New backend file                                    | `.cursor/rules/systemPatterns.mdc`                      | Add a row to the `pkg/` "File map" table in "Backend architecture (`pkg/`)" with a one-line role description. AGENTS.md's "Backend (`pkg/`)" section is intentionally a short prose summary and is not the per-file catalogue.                                                                                                                                                                                                                        |
| New developer doc                                   | `AGENTS.md`                                             | If broadly load-bearing, add a bullet to the "On-demand context" frequently-needed list. Otherwise just rely on the next row (CONTEXT_INDEX is the canonical routing table).                                                                                                                                                                                                                                                                          |
| New developer doc                                   | `docs/developer/CONTEXT_INDEX.md`                       | Verify a row exists in the relevant section pointing at the new doc; add one if missing, with a when-to-load description and glob trigger if applicable.                                                                                                                                                                                                                                                                                              |
| New developer doc with `.cursor/rules/` counterpart | `.cursor/rules/<counterpart>.mdc`                       | Add a "For full reference, see `docs/developer/<file>.md`" link near the top of the rule file.                                                                                                                                                                                                                                                                                                                                                        |
| New design doc                                      | `docs/developer/CONTEXT_INDEX.md`                       | Add a row in "AI-authoring design docs" (or the closest matching section) with the note "Design intent (may not match implementation)" in the when-to-load column.                                                                                                                                                                                                                                                                                    |
| New rule                                            | `docs/developer/CONTEXT_INDEX.md`                       | Verify a row exists in "Architecture and project context" (or the relevant section) with glob trigger from the rule's frontmatter; add one if missing. If the rule is broadly load-bearing, also add a bullet to AGENTS.md's "On-demand context" frequently-needed list.                                                                                                                                                                              |
| New skill                                           | `AGENTS.md`                                             | Add the skill's `name` to the names-only list in the "Skills" section. Do **not** add a description here — the authoritative description is the skill's `SKILL.md` frontmatter, hydrated on demand. The frontmatter `name` + `description` are the single source of truth; no CLAUDE.md or CONTEXT_INDEX skill enumeration to maintain.                                                                                                               |
| New npm script                                      | `AGENTS.md`                                             | If the script belongs in the short list at the top of "Essential commands", add it there. Otherwise rely on `docs/developer/COMMANDS.md` (the canonical full command reference, which AGENTS.md links to).                                                                                                                                                                                                                                            |
| New plugin HTTP route                               | `.cursor/rules/systemPatterns.mdc`                      | Document the route under "Backend architecture (`pkg/`)" — extend the `plugin/resources.go` row in the file map or the request-flow narrative below it with method + path + one-line purpose. AGENTS.md's `pkg/` summary stays prose.                                                                                                                                                                                                                 |
| New plugin stream message type                      | `.cursor/rules/systemPatterns.mdc`                      | Add to the "Stream message types" bullet under "Backend architecture (`pkg/`)".                                                                                                                                                                                                                                                                                                                                                                       |
| New feature flag                                    | `docs/developer/FEATURE_FLAGS.md`                       | Add the flag — name, type, default, what it controls.                                                                                                                                                                                                                                                                                                                                                                                                 |
| New `data-test-*` attribute                         | `docs/developer/E2E_TESTING_CONTRACT.md`                | Add the new selector to the relevant section.                                                                                                                                                                                                                                                                                                                                                                                                         |
| Renamed / moved subsystem                           | All doc files                                           | `grep -lr <old-path> AGENTS.md CLAUDE.md .cursor/rules/ docs/developer/` and rewrite each occurrence to the new path.                                                                                                                                                                                                                                                                                                                                 |
| Removed subsystem                                   | `AGENTS.md`, `.cursor/rules/systemPatterns.mdc`, others | Remove the corresponding rows / paragraphs. If the removed feature represents an epic-scale change, recommend (in the PR description) a follow-up note in `docs/history/`.                                                                                                                                                                                                                                                                            |
| Tier rule edit                                      | `AGENTS.md`, `.cursor/rules/systemPatterns.mdc`         | If the architecture allowlist changed, update the one-line tier summary in AGENTS.md and the annotated tier model in `.cursor/rules/systemPatterns.mdc` to reflect the new exception with one sentence of justification.                                                                                                                                                                                                                              |

**CONCERNS.md coverage check (read-only)**: `docs/design/CONCERNS.md` is author-curated and forbidden from edits. However, for every **new frontend subsystem** detected, run:

```bash
grep "src/<new-dir>/" docs/design/CONCERNS.md
```

If no concern's `trigger_paths` covers the new directory, the subsystem has no review routing. Surface this gap in one of two ways, depending on mode:

- **Apply mode**: append a backlog item to `docs/_maintenance-backlog.md` (Phase 5):
  `YYYY-MM-DD: No CONCERNS.md concern covers src/<new-dir>/ — consider adding one or extending the nearest subsystem concern.`
- **Review mode**: add a note in the "Doc-drift updates recommended" section:
  `No CONCERNS.md concern covers src/<new-dir>/. Consider adding one or extending the nearest subsystem concern (e.g., <closest-matching-concern-id>).`

To identify the closest matching concern, scan the `trigger_paths` column for the concern whose paths share the most path segments with `src/<new-dir>/`.

**Sources of truth for the rules table**: when in doubt, prefer the code over any doc. If a rule says "add a row to the `src/` tree" but the tree is already accurate (because the contributor pre-emptively updated it), do nothing — log "no edit needed" and move on.

### Phase 3 — Generate the edits

For each required edit:

1. Read the target file's current content (or the relevant section).
2. Compose the minimal change needed — a new row, a new bullet, a new paragraph. **Match the surrounding format exactly**: column alignment in markdown tables, sentence case per the project's writing style (see AGENTS.md), backtick conventions for code identifiers.
3. **Sentence case**: capitalize only the first word and proper nouns (Grafana, Loki, Prometheus, Tempo, Mimir, Alloy, Grafana Cloud, etc.). Never title case for headings, button labels, or table cells.
4. **No emojis** unless the existing file already uses them.
5. Avoid touching unrelated lines. Surgical edits only.

If multiple rules target the same file (e.g., several new scripts), batch their edits into one Edit operation when possible.

### Phase 4 — Apply or report

**Apply mode:**

1. Make the edits via `Edit` / `Write`.
2. Run `git diff --name-only` and confirm every changed path is in the allowed list (per hard constraint #4). Abort and revert if not.
3. Run `npm run prettier` to format markdown.
4. Run `git diff --name-only` again after prettier; verify only doc files changed.
5. Stage the changed doc files (do not use `git add -A`; stage by explicit path).
6. Commit with a clear message:

   ```
   docs: keep agent guidance in sync with this PR's changes

   - <one bullet per change>

   Generated by .cursor/skills/prevent-doc-drift.
   ```

7. Do **not** push or open a separate PR — this commit rides the existing PR branch.
8. Report a summary back to the user: which buckets were detected, which doc files were updated, line counts.

**Review mode** (invoked from `/review`):

Output a single section the reviewer can paste into the PR comment:

```
## Doc-drift updates recommended

The following changes introduce new <bucket>, which require updates to agent guidance. Apply these diffs to keep the docs in sync:

### AGENTS.md
\`\`\`diff
<unified diff>
\`\`\`

### CLAUDE.md
\`\`\`diff
<unified diff>
\`\`\`

(... per target file ...)
```

Do not modify the working tree in review mode.

### Phase 5 — Backlog handoff

If you detect drift the skill cannot fix (because it's outside the diff, or the change is too large for incremental editing), append to `docs/_maintenance-backlog.md` under "Work items":

```
- YYYY-MM-DD: <one-line description>. Rationale: <why prevent-doc-drift deferred>.
```

This hands the issue off to `maintain-docs` on its next run.

## Detection heuristics (deeper guidance)

### Detecting a "new frontend subsystem"

A directory under `src/<name>/` is a subsystem if **any** of the following hold:

- It has its own `index.ts` barrel export
- It is referenced in `AGENTS.md`'s "Frontend tier model" bullet list (existing subsystems)
- It contains a `README.md`
- It is imported from at least two other `src/<other>/` directories

If the diff only adds files _inside_ an existing subsystem, this is not a "new subsystem" — it's an internal addition. Decide based on the directory structure, not the file count.

### Detecting which tier a new subsystem belongs in

The canonical tier model lives in `TIER_MAP` in `src/validation/import-graph.ts` and is documented in `AGENTS.md` "Frontend tier model" and `.cursor/rules/systemPatterns.mdc` "Frontend tier model". Imports flow downward only (higher tier may import lower; never the reverse).

Tier 2 markers (engines & hooks):

- The name contains `-engine`, `-manager`, `recovery`, or a similarly load-bearing identifier (note: `recovery` itself currently lives in Tier 1 because it depends only on `types/` — exact placement is dictated by what the subsystem actually imports, not by name alone)
- It exports a service class or a hook that other subsystems depend on
- It is imported by `components/` (Tier 4) or `pages/` (Tier 4)

Tier 1 markers (support utilities):

- Imports only `types/` and `constants/` (Tier 0)
- Provides utility functions, not orchestration
- Not imported by `components/` directly (or imported only as a low-level helper)

When uncertain, default to Tier 1 — over-promotion (placing a new subsystem too high in the tier list) creates spurious "may import from anything" expectations that are harder to roll back than under-promotion. The architecture test (`src/validation/architecture.test.ts`) will catch any tier-doc mismatch on next CI run.

### Detecting renames in the diff

`git diff --name-status` shows renames as `R<percent>` followed by old-path and new-path, e.g. `R98 src/old-engine/foo.ts src/new-engine/foo.ts`. Treat any rename with similarity ≥ 75 as a true rename worth propagating to docs.

### Sentence-case checking

Before committing, scan your edits for title-case violations:

- Headings: only the first word capitalized (plus proper nouns)
- Table cells: same rule
- Description text: same rule

The repo follows the [Grafana Writers' Toolkit](https://grafana.com/docs/writers-toolkit/write/style-guide/capitalization-punctuation/#capitalization). Proper nouns to capitalize: Grafana, Loki, Prometheus, Tempo, Mimir, Alloy, Grafana Cloud, Grafana Enterprise, Grafana Labs. Generic terms stay lowercase: dashboard, alert, data source, panel, query, plugin.

## When to exit cleanly without making changes

- The diff is doc-only (no source changes).
- The diff contains only test-only changes, lint cleanups, dependency bumps, or version bumps — none introduce features.
- The contributor pre-emptively updated the docs and the audit produces no required edits.

In each case, report briefly: "No drift detected — exiting cleanly."

## When to NOT run this skill

- Branches that are not PR branches (running on `main` directly).
- PRs that explicitly bypass the doc-drift contract (e.g., emergency hotfixes labelled `hotfix-no-docs` or similar). If the PR has such a label, exit cleanly with a note.
- When the user has explicitly asked for source-code-only changes — in which case any doc edits are out of scope.

## Integration with `/review`

When `/review` runs, after the routed reviewers have produced their findings, invoke this skill in **review mode** to attach a "Doc-drift updates recommended" section. The reviewer agent should include the section verbatim in the review output. The PR author can then apply the diffs themselves or invoke this skill in apply mode to commit them.

## Examples

### Example 1: PR adds a new engine

PR diff includes:

```
A  src/recommendation-cache/index.ts
A  src/recommendation-cache/cache.ts
A  src/recommendation-cache/cache.test.ts
M  src/context-engine/context.service.ts  (imports new cache)
```

Detected buckets: **New frontend subsystem**.

Detected updates:

- `AGENTS.md` "Frontend tier model" — add `recommendation-cache/` to the Tier 2 bullet (engines & hooks) and add the edge `context-engine` → `recommendation-cache` to the "Key dependency edges" table in the same section
- `.cursor/rules/systemPatterns.mdc` "Frontend subsystem reference" — add a paragraph entry under the Tier 2 sub-heading (purpose, entry point, tier)

### Example 2: PR adds a new npm script and feature flag

PR diff includes:

```
M  package.json                     (+ "validate:e2e": "...")
M  src/utils/openfeature.ts          (+ "useNewRecommender" flag)
```

Detected buckets: **New npm script**, **New feature flag**.

Detected updates:

- `AGENTS.md` "Essential commands" — add `npm run validate:e2e` only if it qualifies as a top-of-file essential command; otherwise log "no edit needed — script is documented in `docs/developer/COMMANDS.md` (canonical full command reference)"
- `docs/developer/FEATURE_FLAGS.md` — add `useNewRecommender` to the flag table

### Example 3: PR adds a new plugin HTTP route

PR diff includes:

```
M  pkg/plugin/resources.go          (+ mux.HandleFunc("/sessions", a.handleSessions))
M  pkg/plugin/sessions.go           (new file)
```

Detected buckets: **New backend file**, **New plugin HTTP route**.

Detected updates:

- `.cursor/rules/systemPatterns.mdc` "Backend architecture (`pkg/`)" — add `plugin/sessions.go` row to the file map with a one-line role description, and add the new `POST /sessions` route to the request-flow narrative (or extend the `plugin/resources.go` row note)
- `AGENTS.md` "Backend (`pkg/`)" — no edit needed unless the route changes the three primary request paths (HTTP resource API, streaming terminal, Coda JWT client) summarized in the section's prose

### Example 4: contributor already updated docs

PR diff includes a new subsystem **and** the corresponding rows in `AGENTS.md` and `.cursor/rules/systemPatterns.mdc`.

The skill detects the new subsystem (Phase 1), runs the rules (Phase 2), then in Phase 3 reads each target file and finds the rows already present. It logs "no edit needed" for each and exits cleanly in Phase 4.

## Context window management

This skill stays small intentionally:

- Phase 0 reads only the diff (one `gh` / `git` invocation each).
- Phase 1 categorizes from the diff without reading full file contents (~30 lines max per new file).
- Phase 2 reads only the target doc sections that need editing — never the whole file unless < 100 lines.
- Phase 3 makes surgical edits via `Edit` (not `Write`).
- Phase 4 runs prettier and verifies the changed-file list, then commits.

Total context budget per run: under 30k tokens for a typical PR. Larger PRs may exceed this — in that case, prioritize: (1) new subsystems, (2) new docs, (3) new scripts, (4) everything else.
