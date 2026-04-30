# Pathfinder AI authoring

An end-to-end design for authoring Pathfinder guides with AI agents. A standalone TypeScript MCP server — shipped as a second entrypoint of the same npm package as `pathfinder-cli` — exposes deterministic authoring tools, validates artifacts via the same CLI commands human authors use (imported as library functions, no shell-out), returns a machine-actionable App Platform publish handoff, and provides deep links so users can immediately view generated guides.

## Problem

Pathfinder guides are structured, schema-governed artifacts. AI agents can help users author them, but raw JSON authoring asks the model to keep too much schema, block catalog, requirement syntax, and style guidance in context at once.

The [Agent authoring CLI](./AGENT-AUTHORING.md) addresses the deterministic authoring problem by making guide creation schema-driven and validate-on-write. The remaining design problem is distribution: how can any capable agent, including Grafana Assistant, author guides for storage in a Grafana instance without requiring every client to carry local skill files or keep authoring context up to date, and without standing up a second runtime that maintains a parallel copy of the schema?

## Design goal

Give an AI client an MCP endpoint that provides the current Pathfinder authoring context, exposes deterministic guide-authoring tools, validates the result through the canonical CLI, and returns a machine-actionable handoff artifact that a Grafana-authorized client can publish into the user's instance.

The authoring tools live in a **standalone TypeScript MCP server** under `src/cli/`, shipped as a second binary entrypoint (`pathfinder-mcp`) of the same npm package as `pathfinder-cli`. The MCP imports CLI command functions directly — no `exec.Command`, no temp directory, no IPC. Two TypeScript entrypoints share one Zod schema runtime, so there is exactly one place schema knowledge lives, and the CLI and MCP cannot drift. Deployment is either self-serve over stdio (`npx pathfinder-mcp` for Cursor/Claude Desktop) or centrally hosted over HTTP (for Grafana Assistant on Cloud); see [Pathfinder authoring MCP service — Where it runs](./HOSTED-AUTHORING-MCP.md#where-it-runs).

The MCP service does not perform App Platform writes itself. It returns publish instructions and a viewer link contract. A caller that has Grafana instance authority, such as Grafana Assistant, performs the final write.

## Component documents

| Component                            | Document                                                                  | Responsibility                                                                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI authoring tools                  | [Agent authoring CLI](./AGENT-AUTHORING.md)                               | Deterministic guide/package mutations, schema-driven help, validate-on-write, inspect, structured output, distribution as npm package and Docker image                                 |
| Pathfinder authoring MCP service     | [Pathfinder authoring MCP service](./HOSTED-AUTHORING-MCP.md)             | Standalone TS MCP server (sibling entrypoint to `pathfinder-cli`), imports CLI commands as library functions, stateless tool surface                                                   |
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
  connects to the Pathfinder authoring MCP (stdio or HTTPS, depending on client)
  calls pathfinder_authoring_start (the "first tool") for context + tutorial
  calls pathfinder_help on demand for field-level details per block type
  calls deterministic authoring tools, passing the artifact in and out
    |
    v
Pathfinder authoring MCP (TypeScript)
  imports pathfinder-cli command functions directly (no shell-out, no IPC)
  performs no schema validation of its own — the CLI is the validator
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

1. **The CLI owns guide correctness.** All schema validation lives in `pathfinder-cli`. The TS MCP server imports CLI command functions directly — no shell-out, no IPC, no separate runtime. The CLI and MCP are two binary entrypoints of the same npm package and share one Zod schema runtime, so they cannot drift. See [Agent authoring CLI — Distribution](./AGENT-AUTHORING.md#distribution) and [Pathfinder authoring MCP service — Validation strategy](./HOSTED-AUTHORING-MCP.md#validation-strategy).

2. **The MCP service owns server-delivered context.** The plugin can update prompts, examples, workflow hints, schema notes, and tool descriptions through normal plugin releases. Clients call `pathfinder_authoring_start` and follow server-provided instructions rather than carrying authoring guidance locally.

3. **Grafana owns instance-scoped persistence and authorization.** Guide storage means storage in a Grafana instance. App Platform `InteractiveGuide` resources are the publish target because they already provide stack-scoped persistence and authorization.

4. **The AI client owns user agency and final action.** The client decides, with user confirmation, whether to save as draft, publish, or discard. The MCP service prepares the artifact but does not silently write to a Grafana instance.

5. **A single canonical identifier flows from authoring to viewer link.** `content.id`, `manifest.id`, the package directory name, the App Platform `metadata.name`, and the `?doc=api:<id>` viewer link key are all the same kebab-case string with no transformation at any boundary. The CLI's Zod schema enforces the kebab format at authoring time so the same value is guaranteed to be a valid Kubernetes resource name. By default the CLI generates IDs of the form `<kebab-of-title>-<6-char-base32-suffix>` so collisions in the target App Platform namespace are statistically negligible without a pre-publish lookup. Agents can pass an explicit `--id` to overwrite an existing guide; that path is the only one where the publish step needs a "GET-before-POST" overwrite check. There is no separate `resourceName` field. See [Viewer deep link contract — Resource name requirement](./VIEWER-DEEP-LINK-CONTRACT.md#resource-name-requirement).

6. **The MVP authoring surface is stateless.** Tool calls take the artifact in and return the artifact out. There is no `sessionId`, no checkpoint counter, no server-side lifecycle. Idempotency comes from durable artifact IDs (the package `id` and per-block IDs the CLI auto-assigns). A stateful model can be layered in later if scale or UX needs demonstrate it. See [Authoring artifacts — Stateless model](./AUTHORING-SESSION-ARTIFACTS.md#stateless-model).

7. **Manifest data is stripped at publish for the MVP — but this is a CRD limitation, not an AI-authoring choice.** The artifact is package-shaped (content + manifest + assets), but the current `InteractiveGuide` CRD only persists content-shaped fields, and that limitation affects all custom guides (block-editor and AI alike). Authoring tools still produce correctly-shaped manifest data inside the artifact so that future CRD extension lights up persistence without changing the tool surface. Recommendation-engine parity for custom guides is downstream of CRD work, not of this design. See [Grafana App Platform publish handoff — Fields dropped at publish](./APP-PLATFORM-PUBLISH-HANDOFF.md#fields-dropped-at-publish-mvp).

8. **Grafana Assistant is the primary publish path, with `localExport` as the universal fallback.** Assistant can resolve the current Grafana namespace and make authenticated POST/PUT calls to private App Platform endpoints from within an Assistant turn — this is high-confidence based on Assistant's documented use of customer-instance APIs, though the specific MCP-handoff → Assistant → App-Platform pattern is unprototyped (see [Phase 0.5 spike](#phase-05-assistant-handoff-spike)). The handoff response also includes a `localExport` companion that any agent can follow to write `content.json` and `manifest.json` to a user-accessible directory when the App Platform path is unavailable. Three concrete cases land in `localExport`: non-Grafana-aware MCP clients (Cursor, Claude Desktop), Assistant on Grafana OSS (where App Platform is not available), and App Platform write failures. See [Grafana App Platform publish handoff — Local-export fallback](./APP-PLATFORM-PUBLISH-HANDOFF.md#local-export-fallback).

9. **No role-based gate at the MCP layer.** The authoring surface is stateless and produces no Grafana-instance side effects on its own; publish authority is enforced downstream at the App Platform write. Auth strategy depends on the MCP transport: stdio mode trusts the local user (the MCP server runs as a child process of the user's MCP client); HTTP/hosted mode uses the Grafana MCP token-verifier pattern. See [Pathfinder authoring MCP service — Authentication and authorization](./HOSTED-AUTHORING-MCP.md#authentication-and-authorization).

## Phased delivery

### Phase 0.5: Assistant handoff spike

A short non-blocking spike to confirm Grafana Assistant can use a runtime-supplied endpoint (i.e., the path returned in `appPlatform.itemPathTemplate`) to perform an authenticated POST/PUT against the App Platform `interactiveguides` resource within an Assistant turn. Source-dive Assistant's existing instance-API integration to validate. If a gap is found, treat it as a Phase 3 prerequisite and resolve before committing to the full handoff design. This is the only currently-unprototyped piece of boundary decision 8.

### Phase 1: CLI foundation

Implement and test the authoring CLI described in [Agent authoring CLI](./AGENT-AUTHORING.md). The CLI must:

- Expose CLI commands as importable library functions (`runX` exports) so the MCP server can compose against the same surface the CLI test suite already exercises.
- Provide structured output (`--format json` on every command) for direct command-line and CI use.
- Enforce the canonical kebab-case `id` format in its Zod schema.
- Generate default IDs of the form `<kebab-of-title>-<6-char-base32-suffix>` when `--id` is omitted on `create`.
- Make `--help --format json` output a stability contract — its shape is part of the public surface consumed by both human users and the MCP `pathfinder_help` tool (see [Agent authoring CLI — `--help --format json` is a stability contract](./AGENT-AUTHORING.md#--help---format-json-is-a-stability-contract)).

### Phase 2: Distribution

Publish the npm package (`pathfinder-cli`) with two binary entrypoints — `pathfinder-cli` and `pathfinder-mcp` — and a Docker image (`grafana/pathfinder-cli`) wrapping the same package. There is no per-platform single-file binary, no Node SEA / `pkg` step, and no plugin-tarball bundling. The plugin and the MCP package are coordinated through CI but published independently. See [Agent authoring CLI — Distribution](./AGENT-AUTHORING.md#distribution).

### Phase 3: TypeScript MCP server

Build the standalone TS MCP server under `src/cli/` (sibling to the CLI entrypoint). Tool dispatchers map each authoring tool call to the corresponding imported CLI command function — no shell-out, no temp directory, no IPC. Implement the stateless model: tool calls take the artifact in and return the artifact out.

The MVP tool surface includes `pathfinder_authoring_start` (the documented "first tool" — returns workflow + tutorial + discovery hints), `pathfinder_help` (composes the same `--help --format json` surface the CLI exposes, as a function call), the mutation tools, `pathfinder_inspect`, `pathfinder_validate`, and `pathfinder_finalize_for_app_platform` returning both an App Platform path and a `localExport` fallback.

The server supports two transports from the same code: stdio (for Cursor/Claude Desktop and other local MCP clients) and HTTP (for centrally hosted deployments — primarily Grafana Assistant on Cloud, fronted by the Grafana MCP token-verifier pattern). The existing Go MCP at `/api/plugins/grafana-pathfinder-app/resources/mcp` is unchanged.

### Phase 4: Grafana Assistant handoff

Teach Grafana Assistant to use the handoff artifact to POST or PUT `InteractiveGuide` resources through the App Platform endpoint available in the user's instance, using the namespace-resolution and authenticated-write capabilities Assistant already has (see boundary decision 8). Assistant on OSS falls through to `localExport` since OSS lacks App Platform. Assistant connects to the centrally hosted TS MCP (Phase 3), not to the plugin URL.

### Phase 5: Deep link return

Return `panelMode=floating` links after successful App Platform save or publish so the user can view the generated guide without manually navigating Pathfinder. Suppress the link when the path was `localExport`.

## Open questions

1. When the `InteractiveGuide` CRD is extended to carry manifest fields (round-tripping `description`, `depends`, `recommends`, `targeting`, etc.), what is the smallest change to the publish handoff projection that lights up persistence end-to-end? See [Grafana App Platform publish handoff — Open questions](./APP-PLATFORM-PUBLISH-HANDOFF.md#open-questions).
2. Should finalization support package export (downloadable `content.json` + `manifest.json` + assets) in addition to App Platform handoff?
3. If a future need for stateful authoring sessions emerges, what concrete signal triggers the transition? See [Authoring artifacts — Open questions](./AUTHORING-SESSION-ARTIFACTS.md#open-questions).
