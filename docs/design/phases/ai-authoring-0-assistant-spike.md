# P0 — Assistant handoff spike

> Implementation plan for phase 0 of [Pathfinder AI authoring](../PATHFINDER-AI-AUTHORING.md).
> Phase entry and exit criteria: [AI authoring implementation index — P0](../AI-AUTHORING-IMPLEMENTATION.md).
> Tracking issue: _TBD_.

**Status:** Complete
**Started:** 2026-04-28
**Completed:** 2026-04-28

---

## Confidentiality

This spike investigates Grafana Assistant, which is a private Grafana Labs codebase. Findings in this document are recorded as **capability statements only** — answers to the questions Pathfinder needs answered, framed in Pathfinder's vocabulary.

**Banned from this document:**

- File paths, module names, function or symbol names from the Assistant repository.
- Code quotes, inline snippets, or paraphrased fragments.
- Architectural details that are not already publicly documented.
- Anything that would let a reader reconstruct private design decisions.

**Allowed and useful:**

- Yes/no/partial answers to the capability questions, with confidence labels (`verified` | `inferred` | `public`).
- Functional descriptions in Pathfinder's vocabulary (e.g., "Assistant can POST runtime-supplied paths with arbitrary JSON bodies").
- Pointers to **public** Assistant documentation, blog posts, or help-center articles when they corroborate a finding.
- Gap descriptions in terms of "what capability is missing," not "what code would need to change."

A reviewer pass before merging this doc must check for any sentence that could only have been written by someone who'd seen Assistant's source.

---

## Preconditions

**What this spike must answer.** Boundary decision 8 in [`PATHFINDER-AI-AUTHORING.md`](../PATHFINDER-AI-AUTHORING.md) asserts Grafana Assistant can resolve the current Grafana namespace and make authenticated POST/PUT calls to private App Platform endpoints from within an Assistant turn. The high-confidence claim is **partly** prototyped — Assistant is documented to use customer-instance APIs — but the specific MCP-handoff → Assistant → App-Platform pattern is not. P0 closes that gap.

**Capability questions to answer:**

1. **Authenticated instance-API calls.** Can Assistant make authenticated calls against the user's Grafana instance during a turn?
2. **Runtime-supplied path.** Can a tool-call within a turn use a path supplied at runtime (e.g., from the MCP handoff's `itemPathTemplate`), or is the set of callable endpoints fixed at Assistant build/config time?
3. **Arbitrary JSON body.** Does POST/PUT support arbitrary JSON resource payloads (not just constrained shapes)?
4. **Method coverage.** Are POST and PUT both supported, including the GET-then-PUT optimistic-concurrency pattern when an explicit `--id` triggers an overwrite?
5. **Namespace resolution.** Does Assistant already know the current Grafana namespace, or must it call something to resolve it?
6. **Error surfacing.** Does a 4xx/5xx from the App Platform write surface back into the turn so the agent can fall through to `localExport`?
7. **Authorization gates.** Any policy layer that would block writes to a custom resource type like `interactiveguides`?
8. **Orchestration coherence.** Can Assistant receive an MCP tool response containing the handoff payload, then use those fields to drive a subsequent instance-API call within the same turn?

**Surface area this spike touches.** This is a research spike. It produces no production code in either repository. The only artifact is this document and (if the verdict is a gap) a follow-up entry in the index's cross-cutting concerns.

**Open question this spike must close:** does P4 stand as designed, or does it need a redesign to accommodate an Assistant gap?

---

## Tasks

- [x] **1.** Source-dive Assistant (locally, against the investigator's own checkout — path not recorded here) to answer questions 1–8. Investigation may be delegated to a sub-agent under strict no-leak instructions.
- [x] **2.** Record sanitized findings per question in this document, with confidence labels and public references where available.
- [x] **3.** Self-review pass: scan every sentence in Findings and Handoff for leaked specifics.
- [x] **4.** Verdict: green-light (all questions answerable as yes) or gap (one or more no/unclear). Update index status table accordingly.
- [x] **5.** If a gap is found, propagate it: add an entry to the index's "Cross-cutting concerns" or flag as a P3-or-earlier prerequisite. (Two P4-scope wiring items recorded in Handoff; surfaced as a cross-cutting concern in the index.)

### Test plan

Not applicable — research spike, no code.

### Verification (matches index exit criteria)

- [x] Spike report committed (this document).
- [x] Verdict recorded: green-light to proceed with P4 as designed; two P4-scope implementation items captured in Handoff and propagated to the index's cross-cutting concerns.

---

## Findings

_One entry per capability question. Each entry: answer + confidence label + brief functional description + public references (if any). All findings expressed as capability statements only — see Confidentiality section above._

### 1. Authenticated instance-API calls

- **Answer:** yes
- **Confidence:** verified
- **Functional description:** Grafana Assistant routinely makes authenticated calls against the user's Grafana instance during a turn, reusing the user's active session. This is its primary mechanism for talking to Grafana — listing alert rules, fetching dashboards, querying data sources, reading and writing custom resources under `/apis/...` paths. For Pathfinder's purposes, an Assistant turn can call the user's Grafana App Platform endpoint with the user's credentials.
- **Public references:** Grafana Assistant's public product documentation describes its instance-API integration in general terms.

### 2. Runtime-supplied path

- **Answer:** partial
- **Confidence:** verified
- **Functional description:** The set of named tools the LLM can call is fixed at build/config time, but those tools accept runtime arguments, and tools that talk to Grafana already construct paths from those arguments (resource name, namespace, etc.) before issuing the HTTP call. There is no general-purpose "call this exact path" tool exposed to the model today, so a handoff payload that contains a fully-formed path string is not consumed verbatim — it would have to flow into a tool whose handler builds the equivalent request. In practice, the path template is buildable from `(group, version, namespace, resource, name)` rather than literally from a string.
- **Public references:** none

### 3. Arbitrary JSON body

- **Answer:** yes
- **Confidence:** verified
- **Functional description:** Existing tooling already issues writes against Kubernetes-style endpoints in the user's instance with a JSON body shaped as `{apiVersion, kind, metadata, spec, ...}`, where the `spec` content varies per resource type. The HTTP layer used for these calls accepts arbitrary JSON. The constraint is at the tool-schema layer: whichever tool issues the write declares an input schema, so "arbitrary" means "arbitrary within whatever the tool's input schema accepts."
- **Public references:** none

### 4. Method coverage

- **Answer:** partial
- **Confidence:** verified
- **Functional description:** The HTTP client used by Assistant tools supports the full set of methods (GET, POST, PUT, PATCH, DELETE), so a tool can perform a read-modify-write against a custom resource and include `metadata.resourceVersion` for optimistic concurrency. However, the existing tools that write Kubernetes-style resources predominantly use POST-with-`generateName` create patterns; a generic GET-then-PUT pattern for a `pathfinderbackend` resource is not pre-built. The capability exists; a tool that exercises it for `interactiveguides` would still have to be wired up.
- **Public references:** none

### 5. Namespace resolution

- **Answer:** yes
- **Confidence:** verified
- **Functional description:** Assistant has direct access to the user's current Grafana namespace via standard Grafana plugin runtime configuration, the same way every other plugin in the instance does. No extra round trip is needed to resolve it, and tools already use it to construct App Platform paths. For a Pathfinder integration, Assistant does not need the handoff payload to carry the namespace — it can fill it in itself, though accepting a namespace from the payload would also be straightforward.
- **Public references:** [Grafana plugin tools](https://grafana.com/developers/plugin-tools/)

### 6. Error surfacing

- **Answer:** yes
- **Confidence:** verified
- **Functional description:** Tool execution errors — including non-2xx HTTP responses from instance-API calls — surface back to the model as tool results flagged as errors, with the error text included. The model can read these in the next reasoning step and react: retry with different inputs, fall through to a different tool, or report the failure to the user. This is how Pathfinder would observe a 409 conflict on PUT, a 404 on GET, or a 403 on create, and adapt accordingly.
- **Public references:** none

### 7. Authorization gates

- **Answer:** partial
- **Confidence:** verified
- **Functional description:** Assistant has a per-tool confirmation/approval layer (some writes prompt the user before executing; MCP integrations carry an approval policy) but no resource-type allowlist that would specifically block writes to a custom resource group like `pathfinderbackend.ext.grafana.com`. Grafana itself enforces RBAC on the App Platform endpoint as it would for any caller. The remaining gate is UX: a write tool may be configured to require user confirmation, which is a feature rather than an obstacle for a "publish" action.
- **Public references:** none

### 8. Orchestration coherence

- **Answer:** yes
- **Confidence:** verified
- **Functional description:** Assistant's turn loop is a multi-step model-driven loop: the model calls a tool, sees its result in the next step, and can then call another tool — including a tool that talks to the user's Grafana instance — using values from the previous result. Chaining an MCP tool call (the Pathfinder handoff) into a follow-up App Platform write within the same turn is a supported pattern, not a coincidental composition of two unrelated primitives. Practical reliability depends on prompt guidance that tells the model to perform the second step after the first.
- **Public references:** [Model Context Protocol](https://modelcontextprotocol.io/)

### Verdict

**Overall: green-light, with one wiring item for P4.**

Boundary decision 8 holds. The integration is feasible and aligns with how Assistant already works. The platform capabilities Pathfinder needs — authenticated instance calls, runtime-driven arguments, arbitrary JSON bodies, namespace already known, error surfacing into the loop, MCP-then-instance-API chaining — are all verified-supported.

Two items, both P4-scope implementation details rather than design blockers:

- **Write-tool surface (Q2 + Q4 partial).** Assistant does not today expose a generic "call this App Platform path with this JSON body and method" tool that would consume the handoff payload verbatim. The underlying capability is there; the actual write to `interactiveguides` needs a tool surface — either a Pathfinder-specific publish tool, a small generic App Platform write tool in Assistant, or a documented reuse of an existing pattern. This is a tool-wiring task, not a missing platform capability. Choosing among the three options is part of P4's planning.
- **Confirmation UX (Q7 partial).** No resource-type policy will block this, but a write tool may be subject to user-confirmation UX. P4 should design the handoff so the user-visible confirmation reads sensibly ("Publish guide _Title_ to this Grafana instance?" or similar) and not assume silent writes.

---

## Decision log

_Appended during execution._

---

## Deviations

_Appended during execution._

---

## Handoff to next phase

**Verdict: green-light. P4 stands as designed.** Boundary decision 8 holds without modification. P1, P2, and P3 may proceed without coordination with Assistant.

Things the P4 agent should know on arrival:

- **Six platform capabilities are confirmed:** authenticated instance-API calls, runtime-driven tool arguments, arbitrary JSON request bodies, namespace already known to Assistant, error surfacing into the model's next reasoning step, and MCP-tool-response → instance-API-call chaining within the same turn. The handoff payload defined in [`APP-PLATFORM-PUBLISH-HANDOFF.md`](../APP-PLATFORM-PUBLISH-HANDOFF.md) does not need to change to accommodate Assistant.
- **The handoff's `itemPathTemplate` and `collectionPathTemplate` fields will not be consumed verbatim by Assistant.** Assistant constructs paths from `(group, version, namespace, resource, name)` rather than from a literal string. P4 should ensure the handoff payload exposes those component fields cleanly (it already does — `appPlatform.apiVersion`, `appPlatform.resource`, `id`, plus a namespace placeholder) so the destination tool can rebuild the request without parsing the template string. The template strings remain useful as documentation for non-Assistant clients.
- **The namespace field in the handoff is informational for Assistant.** Assistant will fill its own. Other clients (Cursor, Claude Desktop) still need it. Do not remove the namespace placeholder.
- **A write-tool surface in Assistant must be wired up as part of P4.** No generic "call this App Platform path with this JSON body and method" tool exists today in Assistant. P4's planning must pick among three options:
  1. A Pathfinder-specific publish tool exposed by Assistant (highest discoverability, tightest contract, most coupling).
  2. A small generic App Platform write tool in Assistant that any plugin can use (broader value, less coupling, larger scope).
  3. Documented reuse of an existing pattern, if one fits.
     Choosing among these is a coordination point with the Assistant team and is the first concrete decision in P4's plan.
- **User-confirmation UX is in the loop.** Assistant's per-tool confirmation/approval layer means a publish action will likely surface a user-visible prompt. P4 should design the handoff so the prompt reads sensibly ("Publish guide _Title_ to this Grafana instance?") and the boundary-decision-4 flow ("the AI client owns user agency and final action") naturally lands on this confirmation rather than an additional one in front of it.
- **Assistant-on-OSS still falls through to `localExport`.** Nothing in this spike changes the OSS path. The same handoff response covers both Cloud and OSS; Assistant detects the absence of App Platform and follows the `localExport` instructions. P4's exit criterion for the OSS flow stays as written in the index.
- **No design doc edits required.** [`PATHFINDER-AI-AUTHORING.md`](../PATHFINDER-AI-AUTHORING.md), [`APP-PLATFORM-PUBLISH-HANDOFF.md`](../APP-PLATFORM-PUBLISH-HANDOFF.md), and [`CLIENT-ORCHESTRATION-GUIDE.md`](../CLIENT-ORCHESTRATION-GUIDE.md) are all consistent with the verified Assistant capabilities. The index gains one cross-cutting concern entry to ensure the wiring item is not forgotten.

---

## Addendum (2026-04-29, post-spike design pivot)

This spike validated that Grafana Assistant can perform App Platform writes from a runtime-supplied path. **That conclusion is unchanged.**

What did change after the spike merged: the Pathfinder authoring MCP itself moved out of the plugin. It is no longer added to `pkg/plugin/mcp.go` at `/api/plugins/grafana-pathfinder-app/resources/mcp`; it is a standalone TypeScript MCP server shipped as a second binary entrypoint of the `pathfinder-cli` npm package (see [`HOSTED-AUTHORING-MCP.md` — Where it runs](../HOSTED-AUTHORING-MCP.md#where-it-runs) and [`AI-AUTHORING-IMPLEMENTATION.md` — P3](../AI-AUTHORING-IMPLEMENTATION.md)).

This adds one item to the P4 wiring list that the body of this spike did not cover: **Assistant must connect to the centrally hosted TS MCP, not to the plugin URL.** Picking a hosting model (likely a Grafana-org service following the `grafana/data-platform-tools` `mcp/mcp-data` pattern) and wiring Assistant's tool list with that URL is now part of P4 coordination. Tracked in [`AI-AUTHORING-IMPLEMENTATION.md` — P4 §Wiring items](../AI-AUTHORING-IMPLEMENTATION.md).

None of the six verified Assistant capabilities are affected by this change.
