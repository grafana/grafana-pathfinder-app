/**
 * Single source of trigger vocabulary for the Pathfinder authoring MCP.
 *
 * Three consumers read from this module:
 *
 * 1. `server-instructions.ts` composes the layer-3 `instructions` string the
 *    server emits on the MCP `initialize` handshake.
 * 2. `tools/authoring-start.ts` exposes `triggers`, `notFor`, and `domains`
 *    fields in the context payload so an agent that already entered the MCP
 *    can reaffirm its routing choice and pick up canonical user-facing
 *    phrasing.
 * 3. `lib/__tests__/server-instructions.test.ts` guards the vocabulary
 *    against regressions.
 *
 * Keeping the vocabulary in one place is what lets `_start.triggers` and
 * the server `instructions` stay in sync without copy-paste drift.
 *
 * **Evolution.** This vocabulary is hand-curated from observed agent
 * prompts in the issue log of [`MCP-AGENT-UX-HARDENING.md`](../../../../../docs/design/MCP-AGENT-UX-HARDENING.md).
 * The 2026-05-08 Grafana Assistant session (issue #7) and the 2026-05-12
 * Cursor session (slice 3 telemetry capture in the same doc) are the
 * canonical sources. Extend this list as new agent prompts come in from
 * production telemetry; do not rewrite from scratch.
 *
 * **Design rule for trigger phrases** (slice 3 — 2026-05-12): if a user
 * uses any write/edit/update/create/author/build verb around any
 * written-asset noun (content, guide, tutorial, walkthrough, how-to,
 * learning content), Pathfinder should be considered. The phrase list
 * below enumerates the high-leverage combinations; the verbs / nouns /
 * domains arrays give the model a vocabulary surface to match on for
 * variants we haven't listed verbatim.
 */

/**
 * Common phrases a user types to trigger Pathfinder authoring. The MCP layer
 * uses these in two places: surfaced verbatim in `pathfinder_authoring_start`
 * so an agent can reaffirm routing, and woven into the server-level
 * `instructions` string so MCP-aware clients see them before any tool call.
 */
export const PATHFINDER_TRIGGER_PHRASES: readonly string[] = [
  // Pathfinder-explicit phrases (original 8, kept as anchors).
  'create a pathfinder',
  'edit a pathfinder',
  'update a pathfinder guide',
  'publish a pathfinder',
  // Verb × asset-noun grid. Slice 3 expansion (2026-05-12): if a user uses
  // write/edit/update language around a written learning asset, the MCP
  // server should be considered. These are the high-leverage combinations
  // surfaced explicitly; the verbs/nouns arrays cover variants.
  'write a tutorial',
  'write a guide',
  'write content',
  'write a walkthrough',
  'author a tutorial',
  'author a guide',
  'author content',
  'author an interactive guide',
  'create a tutorial',
  'create a guide',
  'create content',
  'create an interactive guide',
  'build a tutorial',
  'build a walkthrough',
  'build a guide',
  'make a tutorial',
  'make a step-by-step guide',
  'make a how-to guide',
  'edit a tutorial',
  'edit a guide',
  'update a tutorial',
  'update a guide',
  'interactive tutorial',
  'how-to guide',
  'learning content',
  'training material',
];

/**
 * Use-case verbs the Pathfinder MCP handles. Surfaced in the server
 * `instructions` so non-trigger-phrase prompts (e.g. "I want to make a guide
 * that shows...") still route correctly via verb-pattern matching.
 */
export const PATHFINDER_USE_CASE_VERBS: readonly string[] = [
  'create',
  'author',
  'write',
  'build',
  'make',
  'edit',
  'update',
  'modify',
  'publish',
];

/**
 * Written-asset nouns the user is acting on when the Pathfinder MCP is the
 * right tool. Paired with the verbs above to give clients a vocabulary
 * surface that doesn't depend on the user typing one of the canonical
 * phrases verbatim. Slice 3 (2026-05-12) added the looser asset nouns
 * (`content`, `guide`, `how-to`, `learning content`, `training material`)
 * per operator direction — any write/edit verb on these should route.
 */
export const PATHFINDER_NOUNS: readonly string[] = [
  'Pathfinder',
  'interactive guide',
  'tutorial',
  'walkthrough',
  'step-by-step guide',
  'how-to',
  'how-to guide',
  'guide',
  'content',
  'learning content',
  'training material',
];

/**
 * Topic areas Pathfinder guides are commonly about. Surfaced in the server
 * `instructions` and in `_start.domains` so the model has explicit vocabulary
 * linking a Grafana product mention (e.g. "Prometheus data source") to the
 * Pathfinder routing decision. Added in slice 3 (2026-05-12) after
 * production telemetry showed prompts like "create a tutorial about
 * Prometheus" failed to route because the trigger words alone didn't carry
 * the connection between "tutorial" and Grafana surface area.
 */
export const PATHFINDER_DOMAINS: readonly string[] = [
  // Grafana Cloud / OSS LGTM stack
  'Prometheus',
  'Loki',
  'Tempo',
  'Mimir',
  'Pyroscope',
  'Beyla',
  'Alloy',
  'OpenTelemetry',
  'k6',
  // Grafana platform surface area
  'Grafana dashboards',
  'Grafana panels',
  'Grafana alerts',
  'Grafana data sources',
  'Grafana plugins',
  'Grafana navigation',
  'Grafana workspace setup',
  // Grafana product packaging
  'Grafana Cloud',
  'Grafana OSS',
  'Grafana Enterprise',
];

/**
 * Anti-routing signal: when a prompt matches these, Pathfinder is NOT the
 * right MCP. Surfaced in the server `instructions` so MCP-aware clients
 * route elsewhere instead of opening a fresh authoring artifact.
 */
export const PATHFINDER_NOT_FOR: readonly string[] = [
  'read-only documentation lookups',
  'dashboard queries',
  'general Grafana questions',
  'troubleshooting an existing Grafana setup',
  // Slice 3 disambiguation: "write a Prometheus query" is NOT Pathfinder;
  // "write a tutorial about Prometheus queries" IS. The noun in the user's
  // sentence is the deciding factor — `tutorial` / `guide` / `content`
  // routes here; `query` / `dashboard` / `alert rule` does not.
  'writing or debugging queries, dashboards, or alert rules themselves (this server is for tutorials *about* those things, not for authoring the things themselves)',
];
