# MCP authoring server — agent UX hardening

> Part of [Pathfinder AI authoring](./PATHFINDER-AI-AUTHORING.md).
> Follow-up to [P3 — TypeScript MCP server](./phases/ai-authoring-3-ts-mcp.md).
> Related: [Hosted authoring MCP](./HOSTED-AUTHORING-MCP.md), [Authoring artifacts](./AUTHORING-SESSION-ARTIFACTS.md), [Agent authoring CLI](./AGENT-AUTHORING.md).

## Purpose

This is a living design doc that captures **functional feedback observed when real agents drive `pathfinder-mcp`** and the proposed mechanisms to address it. It is the parking lot for "the server works, but agents misuse it in predictable ways" findings — items that are not P3 bugs and not P4 prerequisites, but that materially shape the agent authoring experience and should be swept into a future hardening phase.

It is intentionally append-only friendly. Other agents and contributors who discover new failure modes during testing or production use should add them to the [Issue log](#issue-log) below as numbered TODOs, with enough context for a future planner to design the fix.

## How to file feedback into this doc

When you observe an agent misusing the MCP server in a way that is not a one-off model failure but a predictable, reproducible pattern:

1. Add an entry to [Issue log](#issue-log) with the next sequential number.
2. Include: a one-line title, the observed behavior, the root cause if known, and any candidate mitigations you considered.
3. Cross-reference the relevant code path (`src/cli/mcp/...`) so a future planner can locate the fix surface.
4. Do **not** edit prior entries to "fix" them — strike them through with a follow-up note if a later finding supersedes, so the design history stays intact.
5. If your finding suggests a new cross-cutting mechanism (something that would help several issues at once), add it to [Cross-cutting mechanisms](#cross-cutting-mechanisms) instead of repeating it per-issue.

This doc is the source of truth for a future `/gsd-plan-phase` pass on MCP hardening — keep it specific enough that a planner can scope work from it without re-deriving the problem.

## Scope and non-goals

**In scope.** Anything that improves the chance an agent produces a valid, semantically-correct guide on the first try, or recovers cleanly when it does not. This includes: tool descriptions, input schema hints, server-level `instructions`, structured outcome shapes (`warnings[]`, error codes), CLI-side input normalization, server-side state mechanisms that improve agent UX (ETag, opaque handles, patch protocols), and addressability of nested constructs (steps, choices).

**Out of scope.** Auth and authorization (covered in `HOSTED-AUTHORING-MCP.md`), publish handoff and App Platform shape (covered in `APP-PLATFORM-PUBLISH-HANDOFF.md`), CLI-only ergonomics that do not affect MCP callers, and any change to the underlying guide schema (`json-guide.schema.ts`) — schema evolution has its own design surface.

## Cross-cutting mechanisms

Several issues below want the same plumbing. Designing these once and reusing them is cheaper than adding bespoke hints per tool.

### M1. Three-layer hint mechanism

Agents currently get hints in only one layer (input schema `.describe()` text). A complete hint surface has three layers, each read at a different point in the call lifecycle:

1. **Description-time** — `description` on `registerTool`, `.describe()` on input fields. Read by the model before tool selection. Best for "here's what this tool is for" and "do not do X."
2. **Outcome-time** — structured fields on the response. Today the response carries `outcome` (with `status`, `code`, `message`) and an echoed `artifact`. Add a `warnings: Array<{ code, message, path? }>` field on success outcomes and ensure error `code`/`message` are remediation-shaped (e.g. _"Got X. Use Y."_) rather than schema-shaped (_"expected string"_). Read by the model after the call, in time to influence the next decision.
3. **Server-level `instructions`** — the MCP `initialize` handshake supports a top-level `instructions` string surfaced by compliant clients (Claude Code, Claude Desktop, Cursor) as system-level guidance before any tool call. Currently unused in `src/cli/mcp/server.ts:24` (`buildServer` passes only `capabilities: { tools: {} }`).

Most issues below want one or two of these layers. Build the layers once; reuse them.

### M2. Structured `warnings[]` on `CommandOutcome`

Add an optional `warnings: Array<{ code: string; message: string; path?: string }>` field to the CLI's `CommandOutcome` shape. The MCP layer surfaces it verbatim; CLI users can render it however they like. This gives every tool a place to attach soft feedback (_"unverified selector"_, _"title looks like title case"_, _"YouTube watch URL was auto-converted"_) without needing to fail the call.

### M3. CLI-side input normalization

Where a field has a known canonical form, normalize in the CLI runner instead of failing. Current pattern (fail → agent retries → maybe fixes it) wastes context. Better: normalize and emit a `warnings[]` entry telling the agent what was changed so it learns the canonical form for next time. Candidate normalizations: YouTube URL forms, trailing slashes on URLs, slug-ification of titles, whitespace trimming.

### M4. Selector catalog tool

A new MCP tool `pathfinder_lookup_selector` returning curated, known-good Grafana DOM selectors keyed by area (panel editor, explore, dashboard settings, alerting, etc.). Makes it cheap for agents to do the right thing instead of inventing selectors. Referenced from `pathfinder_authoring_start.discovery` and from any field that accepts a `reftarget`.

## Issue log

Append new findings here. Number sequentially. Do not renumber on removal — strike through and annotate.

### #1. Artifact corruption between calls

**Observed.** Agents subtly reformat the artifact between hops — a common variant is wrapping a markdown block's `content` string in an array because it "looks more structured." Schema validation on the next call fails generically (`SCHEMA_VALIDATION`), and the agent self-diagnoses as a schema misunderstanding rather than a round-trip discipline failure. Verbatim agent quote: _"The schema validation failed because I accidentally corrupted the markdown block's content field (passed array instead of string). I need to use the exact artifact returned from the previous step. Let me retry with the correct artifact."_

**Why this happens.** The `"Pass it in unchanged"` hint on the `artifact` input (`src/cli/mcp/tools/mutation-tools.ts:35`) is too weak to overcome a model's instinct to "clean up" structured input. The error message blames the schema, which compounds the misdirection.

**Candidate mitigations.**

- **Artifact ETag / fingerprint.** Hash `{content, manifest}` on every response, embed as `artifact.__etag`, and require the same hash on the next call. On mismatch, return a dedicated `ARTIFACT_MUTATED` error _before_ schema validation runs, with a remediation-shaped message: _"You modified the artifact between calls. Common cause: reformatting `content` fields. Send the artifact from the previous response byte-for-byte."_ Pinpoints the actual bug class.
- **Opaque handle.** Replace the round-tripped artifact with a server-issued token. Cleanest UX but breaks the explicit "stateless, no sessionId" property in `server.ts:8-12` and `authoring-start.ts:27`. Probably not worth it on its own; revisit only if combined with #5.
- **Sharper input description.** _"Echo the `artifact` object from the previous response verbatim. Do not re-serialize, reformat, re-key, or 'fix' any field — even fields that look wrong are valid CLI output."_ Pairs with the ETag.
- **Schema-error remediation hint.** When `SCHEMA_VALIDATION` fails on a field that was valid in the _prior_ artifact (recoverable from the request payload itself), prepend _"This field was valid in the artifact returned by the previous tool call — verify you echoed the artifact unchanged."_

**Recommendation.** ETag + sharper description. Turns a confusing class-of-bug into a one-line diagnosis without introducing server-side state.

### #2. YouTube watch links rejected

**Observed.** Video block requires embed URLs (`youtube.com/embed/<id>`). Agents commonly pass watch (`youtube.com/watch?v=ID`) or short (`youtu.be/ID`) URLs and round-trip through validation failure before correcting.

**Candidate mitigations.**

- **Auto-normalize in the CLI runner** (M3). `youtube.com/watch?v=ID`, `youtu.be/ID`, `youtube.com/shorts/ID` → `youtube.com/embed/ID`. Emit a `warnings[]` entry naming the conversion. Eliminates the round-trip; teaches canonical form.
- **Field-level schema description.** _"Must be a YouTube embed URL (`youtube.com/embed/<id>`). Watch (`/watch?v=`) and short (`youtu.be/`) URLs are auto-converted."_ — describes the contract and the safety net together.
- **Remediation-shaped error.** If normalization fails (non-YouTube URL, malformed), return `INVALID_VIDEO_URL` with the exact expected form: _"Got `<url>`. Expected `youtube.com/embed/<id>`."_

**Recommendation.** All three; auto-normalize is the load-bearing one.

### #3. `reftarget` (DOM selector) hallucination

**Observed.** Many block types use a `reftarget` field that is a CSS / DOM selector for a Grafana element. Agents will confidently invent selectors (`[data-testid="..."]`, `.gf-form`, etc.) without any verified knowledge of Grafana's DOM.

**Why this is the most dangerous issue.** The CLI cannot validate that a selector matches anything in the live Grafana DOM. Schema validation passes, the guide ships, the "Do it" button no-ops at runtime. Pure error-message remediation cannot catch this — the discouragement has to happen _before_ the field is ever written.

**Candidate mitigations.**

- **Block-type field description.** _"Verified DOM selector for a Grafana element. Do NOT invent or guess selectors. If you do not have explicit knowledge of Grafana's DOM (from `pathfinder_lookup_selector`, an interactive examples doc, or the user), choose one of: (a) use a `button` action with visible text matching, (b) write a markdown block describing the action instead, (c) ask the user for the selector. A wrong selector silently breaks the guide at runtime — the validator cannot catch this."_ Long, but this is the single most important hint in the whole tool surface.
- **Selector catalog tool** (M4). `pathfinder_lookup_selector { area }` returning known-good selectors. Make the right thing easy.
- **Server-level `instructions`** (M1). Single line: _"Never invent DOM selectors for `reftarget` fields. Use `pathfinder_lookup_selector` or ask the user."_ Reaches the model before tool selection.
- **Soft `UNVERIFIED_SELECTOR` warning** (M2) on every mutation that sets a `reftarget`. Doesn't block (the CLI cannot tell verified from invented), but flags it in-band so a careful agent self-corrects and gives reviewers something to grep for.

**Recommendation.** All four. This issue justifies M2 and M4 on its own.

### #4. Steps in multistep / guided blocks are unaddressable

**Observed.** Verbatim agent feedback: _"edit-block does not expose steps as a flag (it only covers named scalar fields), and steps carry no block ids so remove-block can't target them directly. The only path was cascade-remove the multistep and rebuild it — which the tool did automatically."_

**Why this happens.** `edit-block` (`src/cli/mcp/tools/mutation-tools.ts:121`) addresses fields by name on a block id, and steps within a multistep are not modeled as id-bearing blocks — they are an ordered array on the parent. There is no `parentId + stepIndex` addressing path on `edit-block` or `remove-block`.

**Candidate mitigations.**

- **Give steps block ids.** Most natural — matches the addressability model of every other container (section, conditional, quiz). Requires a small schema change and a migration story for existing artifacts. Likely the right answer if we are already touching the schema.
- **Index-based addressing.** Extend `edit-block` and `remove-block` to accept `parentId + stepIndex` (and analogously for quiz choices). No schema change, but two addressing modes coexisting is uglier and prone to off-by-one bugs after sibling reorders.
- **Status quo (cascade-and-rebuild).** Wastes context on every nontrivial edit and is error-prone for deep guides. Not viable long-term.

**Recommendation.** Give steps (and likely choices) block ids. Cleaner contract, single addressing model, matches what agents reach for first.

### #5. Hop-over-hop artifact growth

**Observed.** Verbatim agent feedback from a 22-hop nested-guide stress test: _"This took 22 sequential tool calls where every call re-ingested the entire artifact (no session state) ... by hop 22 the content field alone was ~3 KB, riding in both request and response on every call ... a guide with dozens of blocks and long markdown content would push well past the 1 MB MAX_REQUEST_BYTES ceiling."_

**Why this happens.** Statelessness is a load-bearing property of the server (`server.ts:8-12`, `authoring-start.ts:27`): every mutation tool accepts `{content, manifest}` in and returns `{content, manifest}` out. The artifact rides both directions on every call, growing with the guide. The `summary` TreeNode field already spares agents the re-parse on reads, but writes still require the full blob.

**Candidate mitigations.**

- **Optional server-side artifact handle.** A session token issued on `pathfinder_create_package`; subsequent tools accept either an artifact or a handle. Trades the stateless property for bandwidth and latency. Worth it past some size threshold; not worth it for typical guides.
- **JSON-Patch–style mutation protocol.** Agent sends ops (`{op: "add", path: "/blocks/3", value: {...}}`); server stores the artifact across the session and applies ops. More invasive than a handle, but composes naturally with operations agents already think in.
- **Compression on the HTTP transport.** Cheap mitigation that buys headroom without architectural change. Worth doing regardless.
- **Keep `summary` lean.** Already a best practice; revisit periodically as block types grow.

**Recommendation.** Compression now (cheap, no design tradeoffs). Defer handle / patch decision until a real guide hits the ceiling — the stateless property is currently load-bearing for several other design properties and should not be traded away quietly.

### #6. Deployment + log-inspection discoverability for future agents

**Observed.** The HTTP transport emits structured JSON access logs with rich telemetry per request (`bytesIn`, `bytesOut`, `tokensInEstimate`, `tokensOutEstimate`, `durationMs`, `outcome`, etc. — documented at `docs/developer/MCP_SERVER.md:158`). When testing whether a hardening fix has actually landed in the deployed environment, the right verification path is to drive the deployed MCP and inspect those logs. Today the deployed-environment breadcrumbs in the tracked tree are insufficient for an agent who has not been told where the server runs:

- The deploy script (`deploy-mcp.sh`) is `.gitignore`'d (the entry says _"Personal manual-deploy script for the MCP server. Hardcodes a project ID"_), so the GCP project, Cloud Run service name, region, and resulting URL never appear in tracked files.
- `MCP_SERVER.md` documents the log shape but does not say _where_ the logs live — no mention of Cloud Run, no `gcloud logging read` example, no pointer to who owns the project.
- `HOSTED-AUTHORING-MCP.md` describes the hosted-mode design abstractly but predates the actual deployment and does not name the runtime.

**Why this matters for hardening.** Every issue in this doc has a verification step that wants log inspection on the deployed instance ("did the `ARTIFACT_MUTATED` error fire?", "did the YouTube normalizer emit a warning?", "did `UNVERIFIED_SELECTOR` show up?"). A future agent picking up a hardening item will burn cycles rediscovering the deployment topology, or worse, will verify against a local stdio run and miss deploy-only regressions.

**Constraint.** Do **not** hard-code the project ID, service name, or URL into tracked code or docs — that information lives intentionally in the gitignored deploy script and is operator-specific.

**Candidate mitigations.**

- **Tracked deploy template.** Check in a `deploy-mcp.example.sh` (or `scripts/deploy-mcp.template.sh`) that shows the shape — `gcloud run deploy ...`, the env vars set, the region — with placeholders (`<YOUR_PROJECT_ID>`, `<YOUR_SERVICE_NAME>`) and a comment pointing operators to copy it to a gitignored `deploy-mcp.sh`. Gives a future agent the runtime model (Cloud Run, region pattern, log surface) without leaking specifics.
- **"How to inspect deployed logs" section in `MCP_SERVER.md`.** A short runbook: _"The HTTP transport is deployed to Google Cloud Run. To inspect logs for a recent test run, ask the operator for the project ID and service name (kept in the gitignored `deploy-mcp.sh`), then `gcloud logging read 'resource.type=cloud_run_revision AND resource.labels.service_name=<svc>' --limit=50 --format=json`. The structured JSON access log fields documented above appear under `jsonPayload`."_ Names the runtime, names the discovery path, gives the canonical query.
- **Verification breadcrumb in this doc.** Each issue's "candidate mitigations" implicitly assumes a verification step. Add a short _"How to verify on the deployed instance"_ section near the top of this doc that points at the runbook above so agents picking up hardening items see it on entry.
- **Deploy-script discoverability hint in repo root.** A one-line `README` or comment somewhere tracked (e.g. extending the `.gitignore` comment or adding to `docs/developer/MCP_SERVER.md`) saying _"deployment script is local-only at `deploy-mcp.sh`; ask the operator or check the example template."_ Closes the loop for an agent who finds the gitignore entry but no template.

**Recommendation.** Tracked deploy template + `MCP_SERVER.md` runbook section. Both are cheap, neither leaks specifics, and together they give a future agent enough breadcrumbs to (a) realize the server is on Cloud Run, (b) find the operator-specific details, and (c) know the canonical log query.

## Open questions

- **OQ1.** Is the right artifact-integrity primitive an ETag (server-side hash check) or a client-visible `__etag` field on the artifact (visible to the model, becomes part of the contract)? The first is invisible plumbing; the second is self-documenting but adds a field to every artifact.
- **OQ2.** Does giving steps block ids require a content-version bump and migration, or can existing artifacts auto-id on read? Depends on whether step ids are required or optional.
- **OQ3.** Where does the curated selector catalog live (M4)? Hand-maintained JSON in the repo, generated from interactive-example guides, or pulled from a Grafana-side source of truth? Affects how it stays current.
- **OQ4.** Should `warnings[]` (M2) be surfaced to CLI users as well (stderr line, `--format json` field) or MCP-only? CLI users would benefit, but it is a CLI contract change.
- **OQ5.** For #6, should the tracked deploy template be a `.example.sh` sibling (operator copies and edits) or a parameterized script that reads from `.env` / env vars (no copy step, but more moving parts)? The first is simpler and matches the existing personal-script pattern; the second is friendlier to multi-environment operators.

## Decision log

_(Empty until a planning phase picks items off this doc. Append decisions here with date and rationale.)_
