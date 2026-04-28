# Pathfinder AI authoring

An end-to-end design for authoring Pathfinder guides with AI agents. The Pathfinder plugin's existing MCP endpoint exposes deterministic CLI-backed authoring tools, validates artifacts via the same `pathfinder-cli` that human authors use, returns a machine-actionable App Platform publish handoff, and provides deep links so users can immediately view generated guides.

## Problem

Pathfinder guides are structured, schema-governed artifacts. AI agents can help users author them, but raw JSON authoring asks the model to keep too much schema, block catalog, requirement syntax, and style guidance in context at once.

The [Agent authoring CLI](./AGENT-AUTHORING.md) addresses the deterministic authoring problem by making guide creation schema-driven and validate-on-write. The remaining design problem is distribution: how can any capable agent, including Grafana Assistant, author guides for storage in a Grafana instance without requiring every client to carry local skill files or keep authoring context up to date, and without forcing the plugin's Go backend to maintain a parallel copy of the schema?

## Design goal

Give an AI client an MCP endpoint that provides the current Pathfinder authoring context, exposes deterministic guide-authoring tools, validates the result through the canonical CLI, and returns a machine-actionable handoff artifact that a Grafana-authorized client can publish into the user's instance.

The authoring tools live inside the existing Pathfinder plugin MCP endpoint at `/api/plugins/grafana-pathfinder-app/resources/mcp` (`pkg/plugin/mcp.go`). They are not a separately hosted service. The Go endpoint performs no schema validation of its own — it shells out to a bundled `pathfinder-cli` Node binary that ships inside the plugin tarball and is built from the same TypeScript source as the public CLI Docker image. This collapses the drift problem the earlier draft of this design warned about: there is exactly one place schema knowledge lives, and it ships in lockstep with the plugin.

The MCP service does not perform App Platform writes itself. It returns publish instructions and a viewer link contract. A caller that has Grafana instance authority, such as Grafana Assistant, performs the final write.

## Component documents

| Component                            | Document                                                                  | Responsibility                                                                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI authoring tools                  | [Agent authoring CLI](./AGENT-AUTHORING.md)                               | Deterministic guide/package mutations, schema-driven help, validate-on-write, inspect, structured output, distribution as Docker image and bundled Node binary                         |
| Pathfinder authoring MCP service     | [Pathfinder authoring MCP service](./HOSTED-AUTHORING-MCP.md)             | Authoring tools added to the existing plugin MCP endpoint, validation via CLI shell-out, stateless tool surface                                                                        |
| Authoring artifacts                  | [Authoring artifacts](./AUTHORING-SESSION-ARTIFACTS.md)                   | Stateless artifact-as-wire-state model, durable IDs, validate-on-write, idempotency, finalization output                                                                               |
| Grafana App Platform publish handoff | [Grafana App Platform publish handoff](./APP-PLATFORM-PUBLISH-HANDOFF.md) | `InteractiveGuide` payload, POST/PUT instructions, draft/published status, manifest stripped at publish (CRD limitation), `localExport` fallback for non-Grafana-aware clients and OSS |
| Viewer deep link contract            | [Viewer deep link contract](./VIEWER-DEEP-LINK-CONTRACT.md)               | `doc=api:<id>`, `panelMode=floating`, link generation after publish                                                                                                                    |
| Client orchestration guide           | [Client orchestration guide](./CLIENT-ORCHESTRATION-GUIDE.md)             | How an AI client uses the MCP service, asks for confirmation, publishes through Grafana, and returns a link                                                                            |

## End-to-end flow

```
User
  asks an AI client to create a guide
    |
    v
AI client
  connects to the Pathfinder plugin MCP endpoint
  calls pathfinder_authoring_start (the "first tool") for context + tutorial
  calls pathfinder_help on demand for field-level details per block type
  calls deterministic authoring tools, passing the artifact in and out
    |
    v
Pathfinder plugin MCP (Go)
  shells out to bundled pathfinder-cli for every mutation
  performs no schema validation of its own
  returns the updated artifact (or structured validation errors)
  finalizes App Platform handoff on request — handoff includes localExport fallback
    |
    v
  +-------------------------------------------+--------------------------------+
  v                                           v                                v
AI client with Grafana authority         Non-Grafana-aware client        Assistant on Grafana OSS
  (e.g., Grafana Assistant on Cloud)        (Cursor, Claude Desktop)      (App Platform unavailable)
  asks user: draft or publish                follows handoff.localExport    follows handoff.localExport
  POSTs/PUTs InteractiveGuide                writes content.json +          writes content.json +
    to Grafana App Platform                    manifest.json locally          manifest.json locally
  returns Pathfinder deep link               reports file path              reports file path
                                              (no viewer link)               (no viewer link)
    |
    v
Pathfinder in Grafana
  resolves doc=api:<id>
  loads backend-guide:<id>
  renders the custom guide, preferably in floating mode
```

## Boundary decisions

1. **The CLI owns guide correctness.** All schema validation lives in `pathfinder-cli`. The plugin's Go MCP endpoint shells out to a bundled Node binary of the CLI for every authoring tool call and performs no validation of its own. The CLI is the single source of truth for the schema; both the public CLI Docker image and the bundled binary are built from the same TypeScript source. See [Agent authoring CLI — Distribution](./AGENT-AUTHORING.md#distribution) and [Pathfinder authoring MCP service — Validation strategy](./HOSTED-AUTHORING-MCP.md#validation-strategy).

2. **The MCP service owns server-delivered context.** The plugin can update prompts, examples, workflow hints, schema notes, and tool descriptions through normal plugin releases. Clients call `pathfinder_authoring_start` and follow server-provided instructions rather than carrying authoring guidance locally.

3. **Grafana owns instance-scoped persistence and authorization.** Guide storage means storage in a Grafana instance. App Platform `InteractiveGuide` resources are the publish target because they already provide stack-scoped persistence and authorization.

4. **The AI client owns user agency and final action.** The client decides, with user confirmation, whether to save as draft, publish, or discard. The MCP service prepares the artifact but does not silently write to a Grafana instance.

5. **A single canonical identifier flows from authoring to viewer link.** `content.id`, `manifest.id`, the package directory name, the App Platform `metadata.name`, and the `?doc=api:<id>` viewer link key are all the same kebab-case string with no transformation at any boundary. The CLI's Zod schema enforces the kebab format at authoring time so the same value is guaranteed to be a valid Kubernetes resource name. By default the CLI generates IDs of the form `<kebab-of-title>-<6-char-base32-suffix>` so collisions in the target App Platform namespace are statistically negligible without a pre-publish lookup. Agents can pass an explicit `--id` to overwrite an existing guide; that path is the only one where the publish step needs a "GET-before-POST" overwrite check. There is no separate `resourceName` field. See [Viewer deep link contract — Resource name requirement](./VIEWER-DEEP-LINK-CONTRACT.md#resource-name-requirement).

6. **The MVP authoring surface is stateless.** Tool calls take the artifact in and return the artifact out. There is no `sessionId`, no checkpoint counter, no server-side lifecycle. Idempotency comes from durable artifact IDs (the package `id` and per-block IDs the CLI auto-assigns). A stateful model can be layered in later if scale or UX needs demonstrate it. See [Authoring artifacts — Stateless model](./AUTHORING-SESSION-ARTIFACTS.md#stateless-model).

7. **Manifest data is stripped at publish for the MVP — but this is a CRD limitation, not an AI-authoring choice.** The artifact is package-shaped (content + manifest + assets), but the current `InteractiveGuide` CRD only persists content-shaped fields, and that limitation affects all custom guides (block-editor and AI alike). Authoring tools still produce correctly-shaped manifest data inside the artifact so that future CRD extension lights up persistence without changing the tool surface. Recommendation-engine parity for custom guides is downstream of CRD work, not of this design. See [Grafana App Platform publish handoff — Fields dropped at publish](./APP-PLATFORM-PUBLISH-HANDOFF.md#fields-dropped-at-publish-mvp).

8. **Grafana Assistant is the primary publish path, with `localExport` as the universal fallback.** Assistant can resolve the current Grafana namespace and make authenticated POST/PUT calls to private App Platform endpoints from within an Assistant turn — this is high-confidence based on Assistant's documented use of customer-instance APIs, though the specific MCP-handoff → Assistant → App-Platform pattern is unprototyped (see [Phase 0.5 spike](#phase-05-assistant-handoff-spike)). The handoff response also includes a `localExport` companion that any agent can follow to write `content.json` and `manifest.json` to a user-accessible directory when the App Platform path is unavailable. Three concrete cases land in `localExport`: non-Grafana-aware MCP clients (Cursor, Claude Desktop), Assistant on Grafana OSS (where App Platform is not available), and App Platform write failures. See [Grafana App Platform publish handoff — Local-export fallback](./APP-PLATFORM-PUBLISH-HANDOFF.md#local-export-fallback).

9. **Any authenticated Grafana identity can call the authoring MCP.** No role-based gate at the MCP layer. The authoring surface is stateless and produces no Grafana-instance side effects on its own; publish authority is enforced downstream at the App Platform write. See [Pathfinder authoring MCP service — Authentication and authorization](./HOSTED-AUTHORING-MCP.md#authentication-and-authorization).

## Phased delivery

### Phase 0.5: Assistant handoff spike

A short non-blocking spike to confirm Grafana Assistant can use a runtime-supplied endpoint (i.e., the path returned in `appPlatform.itemPathTemplate`) to perform an authenticated POST/PUT against the App Platform `interactiveguides` resource within an Assistant turn. Source-dive Assistant's existing instance-API integration to validate. If a gap is found, treat it as a Phase 3 prerequisite and resolve before committing to the full handoff design. This is the only currently-unprototyped piece of boundary decision 8.

### Phase 1: CLI foundation

Implement and test the authoring CLI described in [Agent authoring CLI](./AGENT-AUTHORING.md). The CLI must:

- Expose structured output suitable for MCP shell-out (`--format json` on every command).
- Enforce the canonical kebab-case `id` format in its Zod schema.
- Generate default IDs of the form `<kebab-of-title>-<6-char-base32-suffix>` when `--id` is omitted on `create`.
- Make `--help --format json` output a stability contract — its shape is part of the public CLI surface (see [Agent authoring CLI — `--help --format json` is a stability contract](./AGENT-AUTHORING.md#--help---format-json-is-a-stability-contract)).

The build pipeline produces both a Docker image and a single-file Node binary for `linux/amd64`, `linux/arm64`, and `darwin`. GitHub Actions builds the binaries as workflow artifacts on every merge to `main` and as durable GitHub Release assets on tagged releases. The plugin's `mage` build pulls the matching binary into `<plugin-dir>/cli/pathfinder-cli` for each backend platform variant.

### Phase 2: Authoring tools in the existing plugin MCP

Add authoring tools to the existing Go MCP endpoint at `/api/plugins/grafana-pathfinder-app/resources/mcp`. Bundle the `pathfinder-cli` Node binary inside the plugin tarball. Implement the stateless tool model: each authoring tool serializes the in-flight artifact, invokes the bundled CLI binary via `exec.Command`, and returns the structured response.

The MVP tool surface includes `pathfinder_authoring_start` (the documented "first tool" — returns workflow + tutorial + discovery hints), `pathfinder_help` (passes through `pathfinder-cli <cmd> [<sub>] --help --format json`), the mutation tools, `pathfinder_inspect`, `pathfinder_validate`, and `pathfinder_finalize_for_app_platform` returning both an App Platform path and a `localExport` fallback.

### Phase 3: Grafana Assistant handoff

Teach Grafana Assistant to use the handoff artifact to POST or PUT `InteractiveGuide` resources through the App Platform endpoint available in the user's instance, using the namespace-resolution and authenticated-write capabilities Assistant already has (see boundary decision 8). Assistant on OSS falls through to `localExport` since OSS lacks App Platform.

### Phase 4: Deep link return

Return `panelMode=floating` links after successful App Platform save or publish so the user can view the generated guide without manually navigating Pathfinder. Suppress the link when the path was `localExport`.

## Open questions

1. When the `InteractiveGuide` CRD is extended to carry manifest fields (round-tripping `description`, `depends`, `recommends`, `targeting`, etc.), what is the smallest change to the publish handoff projection that lights up persistence end-to-end? See [Grafana App Platform publish handoff — Open questions](./APP-PLATFORM-PUBLISH-HANDOFF.md#open-questions).
2. Should finalization support package export (downloadable `content.json` + `manifest.json` + assets) in addition to App Platform handoff?
3. If a future need for stateful authoring sessions emerges, what concrete signal triggers the transition? See [Authoring artifacts — Open questions](./AUTHORING-SESSION-ARTIFACTS.md#open-questions).
