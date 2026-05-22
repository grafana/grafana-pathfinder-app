---
name: secure
description: Security audit — frontend (F1-F6 rules from `.cursor/rules/frontend-security.mdc`), Go backend (URL allowlists, token handling, hardcoded secrets, unbounded reads), MCP HTTP transport (size / wallclock / concurrency caps, Zod-validated tool inputs), and dependency audit (`npm audit` high+critical, Go module advisories). Reports findings with concrete remediation per rule. Never edits source — the user applies fixes.
---

# Security audit

Skillifies the `/secure` slash-command label in `CLAUDE.md` with a real workflow. Audits the current working tree or a PR diff against the repo's canonical security rules, the backend's allowlist contracts, the MCP transport mitigations, and dependency advisories. Emits a severity-ordered findings list with concrete remediation. Never touches source — the security analyst applies fixes, not the skill.

This skill complements:

- **`prevent-doc-drift`** — catches missing docs for new security patterns.
- **`/review`** — invokes this skill as a security pass when the `security` concern from `docs/design/CONCERNS.md` is activated.

## Hard constraints

These constraints are absolute and override any other instructions:

1. **Never edit source files.** This skill is report-only. The reviewer applies fixes.
2. **`[security]` is reserved for clear violations** — F1-F6 hits, backend allowlist bypasses, token leaks, or known CVEs. Speculative or theoretical risks use `[suggestion]` or `[question]` from the standard prefix table in `docs/design/PR_REVIEW.md`. **False positives erode trust; prefer false negatives.**
3. **Ground every F1-F6 finding** in `.cursor/rules/frontend-security.mdc`. Quote the rule ID and the canonical Do / Don't example when reporting.
4. **For backend findings, quote the offending line** with `file:line` reference and the canonical pattern (e.g., `isAllowedCodaURL`, `IsAllowedRelayURL`, `setAuthHeader`).
5. **Sentence case** for findings and remediation text.
6. **Reads only.** No `gh pr edit`, no `git commit`, no file writes.

## Workflow

### Phase 0 — Scope

Determine the target:

- **PR-branch mode** (default when on a non-main branch): audit `git diff <base>...HEAD`.

  ```
  base=$(gh pr view --json baseRefName -q .baseRefName 2>/dev/null || echo main)
  git diff --name-only $base...HEAD
  ```

- **Working-tree mode** (when invoked on main or with uncommitted changes): audit modified + new files in `git status`.

- **Full-tree mode** (when invoked with `/secure --full`): audit the whole repo. Slow but comprehensive. Use sparingly.

Capture the list of files to audit; bucket by type:

- `.ts`, `.tsx`, `.js`, `.jsx` → frontend audit (Phase 1)
- `.go` under `pkg/**` → backend audit (Phase 2)
- `src/cli/mcp/**` → MCP transport audit (Phase 3)
- Always run Phase 4 (deps audit) regardless of touched files

### Phase 1 — Frontend audit (F1-F6)

For each `.ts` / `.tsx` / `.js` / `.jsx` file in scope, read the changed hunks and apply the detection table from `.cursor/rules/frontend-security.mdc`:

| ID  | What to detect                                                                                                                      | Severity |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | -------- |
| F1  | Untrusted / dynamic SVG passed to `dangerouslySetInnerHTML` without `DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true } })`      | Critical |
| F2  | `dangerouslySetInnerHTML` used where `{}` auto-escape would do                                                                      | High     |
| F3  | URL built via string concat (`apiBase + '/users?id=' + userId`) instead of `new URL()` + `URL.searchParams.set()`                   | High     |
| F4  | `dangerouslySetInnerHTML` without `textUtil.sanitize()` (or `sanitizeDocumentationHTML()` from `src/security/`)                     | Critical |
| F5  | Any of `.innerHTML`, `.outerHTML`, `.insertAdjacentHTML`                                                                            | Critical |
| F6  | URL passed to `href` / `src` without `textUtil.sanitizeUrl()` or a scheme-allowlist check (`parseUrlSafely`, `isAllowedContentUrl`) | High     |

**Detection rules:**

- For F1 / F4: a match must combine `dangerouslySetInnerHTML` with a dynamic value. Static strings are fine. Check the source of the `__html` field — if it traces to a constant, skip.
- For F3: only flag when the URL contains a user-controlled segment. URLs built entirely from constants are not findings.
- For F5: any occurrence is a finding. The repo's canonical safe APIs are `document.createElement`, `element.textContent`, `element.setAttribute`.
- For F6: scheme allowlist must reject `javascript:`, `data:`, and `vbscript:`. The repo's canonical helpers are in `src/security/url-validator.ts`.

**Report each finding** with:

- `[security][F<N>]` prefix
- `file:line` reference
- Quoted offending code (one line preferred; up to three for context)
- Sentence-case description of the risk
- Remediation: name the specific API to use, with the import path

Example:

```
[security][F5] src/components/Foo.tsx:42 — Direct innerHTML assignment.

  element.innerHTML = `<span>${userName}</span>`;

Risk: XSS — `userName` is user-controlled and bypasses React's auto-escape.
Remediation: use `element.textContent = userName` or render via JSX `<span>{userName}</span>`.
See F5 in `.cursor/rules/frontend-security.mdc`.
```

### Phase 2 — Backend audit (`pkg/**`)

For each `*.go` file in `pkg/` that the diff touches, check for:

**B1. Allowlist bypass** (severity: Critical)

- Any new HTTP request to an external URL that does not pass `isAllowedCodaURL`, `IsAllowedRelayURL`, or the equivalent host-allowlist check.
- The canonical functions live in `pkg/plugin/resources.go` (`isAllowedCodaURL`, `isAllowedHost`, `IsAllowedRelayURL`) and `pkg/plugin/package_recommendations.go` (`allowedPackageRepositoryHosts`).
- Remediation: route the URL through the existing allowlist function or extend the allowlist with a documented justification.

**B2. JWT bearer without refresh** (severity: High)

- Any new HTTP call using a JWT bearer that does not call `CodaClient.setAuthHeader` (which handles token refresh) or that hardcodes a token.
- Remediation: route through `setAuthHeader(ctx, req)` per the pattern in `pkg/plugin/coda.go`.

**B3. Hardcoded secrets** (severity: Critical)

- Regex-match for: `Bearer\s+[A-Za-z0-9._-]{20,}` in source (not comments), `password\s*=\s*"[^"]{4,}"`, `token\s*=\s*"[^"]{20,}"`, and `secret\s*=\s*"[^"]{8,}"`.
- Skip test fixtures (`*_test.go`) that intentionally use stub values.
- Remediation: move to `pkg/plugin/settings.go` and decrypt via `SecureJSONData`.

**B4. Unbounded payload reads** (severity: Medium)

- `io.ReadAll(req.Body)` without a `http.MaxBytesReader` wrap on the request body.
- Remediation: `req.Body = http.MaxBytesReader(w, req.Body, <limit>)` before reading.

**B5. Path-traversal in resource handlers** (severity: High)

- Any `path.Join` or string concat that incorporates a user-controlled segment into a filesystem path.
- Remediation: validate the segment against an allowlist and prefer `filepath.Clean` + boundary check.

**Quote each finding** with `file:line` and the canonical pattern reference.

### Phase 3 — MCP transport audit

If the diff touches `src/cli/mcp/**`, verify:

**M1. New HTTP transport code includes the existing safety caps** (severity: High)

- `MAX_REQUEST_BYTES` (1 MB body cap)
- `PER_CALL_WALLCLOCK_MS` (30 s per-call timeout)
- `MAX_CONCURRENT_REQUESTS` (100 cap → 503 over)
- `KEEPALIVE_TIMEOUT_MS`, `HEADERS_TIMEOUT_MS`, `REQUEST_TIMEOUT_MS` (slowloris mitigations)

Reference: `src/cli/mcp/transports/http.ts`. If a new transport surface lacks these, flag.

**M2. Tool inputs validated via Zod** (severity: High)

- Every new MCP tool must declare its input shape via a Zod schema rather than `unknown` / `Record<string, unknown>`.
- Remediation: define a `z.object({...})` schema and parse with `.safeParse()` at the tool boundary.

**M3. User content quoted, not interpolated** (severity: High)

- If a tool emits a prompt or LLM-bound payload that includes user-supplied text, the text must be quoted (fenced block, XML tag, JSON value) — not interpolated bare into a free-form sentence.
- Remediation: wrap user content in fenced markdown blocks or JSON values per the patterns in `docs/design/MCP-AGENT-UX-HARDENING.md`.

**M4. State-mutating tools require confirmation** (severity: High)

- New tools that mutate persistent state (publish, write, delete) must signal to the caller that confirmation is needed — per the `confirmationPrompt` and `clientGuidance` model in `docs/design/CLIENT-ORCHESTRATION-GUIDE.md` and `docs/design/APP-PLATFORM-PUBLISH-HANDOFF.md`.
- Read-only tools (list, get, schema) are exempt.

### Phase 4 — Dependency audit

Always run:

1. **`npm audit`** for production deps:

   ```
   npm audit --omit=dev --json 2>&1
   ```

   - Surface only **high** and **critical** advisories. Moderate / low are informational only.
   - For each, print: advisory ID, affected package + version range, severity, "fixable via `npm audit fix`" indicator.

2. **Go modules**:

   ```
   cd pkg && go list -m -json -u all 2>&1 | head -40
   ```

   - List modules that have an `Update` field (i.e., a newer version is available).
   - Note any module name that matches the GOVULN database conventions (e.g., listed in `golang.org/x/vuln`). The skill does not run `govulncheck` automatically — note "run `govulncheck ./...` for authoritative scan" in the report.

3. **Dev-only deps** (`npm audit` without `--omit=dev`) are informational. Report total counts but do not flag as blocking.

### Phase 5 — Report

Group findings by severity. Print in this order:

```
## Security audit — <date>

Target: <scope description, e.g., "PR diff against main, 12 files">

### Critical (N)

- [security][F5] src/components/Foo.tsx:42 — Direct innerHTML assignment. ...
- [security][B3] pkg/plugin/internal.go:18 — Hardcoded bearer token. ...

### High (N)

- ...

### Medium (N)

- ...

### Low / Informational (N)

- ...

### Disposition

<one line: clean | minor | blocking>

<if blocking: "Do not merge until critical / high findings are addressed.">
```

**Disposition rules:**

- `clean` — zero findings of medium or higher severity.
- `minor` — at most medium findings; no critical or high.
- `blocking` — at least one critical or high finding.

Print a per-finding summary table at the end:

```
| ID  | Count |
| --- | ----- |
| F1  | 0     |
| F2  | 1     |
| ... | ...   |
```

This helps the reviewer scan the surface quickly.

## Reuses

- `.cursor/rules/frontend-security.mdc` — F1-F6 canonical rules and Do / Don't examples.
- `src/security/` — canonical sanitization APIs (`parseUrlSafely`, `sanitizeDocumentationHTML`, `validateTutorialUrl`, etc.).
- `pkg/plugin/resources.go` — backend allowlist functions.
- `pkg/plugin/coda.go` — token refresh + auth header pattern.
- `pkg/plugin/package_recommendations.go` — bounded memory + allowlist pattern.
- `src/cli/mcp/transports/http.ts` — MCP HTTP transport safety caps.
- `docs/design/CONCERNS.md` — security concern routing + one-way doors.
- `docs/design/MCP-AGENT-UX-HARDENING.md` — MCP UX security guidance.
- `docs/design/CLIENT-ORCHESTRATION-GUIDE.md`, `docs/design/APP-PLATFORM-PUBLISH-HANDOFF.md` — confirmation flow contracts.

## Integration

- **`/review`** invokes this skill as a security pass when the `security` concern from `docs/design/CONCERNS.md` is activated (per its `trigger_paths` / `trigger_keywords`).
- **`/pr-summary`** consults `activated_concerns` from the same routing; if security activates, the Test plan section references this skill's manual checks.
- **`prevent-doc-drift`** catches new security patterns that need documentation; this skill catches missing checks against the existing rules.

## When to exit cleanly without making changes

- Scope is empty (no touched files in any audited category) — exit with "No security-sensitive files in scope. Skipping audit." Still run Phase 4 (deps audit) and report.
- Working tree on a non-PR branch with no diff — exit with "No diff to audit. Use `/secure --full` to scan the whole repo." Still report deps audit.

## Context window management

- Phase 0: list-only; small.
- Phase 1: read each frontend file's changed hunks (not full files). For files under 200 lines, read the whole file once.
- Phase 2: read each backend file's changed hunks; reference the canonical pattern from the in-context summary, do not re-read `coda.go` in full each time.
- Phase 3: only runs when MCP code is touched.
- Phase 4: streams `npm audit` and `go list -m -u all`; summarize, do not embed full output.
- Phase 5: in-memory aggregation + render.

Total context per run: under 30k tokens for a typical PR. Full-tree mode (`--full`) is larger but bounded by the audited file count.

## Expected invocation patterns

- **From `/review`**: when the security concern routes activate.
- **Direct, before opening a PR**: author runs `/secure` to catch issues before reviewers do.
- **Pre-release**: maintainer runs `/secure --full` before `/release-prep` to verify nothing slipped in over the release window.
- **Post-incident**: after a security incident, run `/secure --full` to confirm the fix landed and nothing similar lingers.

## What this skill does NOT do

- Fix violations (decision locked in via plan-mode question — report-only).
- Run `govulncheck` automatically (note it in the report; expensive to run on every invocation).
- Audit `docs/` content for sensitive information leakage — that's `prevent-doc-drift` + `maintain-docs` territory.
- Replace `npm audit` or CodeQL — this skill grounds findings in repo-specific rules, not as a general scanner.

## Worked example output (clean run)

```
## Security audit — 2026-05-11

Target: PR diff against main, 4 files touched

### Critical (0)

(none)

### High (0)

(none)

### Medium (0)

(none)

### Low / Informational (2)

- [info] npm audit: 12 moderate, 1 low vulnerabilities. None in production deps.
- [info] go list: 3 modules with available updates; none with known CVEs.

### Disposition

clean
```

## Worked example output (with findings)

```
## Security audit — 2026-05-11

Target: PR diff against main, 7 files touched

### Critical (1)

[security][F4] src/components/docs-panel/docs-panel.tsx:218 — `dangerouslySetInnerHTML` without sanitization.

  <div dangerouslySetInnerHTML={{ __html: rawGuideContent }} />

Risk: XSS — `rawGuideContent` is fetched from external CDN and not sanitized.
Remediation: wrap with `sanitizeDocumentationHTML(rawGuideContent)` from `src/security/html-sanitizer.ts`.
See F4 in `.cursor/rules/frontend-security.mdc`.

### High (1)

[security][B1] pkg/plugin/sessions.go:34 — External URL request bypasses host allowlist.

  resp, err := http.Get(req.URL.String())

Risk: allows arbitrary external requests from the plugin backend.
Remediation: route through `isAllowedCodaURL(req.URL.String())` (see `pkg/plugin/resources.go:64-77`).

### Medium (0)

(none)

### Low / Informational (1)

- [info] npm audit: 27 vulnerabilities (1 low, 12 moderate, 8 high, 6 critical). High / critical are in dev deps only.

### Disposition

blocking — do not merge until F4 and B1 are addressed.
```
