# Grafana Pathfinder - AI Agent Guide

## What is this project?

**Grafana Pathfinder** is a Grafana App Plugin that provides contextual, interactive documentation directly within the Grafana UI. It appears as a right-hand sidebar panel that displays personalized learning content, tutorials, and recommendations to help users learn Grafana products and configurations. Built as a **React + TypeScript + Grafana Scenes** frontend with a **Go backend** using `grafana-plugin-sdk-go`.

### Key features

- **Context-Aware Recommendations**: Automatically detects what you're doing in Grafana and suggests relevant documentation
- **Interactive Tutorials**: Step-by-step guides with "Show me" and "Do it" buttons that can automate actions in the Grafana UI
- **Tab-Based Interface**: Browser-like experience with multiple documentation tabs and localStorage persistence
- **Intelligent Content Delivery**: Multi-strategy content fetching with bundled fallbacks
- **Progressive Learning**: Tracks completion state and adapts to user experience level

### Target audience

Beginners and intermediate users who need to quickly learn Grafana products. Not intended for deep experts who primarily need reference documentation.

## Code style and conventions

### Coding style

- **Functional-first**: Pragmatic FP approach balancing purity with practicality
- Break problems into small, reusable functions
- Use immutable data structures and pure functions for core logic
- Allow minimal side effects in well-isolated functions (e.g., IO, logging)
- Favor functional patterns (`map`, `filter`, `reduce`) over loops
- Use type annotations whenever possible
- Favor idiomatic React usage consistent with the Grafana codebase

### Comments

**Default to no comments.** Add one only when removing it would confuse a reader who can read the surrounding code. The narrow band that earns a comment: counterintuitive code that looks wrong but is correct, hidden invariants, or workarounds for specific external bugs (with a link).

**Trim on touch.** When editing a function, also trim bad-shape comments inside that function and on adjacent declarations in the same file. Do not sweep whole files or grep across the repo for cleanup — comment removal rides along on code changes, never as a standalone PR.

**Bad shapes to avoid and delete (QC8 catalog):**

**1. Narrates what the next line obviously does.**

```ts
// Loop over the items and double each one.
items.map((x) => x * 2);
```

The expression already says this.

**2. Defends a non-action (`Intentionally NOT X here because Y`).**

```ts
// Intentionally NOT calling cleanup() here — the parent already handles
// teardown when the dependency changes, and a double-cleanup would race.
doWork();
```

Defends a decision against a future change. When the surrounding architecture shifts, the comment becomes orphaned justification and is one of the most common stale-comment vectors. If the reasoning is load-bearing, put it in the commit message.

**3. References dead process artifacts.**

```ts
/**
 * Critical closure rule (addresses pre-mortem H1, fixes ticket ABC-1234):
 *   The handler reads state inside the listener, not at mount time.
 */
```

Pre-mortem labels, ticket numbers, PR references, and internal pattern names are meaningless six months from now. If the rule matters, document the rule, not the meeting it came from.

**4. Renamed-along-with-symbol (stale-in-waiting).**

```ts
/** From `useFooBar`. Drives visibility of the Reset button. */
hasProgress: boolean;
```

Exists only to point at where a value comes from, which `Find References` does for free. When `useFooBar` gets renamed, the comment becomes a lie unless someone updates it.

**5. Repeats the user-visible string.**

```ts
// Surface a notification so the user understands why nothing happened.
publish({ type: 'alert-info', payload: ['Open a guide before continuing.'] });
```

The alert payload literally says the same thing.

**6. Big JSDoc on a small internal type.**

```ts
/**
 * Structural type for the hook's model parameter. Defined here (not imported)
 * to avoid a circular import. The real model satisfies this shape by virtue
 * of extending SceneObjectBase<State>. <several more lines>
 */
interface HookModel {
  state: State;
  save(): Promise<void>;
}
```

Five-line JSDoc on a three-line internal interface. The cycle-avoidance reason is real but isn't load-bearing for a reader of this file. Compress to one short line or delete.

**7. Justifies a `||` fallback / trivial defaulting.**

```ts
// Prefer currentValue so we land on the latest state, not the initial one.
// For most cases the two are equal.
const value = obj?.currentValue || obj?.initialValue;
```

The `||` already says "fall back." If the names aren't clear enough, rename the fields.

**8. Whole-file docstring on a small (<50 line) module.**

```ts
/**
 * Module-level counter for tracking in-flight requests. Increment when a
 * request starts, decrement when it finishes. <15 more lines of preamble>
 */
let inFlight = 0;
export function begin() {
  inFlight += 1;
}
export function end() {
  if (inFlight > 0) inFlight -= 1;
}
```

Twenty-line preamble on three one-line functions. The header rots faster than the code it sits above. Belongs in a commit message or design doc.

**Keep-list — comments that earn their place:**

- **Counterintuitive code.** Looks wrong but is correct because of a subtle constraint a reader can't see from the surrounding context.
- **Hidden invariants.** Preconditions or postconditions the type system can't express ("caller must hold the lock," "this must run before X mounts").
- **External-bug workarounds.** Workarounds for specific bugs in dependencies or platform behavior, always with a link to the upstream issue.
- **Security or correctness warnings.** "Do not change this comparison order — see CVE-XXXX-XXXX" with the reason.

If you can't fit the comment in one short line, the code probably needs renaming or restructuring instead of explanation.

### Writing style

All UI text and documentation follows **sentence case** per the [Grafana Writers' Toolkit](https://grafana.com/docs/writers-toolkit/write/style-guide/capitalization-punctuation/#capitalization).

- **Capitalize only the first word** and proper nouns (product names, company names)
- **Do NOT use title case** for headings, button labels, menu items, or other UI elements
- Proper nouns to capitalize: **Grafana**, **Loki**, **Prometheus**, **Tempo**, **Mimir**, **Alloy**, **Grafana Cloud**, **Grafana Enterprise**, **Grafana Labs**
- Generic terms stay lowercase: dashboard, alert, data source, panel, query, plugin

### File creation policy

Do NOT create summary `.md` files unless explicitly requested by the user. No `IMPLEMENTATION_SUMMARY.md`, no `CLEANUP_SUMMARY.md`, no proactive documentation files. Communicate all summaries and completion status directly in chat responses.

### Slash commands

| Command   | Role                 | Behavior                                                                                                                                                                           |
| --------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/review` | Code reviewer        | Precision and respect. Focus on clarity, correctness, maintainability. Highlight naming issues, duplication, hidden complexity, poor abstractions. Actionable, concise, kind.      |
| `/secure` | Security analyst     | Think like an attacker. Inspect for vulnerabilities, unsafe patterns, injection risks, secrets in code, insecure dependencies. Explain risk clearly, provide concrete remediation. |
| `/test`   | Test writer          | Tests that enable change. Prioritize unit tests, edge cases, failure modes. Property-based tests when useful. Avoid mocking unless necessary. Fast, isolated, reliable.            |
| `/docs`   | Documentation writer | Write for humans first. Document purpose, parameters, return values. Small useful examples. Standard docstring style. Avoid unnecessary words.                                     |

## Essential commands

```bash
npm install              # Install dependencies (requires Node.js 22+)
npm run dev              # Frontend watch mode
npm run server           # Run Grafana locally with Docker
npm run test:ci          # Frontend tests, no coverage (agents should use this, not `npm test`)
npm run test:coverage    # Frontend tests with coverage + thresholds (used by `npm run check`)
npm run lint:fix         # Lint + autofix
npm run check            # Full pre-merge gate: typecheck + lint + prettier + lint:go + test:go + test:coverage
```

Dev server runs at http://localhost:3000 (admin/admin). For the complete command reference (build targets, mage tasks, validation, i18n, peerjs, etc.), see `docs/developer/COMMANDS.md` or read `package.json#scripts` directly.

## Code organization

### Frontend tier model

Imports flow **downward only** to avoid cycles. Cross-tier rules are enforced by ESLint and `src/validation/architecture.test.ts`; exceptions require an explicit allowlist entry with justification.

- **Tier 0 — Types & constants**: `types/`, `constants/`
- **Tier 1 — Support**: `lib/`, `security/`, `styles/`, `global-state/`, `utils/`, `validation/`, `recovery/`
- **Tier 2 — Engines & hooks**: `context-engine/`, `docs-retrieval/`, `interactive-engine/`, `requirements-manager/`, `learning-paths/`, `package-engine/`, `hooks/`
- **Tier 3 — Integrations**: `integrations/`
- **Tier 4 — UI**: `components/`, `pages/`

Excluded from tier analysis (not tiered): `test-utils/`, `cli/`, `bundled-interactives/`, `img/`, `locales/`. The canonical source is `TIER_MAP` in `src/validation/import-graph.ts`; this list must stay in sync with it (enforced by `src/validation/architecture.test.ts`).

**Key dependency edges** (where the load-bearing wiring lives):

| Edge                                           | Why                                                            |
| ---------------------------------------------- | -------------------------------------------------------------- |
| `context-engine` → `docs-retrieval`            | Fetches content for the recommendations it surfaces            |
| `docs-retrieval` → `bundled-interactives`      | Fallback when the online CDN is unavailable                    |
| `docs-retrieval` → `package-engine`            | Resolves package manifests + content                           |
| `components/docs-panel` → `interactive-engine` | Executes step actions when the user clicks "Show me" / "Do it" |
| `interactive-engine` → `requirements-manager`  | Checks prereqs before enabling / executing a step              |
| `interactive-engine` → `lib/dom`               | Selector resolution + element detection                        |
| `components/docs-panel` → `context-engine`     | Reads and renders recommendations                              |
| `components/docs-panel` → `global-state`       | Sidebar, panel-mode, tab persistence                           |
| `learning-paths` → `lib/user-storage`          | Persists progress + streak data                                |
| `recovery` → `requirements-manager`            | Decides whether a failed requirement is auto-recoverable       |

For per-subsystem entry points, public surfaces, and key files, load `.cursor/rules/systemPatterns.mdc`.

### Backend (`pkg/`)

The Go backend is a thin bridge between the React frontend and the **Coda VM provisioning service**. No database — all state is ephemeral or delegated to Coda. Three primary request paths: HTTP resource API (`resources.go`), streaming terminal over Grafana Live (`stream.go` + `terminal.go` + `wsconn.go`), and the Coda JWT client (`coda.go`).

When touching `pkg/`, load `.cursor/rules/coda.mdc` (agent-facing constraints) and `docs/developer/CODA.md` (full SSH / relay / credential-refresh reference). Plugin entrypoint is `pkg/main.go`.

## On-demand context

Load files only when working in the relevant domain — do not preload. The full routing table (engines, security, testing, CLI/MCP, design docs, skills, history) lives in **[`docs/developer/CONTEXT_INDEX.md`](docs/developer/CONTEXT_INDEX.md)**.

Frequently-needed entries:

- `docs/design/CONCERNS.md` — PR review routing, impact analysis, one-way doors
- `.cursor/rules/systemPatterns.mdc` — architecture, component relationships, per-subsystem entry points
- `.cursor/rules/frontend-security.mdc` — frontend security F1-F6; load when working in `*.ts`/`*.tsx`/`*.js`/`*.jsx` files (Cursor auto-loads via `globs:` frontmatter; Claude Code does not — cite by path)
- `.cursor/rules/react-antipatterns.mdc` — Do/Don't reference for R1-R21
- `.cursor/rules/testingStrategy.mdc` — unit/smoke/integration test guidance
- `docs/developer/E2E_TESTING.md` + `E2E_TESTING_CONTRACT.md` — E2E runner and `data-test-*` attributes
- `docs/developer/RELEASE_PROCESS.md` — releasing, deploying, versioning

## PR reviews

Use `/review`. It invokes `.cursor/skills/review/SKILL.md` (orchestration workflow) which loads `docs/design/CONCERNS.md` (concern routing) and `docs/design/PR_REVIEW.md` (pattern catalog for R1-R21, F1-F6, QC1-QC7, G1-G7); `react-antipatterns.mdc` loads on hit. For Go PRs touching `pkg/**/*.go`, also verify `npm run lint:go`, `npm run test:go`, and `go build ./...` pass.

Use `CONCERNS.md` alone for impact analysis, change risk classification, and subsystem-aware debugging.

## `npx` examples

When generating `npx` examples of new potential CLIs and similar, these should all live under `pathfinder-cli@...`.
For example, for a hypothetical new package `pathfinder-example`, write `npx pathfinder-cli@... example` instead of `npx pathfinder-example`.
This ensures we don't get namesquatted.
