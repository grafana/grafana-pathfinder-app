/**
 * Single source of trigger vocabulary for the Pathfinder authoring MCP.
 *
 * Two consumers read from this module:
 *
 * 1. `server-instructions.ts` composes the layer-3 `instructions` string the
 *    server emits on the MCP `initialize` handshake.
 * 2. `tools/authoring-start.ts` exposes a `triggers` field in the context
 *    payload so an agent that already entered the MCP can reaffirm its
 *    routing choice and pick up canonical user-facing phrasing.
 *
 * Keeping the vocabulary in one place is what lets task 4 in the hardening
 * slice (`_start.triggers`) and task 2 (server `instructions`) stay in sync
 * without copy-paste drift.
 *
 * **Evolution.** This starter list is hand-curated from observed agent
 * prompts in the issue log of [`MCP-AGENT-UX-HARDENING.md`](../../../../../docs/design/MCP-AGENT-UX-HARDENING.md).
 * The 2026-05-08 Grafana Assistant session in issue #7 is the canonical
 * source. Extend this list as new agent prompts come in from production
 * telemetry; do not rewrite from scratch.
 */

/**
 * Common phrases a user types to trigger Pathfinder authoring. The MCP layer
 * uses these in two places: surfaced verbatim in `pathfinder_authoring_start`
 * so an agent can reaffirm routing, and woven into the server-level
 * `instructions` string so MCP-aware clients see them before any tool call.
 */
export const PATHFINDER_TRIGGER_PHRASES: readonly string[] = [
  'create a pathfinder',
  'write a tutorial',
  'build a walkthrough',
  'author an interactive guide',
  'make a step-by-step guide',
  'edit a pathfinder',
  'update a pathfinder guide',
  'publish a pathfinder',
];

/**
 * Use-case verbs the Pathfinder MCP handles. Surfaced in the server
 * `instructions` so non-trigger-phrase prompts (e.g. "I want to make a guide
 * that shows...") still route correctly.
 */
export const PATHFINDER_USE_CASE_VERBS: readonly string[] = [
  'create',
  'author',
  'write',
  'build',
  'edit',
  'update',
  'modify',
  'publish',
];

/**
 * Nouns the user is acting on when the Pathfinder MCP is the right tool.
 * Paired with the verbs above to give clients a vocabulary surface that
 * doesn't depend on the user typing one of the canonical phrases verbatim.
 */
export const PATHFINDER_NOUNS: readonly string[] = [
  'Pathfinder',
  'interactive guide',
  'tutorial',
  'walkthrough',
  'step-by-step guide',
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
];
