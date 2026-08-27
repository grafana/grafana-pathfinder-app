# Grafana App Platform publish handoff

> Part of [Pathfinder AI authoring](./PATHFINDER-AI-AUTHORING.md).
> Produced by [Pathfinder authoring MCP service](./HOSTED-AUTHORING-MCP.md) and consumed by [Client orchestration guide](./CLIENT-ORCHESTRATION-GUIDE.md).
> Viewer links are defined in [Viewer deep link contract](./VIEWER-DEEP-LINK-CONTRACT.md).

## Purpose

The publish handoff lets the Pathfinder authoring MCP prepare a completed guide for storage in a Grafana instance without itself performing the App Platform write.

The MCP service returns a machine-actionable App Platform resource payload and exact instructions. A Grafana-authorized client, such as Grafana Assistant, performs the final POST or PUT through the user's Grafana instance.

## Why handoff instead of direct write

Although the authoring MCP runs inside the Grafana plugin (see [Pathfinder authoring MCP service — Where it runs](./HOSTED-AUTHORING-MCP.md#where-it-runs)), it is an MCP server reachable by external clients and is responsible for authoring, not for executing writes against the App Platform on the user's behalf. Grafana Assistant, when running inside a user's Grafana context, has the authority needed to call private instance APIs and is the natural actor for the final write.

This split preserves the right boundaries:

- MCP service owns guide authoring and validation.
- Grafana Assistant owns instance-authenticated writes.
- App Platform owns instance-scoped persistence and authorization.
- The user owns the save/publish decision.

## Target resource

The current Pathfinder custom-guide storage target is an App Platform resource:

```json
{
  "apiVersion": "pathfinderbackend.ext.grafana.app/v1alpha1",
  "kind": "InteractiveGuide",
  "metadata": {
    "name": "hello-world-x7q2k1"
  },
  "spec": {
    "id": "hello-world-x7q2k1",
    "title": "Hello world",
    "schemaVersion": "1.1.0",
    "blocks": [],
    "status": "draft",
    "manifest": {
      "type": "guide",
      "repository": "interactive-tutorials"
    }
  }
}
```

`metadata.name` is the App Platform resource name and the key used by Pathfinder deep links. It must be stable after first publication. The auto-generated ID format `<kebab-of-title>-<random-suffix>` (see [Agent authoring CLI — `create`](./AGENT-AUTHORING.md#create)) makes resource names statistically unique within a namespace without requiring a pre-publish lookup.

## Handoff tool

The MCP service exposes a finalization tool named `pathfinder_finalize_for_app_platform`.

Inputs:

```json
{
  "artifact": { "content": { ... }, "manifest": { ... } },
  "status": "draft"
}
```

The artifact is passed in directly, matching the [stateless model](./AUTHORING-SESSION-ARTIFACTS.md#stateless-model) used by all authoring tools. There is no `sessionId`. There is no separate `resourceName` input — the App Platform resource name is taken from `artifact.content.id`, which is already kebab-shaped and validated by the CLI (see [Agent authoring CLI](./AGENT-AUTHORING.md#create) for the canonical ID format).

`status` defaults to `draft`. The client should use `published` only after explicit user confirmation.

## Handoff output

The tool returns structured fields, not only prose instructions:

```json
{
  "status": "ready",
  "id": "hello-world-x7q2k1",
  "title": "Hello world",
  "validation": {
    "isValid": true,
    "errors": [],
    "warnings": []
  },
  "appPlatform": {
    "apiVersion": "pathfinderbackend.ext.grafana.app/v1alpha1",
    "kind": "InteractiveGuide",
    "resource": "interactiveguides",
    "namespacePlaceholder": "{namespace}",
    "collectionPathTemplate": "/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/{namespace}/interactiveguides",
    "itemPathTemplate": "/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/{namespace}/interactiveguides/hello-world-x7q2k1",
    "createMethod": "POST",
    "updateMethod": "PUT"
  },
  "resource": {
    "apiVersion": "pathfinderbackend.ext.grafana.app/v1alpha1",
    "kind": "InteractiveGuide",
    "metadata": {
      "name": "hello-world-x7q2k1"
    },
    "spec": {
      "id": "hello-world-x7q2k1",
      "title": "Hello world",
      "schemaVersion": "1.1.0",
      "blocks": [],
      "status": "draft",
      "manifest": {
        "type": "guide",
        "repository": "interactive-tutorials"
      }
    }
  },
  "viewer": {
    "docParam": "api:hello-world-x7q2k1",
    "path": "/a/grafana-pathfinder-app?doc=api%3Ahello-world-x7q2k1",
    "floatingPath": "/a/grafana-pathfinder-app?doc=api%3Ahello-world-x7q2k1&panelMode=floating"
  },
  "clientGuidance": {
    "grafanaAppPlatform": {
      "appliesWhen": "Grafana-aware client running inside a Grafana instance with the Pathfinder backend aggregator enabled. If unsure, try this branch first; on a 404 from the collection POST, switch to grafanaOss.",
      "confirmationPrompt": "Publish guide \"Hello world\" to <namespace> as <status>?",
      "steps": [
        "Resolve the current Grafana namespace from your runtime config.",
        "Ask the user whether to save as draft or publish (default draft). Set resource.spec.status before writing.",
        "Show the confirmationPrompt copy and only proceed on explicit yes.",
        "POST resource to appPlatform.collectionPathTemplate (substitute {namespace}). Use appPlatform.createMethod (POST).",
        "If overwriting an existing resource (you passed an explicit --id at create): GET appPlatform.itemPathTemplate, copy metadata.resourceVersion, then PUT using appPlatform.updateMethod.",
        "On 2xx success, resolve viewer.floatingPath against the user's Grafana instance origin to produce an absolute URL and surface it. Do NOT surface a relative path."
      ],
      "errorHandling": [
        "404 on collection POST → switch to grafanaOss (CRD/aggregator not installed). No retry.",
        "403 → user lacks interactiveguides.create permission. Tell user, offer localExport. No retry.",
        "409 on PUT → stale resourceVersion. Re-GET, copy resourceVersion, confirm with user, retry once. Second 409 → offer localExport.",
        "5xx, network error, timeout → retry once with backoff, then offer localExport.",
        "Other 4xx → surface error verbatim, offer localExport. No retry."
      ]
    },
    "grafanaOss": {
      "appliesWhen": "Grafana-aware client without App Platform (OSS, or Cloud with the aggregator toggle off), or fall-through from grafanaAppPlatform on a 404.",
      "steps": [
        "Follow localExport instructions to write content.json and manifest.json.",
        "Tell the user where the files were written.",
        "Tell the user how to load these files later: open Pathfinder → block editor → Import → paste content.json or upload it.",
        "Do NOT surface the viewer link — it only resolves after a successful App Platform write."
      ]
    },
    "nonGrafanaClient": {
      "appliesWhen": "MCP client with no Grafana session (Cursor, Claude Desktop, CI). Cannot reach App Platform from here.",
      "steps": [
        "Do NOT attempt the App Platform write — there is no Grafana instance to write to.",
        "Follow localExport instructions to write content.json and manifest.json to the user's workspace.",
        "Tell the user where the files were written.",
        "Tell the user how to load these files later: open Pathfinder → block editor → Import → paste content.json or upload it.",
        "Do NOT surface the viewer link."
      ]
    }
  },
  "localExport": {
    "summary": "Fallback used by the grafanaOss and nonGrafanaClient branches to preserve the authored guide as files on disk that the user can later import via the block editor.",
    "files": [
      { "path": "<dir>/content.json", "source": "artifact.content" },
      { "path": "<dir>/manifest.json", "source": "artifact.manifest" }
    ],
    "instructions": [
      "Choose a directory the user can locate (project workspace, downloads folder, or a path the user names).",
      "Write artifact.content to <dir>/content.json and artifact.manifest to <dir>/manifest.json — both as pretty-printed JSON.",
      "Tell the user the directory you wrote to.",
      "Tell the user how to load these files into a Grafana instance later: open Pathfinder → block editor → Import → paste content.json or upload the file.",
      "Do NOT surface the viewer link from this response — it only resolves after a successful App Platform write, not for local-export."
    ]
  },
  "instructions": [
    "This response carries structured guidance under clientGuidance keyed by client capability. Pick the branch whose appliesWhen matches your environment:",
    "  - clientGuidance.grafanaAppPlatform: running inside Grafana with App Platform available.",
    "  - clientGuidance.grafanaOss: running inside Grafana without App Platform.",
    "  - clientGuidance.nonGrafanaClient: no Grafana session (Cursor, Claude Desktop, CI).",
    "If unsure, try grafanaAppPlatform first; on a 404 from the collection POST, fall through to grafanaOss."
  ]
}
```

The `id` field at the top level is the canonical package identifier — equal to `artifact.content.id`, `artifact.manifest.id`, `resource.metadata.name`, and the resource name embedded in `appPlatform.itemPathTemplate` and `viewer.docParam`. It is not transformed at any boundary. There is no separate `resourceName` field. Clients fill `metadata.namespace` into the `resource` object if the App Platform API requires it.

Auto-generated IDs include a random suffix (e.g., `hello-world-x7q2k1`) so collisions in the target App Platform namespace are statistically negligible. The "GET-before-POST" overwrite check is only required when the agent passed an explicit `--id` to intentionally update an existing guide; in the common auto-ID case, the POST creates a fresh resource without an existence check.

## Client guidance

The handoff carries three branches under `clientGuidance`, keyed by client capability. Each branch tells the agent what to do without making it self-classify from prose:

- **`grafanaAppPlatform`** — Grafana-aware client (e.g. Grafana Assistant) inside an instance with the Pathfinder backend aggregator enabled. Performs the App Platform write, then surfaces the absolute viewer URL. Carries a deterministic error-code → action table (404 → switch to `grafanaOss`; 403 → tell user, offer `localExport`; 409 on PUT → re-GET, confirm, retry once; 5xx/timeout → retry once, then `localExport`; other 4xx → surface verbatim, offer `localExport`). Carries a suggested sentence-cased `confirmationPrompt`.
- **`grafanaOss`** — Grafana-aware client without App Platform (OSS, or Cloud with the aggregator off), or fall-through from `grafanaAppPlatform` on 404. Skips the draft/published prompt, follows `localExport`, and points the user at the block-editor Import flow as the re-publish path.
- **`nonGrafanaClient`** — MCP client with no Grafana session (Cursor, Claude Desktop, CI). Never attempts the write. Follows `localExport` and surfaces the same block-editor Import path.

Optimistic concurrency on the update path matches the block editor: `resourceVersion` protects against clobbering concurrent edits. Auto-generated IDs (the common path, with random suffix) skip the overwrite check entirely — the POST creates a fresh resource without an existence query.

## Local-export fallback

If the client cannot reach App Platform, the `localExport` field tells the agent how to write the package to disk so the user can preserve and re-publish it. The `grafanaOss` and `nonGrafanaClient` branches both terminate here.

The viewer link in the response is **not** valid in either branch — the deep link resolves through the App Platform `InteractiveGuide` endpoint, which is exactly the path the fallback cannot use. The agent must suppress the viewer link and report the local file path instead.

The re-publish loop is the existing block-editor Import flow (`src/components/block-editor/ImportGuideModal.tsx`): a user can later open Pathfinder in any Grafana, open the block editor, click Import, and paste or upload the `content.json` to land the guide in that instance. The handoff names this path explicitly so the agent surfaces it to the user without inventing wording.

## Draft versus published

`draft` means the guide is saved to the instance but not visible in the Pathfinder docs panel. `published` means the guide is visible to users of that Grafana instance.

The default should be `draft` unless the user explicitly asks to publish. Client agents should not publish silently.

## Validation requirements

The MCP service must validate before returning `status: "ready"`. If validation fails, it should return `status: "invalid"` and omit the App Platform write payload or mark it unusable.

The Grafana-authorized client may also validate defensively before writing, but the MCP service is the primary authoring validation boundary.

## Manifest fields at publish

The authoring artifact is package-shaped — it carries a fully-formed `manifest.json` alongside `content.json` (see [Authoring artifacts — Artifact shape](./AUTHORING-SESSION-ARTIFACTS.md#artifact-shape)). The `InteractiveGuide` CRD now carries that manifest at `spec.manifest`, so the publish handoff projects it there rather than dropping it.

The CRD types a subset of the manifest, so the handoff projects rather than copies. This mirrors `build_manifest` in `scripts/upsert-learning-path.sh` — the other writer of `spec.manifest` — so both entry points put the same bytes on the wire:

- the CRD-typed keys verbatim: `type`, `repository`, `description`, `category`, `author` (`name` and `team` only), and `milestones` for the `path` and `journey` package types,
- `depends` widened from bare package IDs to CNF singleton clauses (`"grafana-basics"` becomes `["grafana-basics"]`),
- every remaining key — `language`, `startingLocation`, `targeting`, `recommends`, `suggests`, `provides`, `conflicts`, `replaces`, `schemaVersion`, and any author sub-key beyond `name`/`team` — swept into `additionalFields`, the CRD's escape hatch, so nothing authored is lost on the way in,
- fields that are absent, `null`, or empty are omitted rather than emitted as empty values.

`id` is deliberately not emitted: `metadata.name` already carries it.

`spec.type` is likewise not emitted. `type` describes the package, not the guide content, and the CRD declares no `spec.type` — sending it earns a prune-with-`Warning` response from the API server.

The projection lives in `src/cli/mcp/lib/crd-manifest.ts` and is exercised by `src/cli/mcp/lib/__tests__/crd-manifest.test.ts`.

Recommendation-engine parity for custom guides (so they can be surfaced contextually like the bundled guides) reads this data but is otherwise downstream of this design.

## Open questions

1. ~~What is the smallest change to the `InteractiveGuide` CRD that round-trips `manifest.json` data?~~ Resolved: the CRD carries it at `spec.manifest`, and the handoff projects the artifact's manifest into that field. See [Manifest fields at publish](#manifest-fields-at-publish).
2. Should clients always ask before overwriting an existing `InteractiveGuide` when the agent passes an explicit `--id`, or can some contexts opt into update-by-default?
3. Should the handoff include a source/provenance annotation once the App Platform resource schema supports it?
