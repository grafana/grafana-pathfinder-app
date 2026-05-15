# MCP authoring server — agent UX hardening

> Part of [Pathfinder AI authoring](./PATHFINDER-AI-AUTHORING.md).
> Follow-up to [P3 — TypeScript MCP server](./phases/ai-authoring-3-ts-mcp.md).
> Related: [Hosted authoring MCP](./HOSTED-AUTHORING-MCP.md), [Authoring artifacts](./AUTHORING-SESSION-ARTIFACTS.md), [Agent authoring CLI](./AGENT-AUTHORING.md).

## Purpose

This is a living design doc that captures **functional feedback observed when real agents drive the `pathfinder-cli mcp` authoring server** and the proposed mechanisms to address it. It is the parking lot for "the server works, but agents misuse it in predictable ways" findings — items that are not P3 bugs and not P4 prerequisites, but that materially shape the agent authoring experience and should be swept into a future hardening phase.

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

**Status (2026-05-12).** Built in [slice 2 — integrity and normalize](./phases/mcp-hardening-2-integrity-and-normalize.md). The mechanism lives in `src/cli/utils/input-normalizers.ts` exposing `normalizeBlockInput(type, fields) → { normalized, warnings }`; the `INPUT_NORMALIZED` warning constructor sits alongside the existing helpers in `src/cli/utils/warnings.ts`. First consumer is the `video` branch (YouTube URL forms). Adding more normalizations means extending the dispatch in `input-normalizers.ts` — no runner-side changes needed.

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

**Status (2026-05-12).** Addressed in [slice 2 — integrity and normalize](./phases/mcp-hardening-2-integrity-and-normalize.md). Both load-bearing mitigations landed: every response now embeds `artifact.__etag` (SHA-256 over canonical-form `{content, manifest}`, truncated to 16 hex chars); every mutation tool verifies the echoed etag before dispatching and returns a dedicated `ARTIFACT_MUTATED` error with remediation-shaped text on mismatch. The artifact-input `.describe()` is sharpened to spell out the round-trip contract. OQ1 resolved — see slice 2 decision log. The opaque-handle alternative remains tracked under [P5 — GCS-backed authoring sessions](./AI-AUTHORING-IMPLEMENTATION.md#p5--deferred-follow-ups); slice 2 picks the cheapest fix that preserves statelessness.

### #2. YouTube watch links rejected

**Observed.** Video block requires embed URLs (`youtube.com/embed/<id>`). Agents commonly pass watch (`youtube.com/watch?v=ID`) or short (`youtu.be/ID`) URLs and round-trip through validation failure before correcting.

**Candidate mitigations.**

- **Auto-normalize in the CLI runner** (M3). `youtube.com/watch?v=ID`, `youtu.be/ID`, `youtube.com/shorts/ID` → `youtube.com/embed/ID`. Emit a `warnings[]` entry naming the conversion. Eliminates the round-trip; teaches canonical form.
- **Field-level schema description.** _"Must be a YouTube embed URL (`youtube.com/embed/<id>`). Watch (`/watch?v=`) and short (`youtu.be/`) URLs are auto-converted."_ — describes the contract and the safety net together.
- **Remediation-shaped error.** If normalization fails (non-YouTube URL, malformed), return `INVALID_VIDEO_URL` with the exact expected form: _"Got `<url>`. Expected `youtube.com/embed/<id>`."_

**Recommendation.** All three; auto-normalize is the load-bearing one.

**Status (2026-05-12).** Addressed in [slice 2 — integrity and normalize](./phases/mcp-hardening-2-integrity-and-normalize.md). The CLI runner now normalizes `youtube.com/watch?v=ID`, `youtu.be/ID`, and `youtube.com/shorts/ID` (plus missing-protocol and `m.youtube.com` tolerant variants) to the canonical `youtube.com/embed/ID` form before `assertCliBlockFields` runs. An `INPUT_NORMALIZED` warning rides on the outcome naming the rewrite verbatim so the agent learns the canonical form. The video.src schema description names the auto-conversion safety net. `assertEmbeddableVideoUrl` in `cli-validators.ts` keeps its branches as defense-in-depth (dead code for normalized inputs but live for any path that bypasses the runners). The 14-case normalizer test matrix in `src/cli/__tests__/input-normalizers.test.ts` is the regression guard. Slice 2 also builds **M3** (the input-normalization mechanism) which is reusable for future cases (trailing slashes, whitespace, slug-ification).

### #3. `reftarget` (DOM selector) hallucination

**Observed.** Many block types use a `reftarget` field that is a CSS / DOM selector for a Grafana element. Agents will confidently invent selectors (`[data-testid="..."]`, `.gf-form`, etc.) without any verified knowledge of Grafana's DOM.

**Why this is the most dangerous issue.** The CLI cannot validate that a selector matches anything in the live Grafana DOM. Schema validation passes, the guide ships, the "Do it" button no-ops at runtime. Pure error-message remediation cannot catch this — the discouragement has to happen _before_ the field is ever written.

**Candidate mitigations.**

- **Block-type field description.** _"Verified DOM selector for a Grafana element. Do NOT invent or guess selectors. If you do not have explicit knowledge of Grafana's DOM (from `pathfinder_lookup_selector`, an interactive examples doc, or the user), choose one of: (a) use a `button` action with visible text matching, (b) write a markdown block describing the action instead, (c) ask the user for the selector. A wrong selector silently breaks the guide at runtime — the validator cannot catch this."_ Long, but this is the single most important hint in the whole tool surface.
- **Selector catalog tool** (M4). `pathfinder_lookup_selector { area }` returning known-good selectors. Make the right thing easy.
- **Server-level `instructions`** (M1). Single line: _"Never invent DOM selectors for `reftarget` fields. Use `pathfinder_lookup_selector` or ask the user."_ Reaches the model before tool selection.
- **Soft `UNVERIFIED_SELECTOR` warning** (M2) on every mutation that sets a `reftarget`. Doesn't block (the CLI cannot tell verified from invented), but flags it in-band so a careful agent self-corrects and gives reviewers something to grep for.

**Recommendation.** All four. This issue justifies M2 and M4 on its own.

**Re-observed (2026-05-08).** Real Grafana Assistant testing reproduced this pattern in concert with #8 — the agent generated a 7-step `multistep` block with invented `reftarget` selectors on the steps that weren't `noop`. Confirms the mitigations above (description hardening, M2/M4 warnings + catalog, M1 layer 3) are still the right ones; this issue should be planned alongside #8, since both share the same root (no compositional opinionation) and the same mitigation surface in `pathfinder_authoring_start`.

**Status (2026-05-12).** Addressed in [slice 1 — routing and composition](./phases/mcp-hardening-1-routing-and-composition.md). Three of the four candidate mitigations landed (M4 selector catalog deferred to a later slice — see OQ3): the `reftarget` field `.describe()` text is hardened on all 4 schema sites (task 7); the same rule rides on layer 3 (server `instructions`, task 2), layer 2 (`_start.compositionRules`, task 5), and outcome-time (`UNVERIFIED_SELECTOR` warning fires on every write in `runAddBlock` / `runAddStep` / `runEditBlock`, task 8). The four-layer reinforcement is what closes this issue — no single layer is sufficient on its own, and the runtime cost still requires a verification round-trip the validator can't do.

### #4. Steps in multistep / guided blocks are unaddressable

**Observed.** Verbatim agent feedback: _"edit-block does not expose steps as a flag (it only covers named scalar fields), and steps carry no block ids so remove-block can't target them directly. The only path was cascade-remove the multistep and rebuild it — which the tool did automatically."_

**Why this happens.** `edit-block` (`src/cli/mcp/tools/mutation-tools.ts:121`) addresses fields by name on a block id, and steps within a multistep are not modeled as id-bearing blocks — they are an ordered array on the parent. There is no `parentId + stepIndex` addressing path on `edit-block` or `remove-block`.

**Candidate mitigations.**

- **Give steps block ids.** Most natural — matches the addressability model of every other container (section, conditional, quiz). Requires a small schema change and a migration story for existing artifacts. Likely the right answer if we are already touching the schema.
- **Index-based addressing.** Extend `edit-block` and `remove-block` to accept `parentId + stepIndex` (and analogously for quiz choices). No schema change, but two addressing modes coexisting is uglier and prone to off-by-one bugs after sibling reorders.
- **Status quo (cascade-and-rebuild).** Wastes context on every nontrivial edit and is error-prone for deep guides. Not viable long-term.

**Recommendation.** Give steps (and likely choices) block ids. Cleaner contract, single addressing model, matches what agents reach for first.

**Status (2026-05-12).** **Deferred pending telemetry.** This is an annoyance, not a correctness issue — first-pass authoring is unaffected; only mid-session step edits pay the cost (cascade-remove parent → re-add → re-add each step, ~9 tool calls vs. 1). Slices 1 and 2 closed the floor-raising issues (#3 selector hallucination silently broke guides at runtime; #7 routing prevented Assistant from invoking the MCP at all; #1 artifact corruption misdirected the diagnosis); #4 sits at "expensive workaround exists" rather than "broken." Re-evaluate after slices 1+2 ship to production and Grafana Assistant traffic reveals the real frequency of mid-session step edits. If telemetry shows the cascade-rebuild path is common, scope a slice around OQ2; if rare, the current state may be fine indefinitely. Decision rationale lives in the chat-of-record alongside [slice 2's PR](https://github.com/grafana/grafana-pathfinder-app/pull/870).

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

### #7. Agents don't reach for the authoring MCP without explicit prompt vocabulary

**Observed (2026-05-08).** Real Grafana Assistant use, prompt: _"can you create a short and simple pathfinder that shows how to use drilldown metrics with prometheus?"_ — Assistant did not invoke the MCP and instead "tried to show me around" with a generic explainer. Reproducible without explicit naming of "Pathfinder tools" in the prompt; routing flips when the user names them. Operator framing: _"Grafana Assistant may not have enough context about what the MCP server does or the tools do to know when to use which tool."_

**Why this happens.** Several layers conspire:

- Tool descriptions on the MCP side describe **behavior**, not **use case**. `pathfinder_create_package` reads _"Create a fresh authoring artifact (content.json + manifest.json) for a new guide"_ — the model has to translate that to "this is what runs when the user says create a pathfinder."
- The MCP server passes no `instructions` string in the `initialize` handshake. `buildServer` at `src/cli/mcp/server.ts:24` registers tools but emits no system-level positioning text. **M1 layer 3 is unused.**
- Grafana Assistant has many MCP servers / tools; routing is largely vocabulary matching. Without trigger vocabulary surfaced anywhere in the tool surface, the model has no signal to prefer Pathfinder over a generic answer.
- Cross-team: Assistant-side configuration (default-MCP-list ordering, skill files preloaded into the system prompt) also affects routing and is outside this MCP server's reach.

**Candidate mitigations.**

- **Reposition tool descriptions** to lead with use case. Example for `pathfinder_create_package`: _"Use this tool when the user wants to author or create an interactive Pathfinder guide, tutorial, or walkthrough. Returns a fresh content.json + manifest.json artifact for use as input to subsequent authoring tools."_ Same shift for `pathfinder_authoring_start`, `pathfinder_finalize_for_app_platform`, and the mutation tools.
- **Server-level `instructions`** (M1 layer 3) — one paragraph telling MCP-aware clients (Claude Code, Claude Desktop, Cursor, eventually Assistant) when to use this server. Covers trigger vocabulary: _"create a pathfinder", "write a tutorial", "build a walkthrough", "interactive guide", "step-by-step."_ Pair with one line on when NOT to use it (e.g. read-only docs lookups belong elsewhere).
- **`triggers` field in `pathfinder_authoring_start`** — list canonical user-facing verbs/nouns this MCP handles. Helps any agent that already invoked `_start` reaffirm its routing choice; also a natural source for the cross-team Assistant skill (next bullet).
- **Cross-team coordination with the Assistant team.** Capture as an open question: should the default Pathfinder MCP ship with an Assistant skill / preamble that primes Assistant on the vocabulary above? See OQ6.

**Recommendation.** MCP-side reposition + server `instructions` first; both are within this doc's scope and don't require Assistant-team coordination. Revisit the Assistant skill / default-list ordering question after observing whether MCP-side fixes alone close the routing gap.

**Status (2026-05-12).** Addressed in [slice 1 — routing and composition](./phases/mcp-hardening-1-routing-and-composition.md). All three layers of the hint surface now carry routing signal: layer 1 (every `registerTool` description rewritten to lead with _"Use this tool when the user wants to …"_, task 3), layer 2 (`triggers` and `notFor` arrays in `pathfinder_authoring_start`, task 4), layer 3 (`buildServer` now passes a non-empty `instructions` string on the `initialize` handshake, task 2). The trigger vocabulary lives single-source in `src/cli/mcp/lib/agent-routing.ts` so layers 2 and 3 cannot drift. The Assistant-team coordination point (default-MCP-list ordering / Assistant skill) is left open for re-evaluation after these MCP-side fixes ship.

**Telemetry (2026-05-12, slice 1 + 2 deployed to Cloud Run).** Real Cursor session against the deployed MCP — prompt _"Create a short interactive tutorial that shows how to add a Prometheus data source in Grafana"_ **did not route to Pathfinder.** Cursor gave a prose answer instead of invoking `pathfinder_authoring_start`. The user's words ("interactive tutorial", "Prometheus data source") were close to the trigger vocabulary but not literally on it; the layer-3 `instructions` text used a hedge-y "Use this server when …" opener that didn't override the model's default "just answer in prose" bias. This is the first hard data point showing slice 1's routing fix is necessary-but-not-sufficient.

**Status (2026-05-12, slice 3 complete).** Telemetry-driven follow-up landed as [slice 3 — routing telemetry response](./phases/mcp-hardening-3-routing-telemetry-response.md). Three changes: (1) trigger vocabulary expanded from 8 phrases to ~25, organized by the verb × asset-noun pattern — any write/edit/update/create/author/build verb + content/guide/tutorial/walkthrough/how-to/learning-content noun should route here; (2) layer-3 `instructions` opener rewritten as an assertive default — _"Default to using this server whenever the user asks to …"_ + _"Generic prose explanations should be a last resort, not the default response"_; (3) new `PATHFINDER_DOMAINS` vocabulary surfaces the Grafana product surface area (Prometheus, Loki, Tempo, Mimir, Beyla, Alloy, dashboards, alerts, data sources, panels, etc.) so product-area mentions carry routing signal even without canonical verbs.

**Re-test (2026-05-12, post-slice-3 deploy).** Three fresh Cursor prompts against the deployed MCP — three-for-three:

- _"I want to write content that walks a beginner through navigating to the Grafana data sources page."_ → Cursor invoked `pathfinder_authoring_start` as its first move. ✓ Routes.
- _"Put together a step-by-step walkthrough of setting up a Prometheus data source."_ → Cursor invoked `pathfinder_authoring_start` as its first move. ✓ Routes.
- _"Write a Prometheus query that returns the 95th percentile latency over the last 5 minutes."_ → Cursor answered with the PromQL inline; no Pathfinder tool calls. ✓ Correctly stayed out (anti-routing on the verb+noun disambiguation worked).

Routing thread closed for the MCP-side surface. The Level 3 escalation paths (Cursor client-config description / Assistant-team default-MCP-list coordination) outlined in the slice-3 design conversation are not needed for Cursor. Whether they're needed for Grafana Assistant specifically remains open until the deployed MCP is exercised in a real Assistant session.

### #8. Composition opinionation: agents default to multistep and noop without warrant

**Observed (2026-05-08).** Two related patterns from real Grafana Assistant testing, same session as #7:

- _"[an agent] generated a multistep block of 7 steps all noops."_ The agent reached for `multistep` with `action: noop` on every step — the action is the model's defensive fallback when it doesn't know what selector or button to invoke.
- _"Assistant seems to like to put everything into a multistep block, doesn't know to break out to 7 steps 1 each."_

Closely related to #3 — selector hallucination and noop-as-defense are two sides of the same coin (the agent is uncertain what to do interactively, and the schema accepts both invented selectors and noop steps).

**Why this happens.** The MCP exposes block types as a flat surface with no opinion about composition. `pathfinder_authoring_start` answers "what block types exist" and "what fields do they take" but not "how should I compose them for a typical guide." `multistep` is a first-class peer of every other type; no description discourages overuse. `noop` validates fine, so when the agent has nothing concrete for the user to do, it picks `noop` instead of writing markdown prose. The CLI is policy-free by design — it accepts anything schema-valid — and that policy-free posture is exactly what fails the agent here.

A body of authoring best-practices already exists in `grafana/interactive-tutorials` at [`.cursor/authoring-guide.mdc`](https://github.com/grafana/interactive-tutorials/blob/main/.cursor/authoring-guide.mdc), written for human authors. It is not currently surfaced through the MCP. The hardening work is **distillation**, not bulk inlining — the constraint is to give the agent enough opinion to compose well without clogging the context window with the full guide.

**Candidate mitigations.**

- **Distilled `compositionRules` section in `pathfinder_authoring_start`.** Source: the upstream `authoring-guide.mdc`. At minimum the rules to surface should include:
  - Prefer separate sibling blocks over `multistep` unless the steps are tightly coupled and must be completed in order.
  - Do not write `action: noop` steps as filler. If there's nothing concrete for the user to do, write a markdown block describing what they would do instead.
  - If you do not have a verified Grafana DOM selector for a `reftarget` field, do NOT write a step that requires one. Write a markdown block, use a `button` action with visible text matching, or ask the user. (Cross-references #3.)
- **Type-aware tool description.** When `pathfinder_add_block` is called with `type === 'multistep'`, append a one-line composition rule to the response — either as a `warning` (M2) or in the response `summary`: _"Use multistep only when steps are tightly coupled. For loose sequences, prefer separate sibling blocks."_
- **Server-level `instructions`** (M1 layer 3) — one composition sentence alongside the routing vocabulary from #7.
- **Best-practices propagation strategy.** Upstream lives in `grafana/interactive-tutorials` at `.cursor/authoring-guide.mdc`. Two options: (a) inline a distilled subset directly in `pathfinder_authoring_start` as static content; (b) ship a new MCP tool `pathfinder_authoring_best_practices` that returns the distilled text on demand (so context cost is paid only when the agent asks). Option (b) is more disciplined about context budget; option (a) is cheaper to maintain. See OQ7.
- Cross-references #3. The `UNVERIFIED_SELECTOR` warning there closes the noop-as-defense escape hatch from the other side: when the agent does write a step with a selector, it gets a soft warning; when it can't, the composition rules above tell it to write markdown instead. **#3 and #8 should be planned together.**

**Recommendation.** Distilled `compositionRules` section in `pathfinder_authoring_start` is the load-bearing fix; M1 layer 3 instructions and per-block-type description tightening are supporting work. **The hardest part is distillation discipline** — the upstream guide is rich, the agent's context budget is not. Plan this issue alongside #3 (selectors) and #7 (invocation routing); all three share the `pathfinder_authoring_start` payload as their primary mitigation surface.

**Status (2026-05-12).** Addressed in [slice 1 — routing and composition](./phases/mcp-hardening-1-routing-and-composition.md). The load-bearing fix landed: 11 distilled `compositionRules` in `pathfinder_authoring_start` (task 5), sourced from `grafana/interactive-tutorials` `.cursor/authoring-guide.mdc` via `gh api`, comfortably under the 15-rule budget. Supporting work also landed: the multistep / noop rule is restated at layer 3 (task 2), and `runAddBlock` now emits a `MULTISTEP_COMPOSITION_HINT` warning at outcome-time when a multistep block is appended (task 6) so the agent gets a reinforcing nudge even if it ignored the same rule in `_start`. OQ7 was decided to inline the rules in `_start` rather than ship a separate `pathfinder_authoring_best_practices` tool — see the slice's decision log.

## Open questions

- **OQ1. _Resolved 2026-05-12 (slice 2)._** Client-visible `__etag` on the artifact envelope (sibling to `content` and `manifest`). Invisible plumbing is impossible under the stateless contract — there is no per-call server state to remember the previous hash, so the agent must echo it back, which means the field must be on the wire. SHA-256 over canonical-form JSON, truncated to 16 hex chars. See the [slice's decision log](./phases/mcp-hardening-2-integrity-and-normalize.md#decision-log).
- **OQ2. _Deferred pending telemetry (2026-05-12)._** Three options were scoped (required ids + migration; additive optional ids + auto-id on read; index-based addressing). Picking the right one wants production data on how often agents actually need to mid-session-edit a step — speculation from a single observed session isn't enough. Re-open after slices 1+2 have run for a week or two of real Grafana Assistant traffic. See issue #4 Status note for the full rationale.
- **OQ3.** Where does the curated selector catalog live (M4)? Hand-maintained JSON in the repo, generated from interactive-example guides, or pulled from a Grafana-side source of truth? Affects how it stays current.
- **OQ4. _Resolved 2026-05-12 (slice 1)._** Surface in both — CLI text output (`Warnings:` block between `text` and `hints`, suppressed in `--quiet`) and `--format json` payload. MCP layer forwards verbatim. Additive `SuccessOutcome.warnings` field; no existing caller breaks. See the [slice's decision log](./phases/mcp-hardening-1-routing-and-composition.md#decision-log).
- **OQ5.** For #6, should the tracked deploy template be a `.example.sh` sibling (operator copies and edits) or a parameterized script that reads from `.env` / env vars (no copy step, but more moving parts)? The first is simpler and matches the existing personal-script pattern; the second is friendlier to multi-environment operators.
- **OQ6. _Resolved 2026-05-12 (slice 1)._** Hand-curated, single-source in `src/cli/mcp/lib/agent-routing.ts` (four readonly arrays: phrases, verbs, nouns, anti-routing). Three consumers read from it — `lib/server-instructions.ts`, `tools/authoring-start.ts`, and the lib-level unit tests. The starter list is curated from the 2026-05-08 Grafana Assistant session in issue #7; evolve with production telemetry. Cross-team coordination with the Assistant team remains open for default-MCP-list ordering. See the [slice's decision log](./phases/mcp-hardening-1-routing-and-composition.md#decision-log).
- **OQ7. _Resolved 2026-05-12 (slice 1)._** Inline the distilled subset in `pathfinder_authoring_start.compositionRules`. 11 rules shipped, comfortably under the 15-rule target. The separate-tool variant (`pathfinder_authoring_best_practices`) is preserved as a documented escape hatch in `authoring-start.ts` if the inline list grows past 20 rules in a future slice. See the [slice's decision log](./phases/mcp-hardening-1-routing-and-composition.md#decision-log).

## Decision log

### 2026-05-12 — Slice 1 (routing + composition + selector discipline)

Issues #3, #7, #8 picked up by [`phases/mcp-hardening-1-routing-and-composition.md`](./phases/mcp-hardening-1-routing-and-composition.md). 11 tasks shipped across 9 atomic commits prefixed `MCP-HARDEN-1:` (tasks 9–11 bundled into a single slice-exit commit). Cross-cutting plumbing built once: M1 layers 1+3, M2 `warnings[]`. Full decision log lives in the slice plan. Open questions resolved in the slice (linked to slice's decision log above): OQ4 (warnings visibility), OQ6 (trigger vocabulary source), OQ7 (best-practices distillation strategy). Deferred from this slice: M4 (selector catalog — depends on OQ3), issues #1 / #2 / #4 / #5 (independent fixes that compose cleanly on top of the M1+M2 plumbing this slice built), and the Assistant-team coordination point on broad rollout (issue #7 final paragraph).

### 2026-05-12 — Slice 2 (artifact integrity + input normalization)

Issues #1, #2 picked up by [`phases/mcp-hardening-2-integrity-and-normalize.md`](./phases/mcp-hardening-2-integrity-and-normalize.md). Built **M3** (CLI-side input normalization) as the third cross-cutting mechanism, reusable by future normalizers. New error code `ARTIFACT_MUTATED` and new warning code `INPUT_NORMALIZED` (registered in `docs/developer/MCP_SERVER.md`). Open questions resolved: **OQ1** (ETag visibility — forced by the stateless contract to be on-the-wire as `artifact.__etag`). Deferred from this slice: M4 (still blocked on OQ3), issues #4 / #5 (next conversations), the opaque-handle alternative for #1 (tracked under P5 GCS-sessions in `AI-AUTHORING-IMPLEMENTATION.md`). Slice plan's decision log captures two additional in-slice calls: keep `assertEmbeddableVideoUrl` as defense-in-depth, and surface `INPUT_NORMALIZED` warnings on idempotent no-ops too.
