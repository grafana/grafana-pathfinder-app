# Pathfinder authoring MCP service

> Part of [Pathfinder AI authoring](./PATHFINDER-AI-AUTHORING.md).
> Depends on [Agent authoring CLI](./AGENT-AUTHORING.md) and [Authoring artifacts](./AUTHORING-SESSION-ARTIFACTS.md).

## Purpose

The Pathfinder authoring MCP service is the endpoint that AI clients use to author Pathfinder guides. It exposes the current authoring context, deterministic guide-authoring tools, and a finalization tool that prepares artifacts for Grafana App Platform publishing.

The service is not a replacement for the AI client. The client still reasons about the user's goal, asks clarifying questions, and decides what content to create. The MCP service owns the Pathfinder-specific authoring contract and makes that contract discoverable at runtime.

## Where it runs

The authoring MCP service is a **standalone TypeScript MCP server** that lives in this repository at `src/cli/` and is exposed as the `mcp` subcommand of `pathfinder-cli`. The CLI and the MCP server share one `package.json#bin` target (`pathfinder-cli`) and one source tree and schema runtime — the MCP is just one more subcommand alongside `validate`, `create`, `e2e`, and the rest.

The MCP server **imports CLI commands as library functions**. There is no shell-out, no temporary directory, no `exec.Command`, no per-call Node startup. Every authoring tool call is a synchronous function call against the same Zod schemas the CLI uses.

The server runs in two deployment modes:

1. **Self-serve (stdio transport).** `npx pathfinder-cli mcp` or `docker run grafana/pathfinder-cli mcp` for Cursor, Claude Desktop, or any local MCP client. The MCP client owns the process; auth is the user's local trust boundary.
2. **Centrally hosted (HTTP transport).** The same code runs as a Cloud Run service that any MCP-capable client can reach over HTTPS — most importantly Grafana Assistant on Cloud, configured per-instance via [the Assistant MCP servers docs](https://grafana.com/docs/grafana-cloud/machine-learning/assistant/configure/mcp-servers/). Auth on the hosted endpoint is **open** — see [Authentication and authorization](#authentication-and-authorization) below for the rationale and the abuse-mitigation posture.

The hosted deployment lives behind an operator-local script (`deploy-mcp.sh` in this repo, gitignored). Project, region, service name, and resulting URL are operator-specific and intentionally not in tracked files. For deploy-time mechanics and log inspection on the running service, see [`docs/developer/MCP_SERVER.md`](../developer/MCP_SERVER.md).

This is a deliberate departure from an earlier draft of this design that placed authoring tools inside the existing Go plugin MCP at `/api/plugins/grafana-pathfinder-app/resources/mcp`. That earlier approach would have required shelling out from Go to a per-platform Node binary bundled inside the plugin tarball. Investigation found that the existing Go MCP was a dormant spike with no production callers, that the "ship in lockstep with the plugin" property it offered can be replaced by lockstep CI between the npm package and the plugin, and that the in-process TypeScript design is materially simpler — fewer build artifacts, no IPC, no per-call cold-start, and no class of bundled-binary failure modes. The Go MCP was eventually retired in full under MH5 (see [Relationship to existing plugin MCP tools](#relationship-to-existing-plugin-mcp-tools)).

### Authentication and authorization

**Any caller that reaches the MCP may call the authoring tools.** There is no role-based gate at the MCP layer, and the hosted HTTP transport ships open (`--allow-unauthenticated` on Cloud Run) per the [resolved P3 open question](./AI-AUTHORING-IMPLEMENTATION.md#does-the-hosted-http-mcp-need-auth-at-all). The authoring tool surface is stateless and produces no Grafana-instance side effects on its own — it returns artifacts. Publish authority is enforced **downstream**, at the App Platform write performed by the Grafana-authorized client (see [Grafana App Platform publish handoff](./APP-PLATFORM-PUBLISH-HANDOFF.md)). A viewer-role user whose client reaches `pathfinder_finalize_for_app_platform` and tries to PUT the resulting payload will be rejected by the App Platform API; the error surface is correct without an additional MCP-side check.

Auth strategy by transport:

- **Stdio.** No auth at the MCP layer. The MCP server runs as a child process of a local MCP client (Cursor, Claude Desktop) and trusts the local user. This is the same trust model every stdio-transport MCP server uses.
- **HTTP (hosted).** Open + edge-mitigated. The dominant threat is cost (DoS / runaway compute on a public CPU-bound endpoint), not compromise — the MCP holds no privileged resource. Mitigations are autoscaling ceilings, per-IP edge rate limits, request size caps, and CPU/wallclock budgets per call. None require an identity provider, which preserves the OSS / airgapped story. If usage patterns shift, adding a token verifier later does not change the tool surface.

Pathfinder is OSS, the authoring tools are publicly available on GitHub, and the agent's authority to write into a Grafana instance is delegated downstream through the App Platform path. There is no new identity provider, rate limiter, or tenant model introduced by the MCP layer itself.

### The MCP server does not write to App Platform — by deployment design

The MCP server is **deployed centrally** (a single Cloud Run service shared across all Grafana instances) and intentionally holds **no per-instance credentials**. The App Platform write is performed downstream by a Grafana-authorized client — Grafana Assistant, the block-editor Import flow, or a `kubectl`-style operator pipeline — using that client's own session against the user's Grafana instance.

This is a load-bearing property, not a phasing artifact:

- The MCP server has no path to obtain a token for an arbitrary Grafana instance. There is no service-account model that scales across customer tenancies, and bouncing user OAuth tokens through Cloud Run would introduce a credential surface this server is not designed to hold.
- Adding a write tool to the MCP would require either (a) per-instance token configuration shipped from each calling client (UX wart, security surface), (b) federated auth (substantial new work, off-roadmap), or (c) accepting the MCP-must-hold-credentials risk (rejected).
- The current split — MCP authors, the calling client writes — keeps the OSS / airgapped story intact and lets the hosted endpoint stay open + edge-mitigated rather than identity-gated.

When a calling client cannot perform the write itself (e.g. Grafana Assistant on Cloud today, which lacks a generic "call this App Platform path with this body" tool — see [`AI-AUTHORING-IMPLEMENTATION.md` — P4](./AI-AUTHORING-IMPLEMENTATION.md#p4--assistant-handoff-and-viewer-deep-link)), the resolution is to give that client a write capability, not to move the write into the MCP. Currently exercised resolutions: the block-editor Import flow (manual paste/upload of `content.json`) on every branch, and `localExport` on the OSS / non-Grafana paths.

## Server responsibilities

The service owns:

1. **Authoring context delivery.** Provide the minimal instructions a model needs to begin authoring and discover more details through tools.
2. **Tool discovery.** Expose MCP tools with machine-readable input schemas and clear descriptions.
3. **Deterministic mutation.** Route authoring operations through the imported `pathfinder-cli` command functions so guide state changes are schema-validating and repeatable.
4. **Inspection.** Let clients query an artifact without parsing raw JSON.
5. **Validation.** Run the canonical Pathfinder validation pipeline (in the CLI) and return structured errors.
6. **Finalization.** Produce a publish handoff artifact for Grafana App Platform and a viewer link contract.
7. **Version reporting.** Report authoring context version, supported schema version, and tool contract version (all derived from `CURRENT_SCHEMA_VERSION`).

The service does not own:

- Grafana instance write authority — those calls are made by the Grafana-authorized client (see [Client orchestration guide](./CLIENT-ORCHESTRATION-GUIDE.md)).
- Final user confirmation.
- Direct writes to private Grafana App Platform endpoints.
- Any schema knowledge of its own (see [Validation strategy](#validation-strategy) below).
- Server-side session state — _historical_. The MVP authoring surface shipped stateless (see [Authoring artifacts — Stateless model](./AUTHORING-SESSION-ARTIFACTS.md#stateless-model)). **Updated 2026-05-20 (P7):** server-side authoring sessions now layer on top via an opaque `sessionToken`, backed by GCS. Stateless `{artifact}` mode remains available on every mutation tool as an OSS / airgap fallback. See [P7 — GCS-backed authoring sessions](./phases/ai-authoring-7-gcs-sessions.md) for the contract and [`docs/developer/MCP_SERVER.md` — Sessions](../developer/MCP_SERVER.md#sessions) for the operator-facing summary.

## Validation strategy

The MCP server **performs no guide-content validation of its own** — it does preflight **argument shape** (`validateCommandArgs` checks each `opts` bag against the published `pathfinder_help` interface before any runner is called, rejecting withheld or unknown parameters rather than silently ignoring them), but all content validation lives in the `pathfinder-cli` command functions, which the MCP server imports directly from the same source tree (see [Agent authoring CLI — Distribution](./AGENT-AUTHORING.md#distribution)). The CLI's exported `runX` functions (in place since P1 — see [`phases/ai-authoring-1-cli-foundation.md`](./phases/ai-authoring-1-cli-foundation.md)) are designed to be importable and are exercised by the CLI test suite without subprocess invocation. The MCP server composes against the same surface.

Each authoring tool call follows this pattern:

1. The MCP server receives the tool call with the in-flight artifact or session token and mutation arguments.
2. The MCP tool dispatcher validates its tool-level contract, maps the call to the corresponding CLI command function (`create`, `add-block`, `edit-block`, `inspect`, etc.), and invokes it directly against the in-flight artifact.
3. The CLI command applies the mutation, validates the full package, and returns either the updated artifact or structured validation errors.
4. The MCP server returns the response to the caller.

There is no temporary directory, no JSON marshalling across an IPC boundary, no process spawn. **Per-call cost is a function call.**

This is what makes the design's core property hold end-to-end: **schema-illegal output is impossible because it is impossible in the CLI**, and the CLI is the only place schema knowledge lives. The MCP and CLI share a single TypeScript runtime, a single Zod schema instance, and ship in lockstep as one npm package — there is no IPC contract that could drift.

If batching multiple mutations into a single tool call ever becomes useful for clients (e.g., to avoid round-trips on large guides), [batch operations](./AGENT-AUTHORING.md#batch-operations) are already on the CLI roadmap. Unlike in the earlier shell-out design, batching here is purely a UX/throughput choice for clients; there is no Node cold-start to amortize.

## MCP surface

The first version prefers tools over optional MCP features because tool support is the most broadly available across clients. Prompts and resources can be added as progressive enhancement.

All authoring tools support two input modes (see [P7 — GCS-backed authoring sessions](./phases/ai-authoring-7-gcs-sessions.md)):

1. **Stateless `{artifact}`** — the original [stateless model](./AUTHORING-SESSION-ARTIFACTS.md#stateless-model): the in-flight artifact is passed in and returned out on every call. No server-side state. This remains the OSS / airgap fallback.
2. **Session-mode `{sessionToken}`** — `pathfinder_create_package` mints an opaque token; every subsequent call passes only the token and receives back an ack (no artifact body). The artifact lives in the server's in-memory session store and returns only at finalize, which then deletes the session. Recommended for the hosted deployment, which runs as a single always-on Cloud Run instance (see [MCP_SERVER.md](../developer/MCP_SERVER.md)).

The two modes are mutually exclusive per call (mixing returns `INPUT_MODE_AMBIGUOUS`). There is no `sessionId` in the historical sense — the session token is in tool args, not transport metadata.

### Core tools

| Tool                                   | Purpose                                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `pathfinder_authoring_start`           | **First tool.** Returns domain framing, workflow, discovery hints, and block-type names                                   |
| `pathfinder_help`                      | Translates any CLI command/subcommand help into the camelCase parameter interface imported runners receive                |
| `pathfinder_create_package`            | Runs CLI `create` from a help-derived `opts` bag and returns the initialized artifact                                     |
| `pathfinder_manage_block`              | Add, edit, or remove blocks, or append steps/choices, via a CLI-named `operation` plus an opaque, help-derived `opts` bag |
| `pathfinder_manage_guide`              | Guide-level writes; currently `operation: "set-manifest"` plus an opaque `opts` bag                                       |
| `pathfinder_read_session`              | MCP-native session reads with an explicit top-level Zod schema                                                            |
| `pathfinder_read_repository`           | MCP-native CDN reads with an explicit top-level Zod schema                                                                |
| `pathfinder_launch_package`            | Builds a shareable `?doc=` deep link for a published package (**partial** — see #855)                                     |
| `pathfinder_inspect`                   | Runs CLI `inspect` selectors from a help-derived `opts` bag against an artifact/session                                   |
| `pathfinder_validate`                  | Runs full package validation against an artifact and returns structured issues                                            |
| `pathfinder_finalize_for_app_platform` | Returns an `InteractiveGuide` resource payload, publish instructions, viewer link fields, and `localExport` fallback      |

`pathfinder_manage_guide` with `operation: "set-manifest"` is included in the MVP tool surface so AI authoring produces correctly-shaped manifest data inside the artifact. **For the MVP, manifest data is artifact-local and is stripped on the way to the App Platform CRD** — the `InteractiveGuide` resource only persists content-shaped fields, which is a CRD limitation that affects all custom guides (block-editor and AI alike), not an AI-authoring design choice. Round-trip persistence of manifest data is a future improvement that requires extending the CRD; see [Grafana App Platform publish handoff — Fields dropped at publish](./APP-PLATFORM-PUBLISH-HANDOFF.md#fields-dropped-at-publish-mvp).

#### Tool-surface design notes

- **Tree writes are grouped by resource capability.** `pathfinder_manage_block` combines the CLI tree commands under one tool via `operation: "add-block" | "edit-block" | "remove-block" | "add-step" | "add-choice"` (the CLI command name). `pathfinder_manage_guide` is the guide-level sibling; it currently exposes only `operation: "set-manifest"`. Apart from transport parameters (`artifact` / `sessionToken`), each tool schema contains only `operation` and an opaque `opts` bag. Addressing (`type`, `parent`, `branch`, `id`, `cascade`) and payload values all use the camelCase interface returned by `pathfinder_help`; the imported CLI runner owns operation-specific validation. Unsupported placement parameters are rejected rather than silently ignored (`ifAbsent` is supported — it is the retry-idempotency mechanism for agents). **Agent procedure is append-only:** new blocks, steps, and choices always append to their parent; there is no MCP `move` / insert-index / `orphanChildren` surface (CLI `--before`/`--after`/`--position`, `move-block`, and `--orphan-children` stay human/CLI power tools). To reorder or reshape, remove the addressable parent (with `cascade` when needed) and rebuild in display order.
- **`pathfinder_help` is the discovery surface.** Agents call it with any CLI command name (and optional subcommand) to get the parameter-level contract for a CLI-backed payload. For `pathfinder_manage_block` and `pathfinder_manage_guide`, pass `command` equal to `operation`; for `add-block`, choose a listed subcommand and pass that value as `opts.type`. The adapter reuses the CLI's Commander instances, including `Option.attributeName()` for the exact camelCase keys imported runners receive and `registeredArguments` for positional parameters. Translation is subtractive and configured where each MCP tool is bound: `optBlacklist` withholds unsupported/owned parameters. Agent-facing prose about a parameter lives in the CLI's own Commander description, so CLI users get it too and the projection carries it for free. Commands with no binding config publish their full surface, so new CLI capability reaches agents without an adapter change.
- **1:1 CLI tools use the same bag.** `pathfinder_create_package`, `pathfinder_inspect`, and `pathfinder_get_schema` place their CLI-owned parameters in `opts`; MCP transport/orchestration values such as `artifact` and `sessionToken` remain top-level. Each MCP binding maps its own bag onto the imported runner's arguments, leaving the CLI's Commander actions untouched.
- **MCP-owned contracts use explicit schemas.** A tool that does not expose a CLI command interface publishes a hard, top-level Zod schema and does not direct agents to `pathfinder_help`. This includes fully MCP-native tools (`pathfinder_read_session`, `pathfinder_read_repository`, `pathfinder_launch_package`, `pathfinder_finalize_for_app_platform`) and `pathfinder_validate`, which reuses the canonical validator but accepts an in-memory artifact rather than CLI `validate` options. These tools do not wrap their native parameters in `opts`. Tool modules mark this boundary with a file-level `Contract: mcp-native` comment.
- **The adapter replicates Commander's parse-time guarantees.** MCP reaches the runners without going through the parser, so `validateCommandArgs` enforces required positionals, mandatory options, the subcommand selector, and published value types before the runner is called. Commands that defer required-field reporting to a single Zod pass (`forceOptional`, notably `add-block`) register no mandatory options, so their multi-error reporting stays with the runner.
- **Known follow-up: dispatch is not yet Commander-driven.** Discovery already tracks the CLI (`pathfinder_help`, `optBlacklist`), and this slice packs operations into resource suites with opaque `opts`. Dispatch still names keys onto imported `runX` argument structs (`parent` → `parentId`, `id` → `explicitId`, …), so a new CLI flag consumed as a named runner arg still needs an MCP binding change. True pass-through would invoke the Commander program (in-process argv parse, or subprocess `pathfinder-cli --format json`) so MCP never names runner fields. That is deferred: `src/cli/index.ts` parses `process.argv` at import, and every authoring action calls `process.exit()`, so in-process dispatch cannot land without a behavior-preserving CLI refactor plus a characterization harness. Subprocess dispatch needs neither, at the cost of spawn latency.

### Optional tools

| Tool                                | Purpose                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------- |
| `pathfinder_export_package`         | Returns a downloadable package bundle or raw `content.json`/`manifest.json` |
| `pathfinder_get_authoring_examples` | Returns examples scoped to a block type or workflow                         |

## Authoring context

`pathfinder_authoring_start` is **the first tool an agent calls**. Its tool description in the MCP listing makes that role obvious (e.g., "Always call this first before authoring a Pathfinder guide"). It returns the few lines of context an agent needs to be useful, plus the discovery hints to learn anything else from the CLI on demand.

The response includes both human-readable instructions and structured fields:

```json
{
  "version": "1.1.0",
  "product": "Grafana Pathfinder is a Grafana plugin that runs interactive, contextual guides as a sidebar in Grafana. …",
  "triggers": ["create a pathfinder", "author a guide", "…"],
  "notFor": ["…"],
  "domains": ["Prometheus", "Loki", "…"],
  "workflow": [
    "1. Call pathfinder_help({ command: \"create\" }), then pathfinder_create_package with those parameters in `opts`. …",
    "2. Mutate the tree via pathfinder_manage_block with operation \"add-block\" | \"edit-block\" | \"remove-block\" | \"add-step\" | \"add-choice\" (CLI command names). Set guide metadata via pathfinder_manage_guide with operation \"set-manifest\". …",
    "3. Navigate by id using the `summary` tree returned on every ack. For deeper reads, call pathfinder_read_session …",
    "4. When you need the full artifact body in your context, call pathfinder_inspect …",
    "5. Call pathfinder_validate with {sessionToken} before finalize.",
    "6. Call pathfinder_finalize_for_app_platform with {sessionToken} to receive the publish handoff. …"
  ],
  "sessionMode": {
    "summary": "…",
    "ackShape": { "status": "…", "sessionToken": "…", "generation": "…", "summary": "…", "outcome": "…" },
    "rules": ["…"]
  },
  "statelessModeFallback": { "appliesWhen": "…", "rules": ["…"] },
  "rules": [
    "The CLI runners are the sole validator. …",
    "Block ids: pass an explicit `id` whenever `type` is a container …",
    "Append-only: …"
  ],
  "compositionRules": ["Prefer separate sibling blocks over a `multistep` block. …", "…"],
  "discovery": [
    "pathfinder_help — filtered CLI runner interfaces for mutation payloads. …",
    "pathfinder_read_session — MCP-native explicit schema. …",
    "pathfinder_inspect — escape hatch. …",
    "pathfinder_read_repository — MCP-native explicit schema. …"
  ]
}
```

The example above is abridged (`…` elides prose); the literal live shape is defined by `AUTHORING_CONTEXT` in `src/cli/mcp/tools/authoring-start.ts`, and a unit test asserts every tool name it references resolves in `tools/list`. This tool does not allocate a session — it returns context only. The client begins authoring by calling `pathfinder_create_package`, which mints a `sessionToken` and also returns a seed artifact for the stateless fallback. Prefer `{sessionToken}` on subsequent calls; use `{artifact}` only when sessions are unavailable.

Clients should prefer the workflow returned by `pathfinder_authoring_start` over any locally cached skill instructions, so authoring guidance evolves on the cadence of plugin releases without forcing client churn.

## Relationship to the CLI

There is no separate "MCP authoring engine." The CLI **is** the engine. The MCP server is a tool adapter: it maps each MCP tool call to one or more corresponding CLI command functions and returns the CLI's structured output. There is no parallel guide schema, validation, or block catalog.

When the schema evolves in `src/types/`:

- The CLI gains the new fields automatically through schema-driven option generation.
- MCP mutation tools accept those fields through their opaque `opts` bags, while `pathfinder_help` exposes the corresponding CLI parameter contract.
- No per-block-type MCP schema edits are required.

The adapter may group CLI commands under one MCP tool (`pathfinder_manage_block` uses `operation` values that are the CLI command names: `add-block` / `edit-block` / `remove-block` / `add-step` / `add-choice`; `pathfinder_manage_guide` currently uses `set-manifest`) or expose an MCP-only read surface. The CLI and the MCP still ship as a single npm package and cannot drift on guide schema, because they share a process and a Zod schema instance.

## Relationship to existing plugin MCP tools

The Pathfinder plugin's Go backend previously exposed a small MCP endpoint at `/api/plugins/grafana-pathfinder-app/resources/mcp` (`pkg/plugin/mcp.go`), inherited from PR #643. That endpoint is **gone as of MH5** — see [`docs/design/phases/mcp-hardening-5-retire-go-mcp.md`](./phases/mcp-hardening-5-retire-go-mcp.md). The five stateless tools (`list_guides`, `get_guide`, `get_guide_schema`, `validate_guide_json`, `create_guide_template`) migrated to this TS server under [MH4](./phases/mcp-hardening-4-go-mcp-migration.md); the remaining `launch_guide` tool and its per-instance pending-launch queue were dropped under MH5 once Grafana Assistant's web-surface handover (P4) made the per-tenant back-channel unused. The `/mcp` and `/mcp/pending-launch` routes now return 404.

Earlier drafts of this document framed `launch_guide` and the pending-launch queue as having "a genuine reason to remain in-process indefinitely" because they were coupled to per-instance frontend polling in `src/hooks/usePendingGuideLaunch.ts`. That framing is obsolete: the architecture pivoted to a single centrally hosted TS MCP on Cloud Run, the polling hook is gone, and the "open the published guide" leg is now served by `pathfinder_finalize_for_app_platform`'s viewer deep link plus the Assistant repo's `pathfinder_manage_guide_drafts` / `pathfinder_publish_guide` web-surface tools.

The authoring tools described in this document live exclusively in the TS MCP server, as do the CDN repository tools added under P6 (`pathfinder_read_repository` with `operation: "list-packages" | "get-package" | "get-manifest"`, plus `pathfinder_launch_package`; see [`AI-AUTHORING-IMPLEMENTATION.md` — P6](./AI-AUTHORING-IMPLEMENTATION.md#p6--cdn-repository-tools-ts-mcp)).

## Failure behavior

The server degrades in predictable ways:

- If validation fails, return structured validation issues and leave the last valid artifact unchanged (the artifact returned to the caller is the input artifact).
- If finalization fails, return the missing contract field, not a partial publish payload.
- If the current schema is incompatible with the requested artifact (for example, the client passed in an artifact authored at a newer schema version), return migration guidance.
- Transport-level failures (stdio pipe closed, HTTP 5xx) are the responsibility of the MCP transport layer and are surfaced to clients per MCP spec.

## Open questions

1. Should prompts/resources duplicate tool output, or only provide richer examples for clients that support them?
2. How should the server expose changelog information when authoring guidance changes between releases?
3. ~~Which Go-side runtime tools (`list_guides`, `get_guide`, `get_guide_schema`, `validate_guide_json`, `create_guide_template`) are worth migrating to the TS package, and on what trigger? `launch_guide` and the pending-launch queue stay in Go.~~ Resolved: the five stateless tools migrated under MH4; `launch_guide` and the pending-launch queue were retired entirely under MH5. There is no Go MCP anymore.
