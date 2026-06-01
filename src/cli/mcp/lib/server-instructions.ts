/**
 * MCP `initialize`-handshake `instructions` string for the Pathfinder
 * authoring server. Compliant MCP clients surface this text as system-level
 * guidance before any tool call — the only hint layer that reaches the
 * model before tool selection.
 *
 * Two rules-of-thumb are baked in here because they cause the costliest
 * agent failure modes (selector discipline and multistep / noop
 * composition), so they need to land before the agent picks a tool.
 */

import {
  PATHFINDER_DOMAINS,
  PATHFINDER_NOT_FOR,
  PATHFINDER_TRIGGER_PHRASES,
  PATHFINDER_USE_CASE_VERBS,
} from './agent-routing';

function joinList(items: readonly string[]): string {
  return items.map((s) => `"${s}"`).join(', ');
}

/**
 * Server-level instructions surfaced to MCP-aware clients on `initialize`.
 *
 * Length budget: ≤ 40 lines (enforced by unit test). If a future edit needs
 * more room, prefer extending `pathfinder_authoring_start` (paid once per
 * session, not per connect) over expanding this string.
 */
export const SERVER_INSTRUCTIONS: string = [
  'Pathfinder is a Grafana plugin that runs interactive, contextual guides inside the Grafana UI. This MCP server lets agents author and publish those guides.',
  '',
  // The first paragraph is the single most important sentence in this whole
  // string; it's what overrides the model's "just answer in prose" default.
  `**Default to using this server whenever the user asks to ${PATHFINDER_USE_CASE_VERBS.join(', ')} ANY interactive guide, tutorial, walkthrough, learning content, how-to, training material, or written instructional content — especially about Grafana products and surface area.** Generic prose explanations should be a last resort, not the default response. If the user's request can plausibly become an interactive Pathfinder guide, call \`pathfinder_authoring_start\` first and decide from there.`,
  '',
  `Common trigger phrases: ${joinList(PATHFINDER_TRIGGER_PHRASES.slice(0, 16))}, and similar variants. Pattern: any write/edit/update/create/author/build verb + any written-asset noun (content, guide, tutorial, walkthrough, how-to, learning material).`,
  '',
  `Common topic areas that route here: ${PATHFINDER_DOMAINS.join(', ')} — i.e. tutorials *about* these things. (Tutorials about Grafana products route here; authoring the products themselves — writing queries, building dashboards, configuring alerts — does NOT.)`,
  '',
  'Always call `pathfinder_authoring_start` first. It returns the schema version, workflow, composition rules, supported domains, and discovery hints you will need for every subsequent tool call.',
  '',
  // Session-mode primer. Reaches the model before tool selection so agents
  // do not default to threading full artifacts back through every mutation.
  // Detailed shape/rules live in `pathfinder_authoring_start`.
  'Authoring is session-token based. `pathfinder_create_package` mints a `sessionToken`; pass `{sessionToken}` on every subsequent mutation, read, and finalize call. Mutation responses are ACKS (`{sessionToken, generation, summary, outcome}`) — they do NOT include the artifact body. Use the `summary` tree for navigation; call `pathfinder_list_blocks` / `pathfinder_get_block` / `pathfinder_get_manifest_session` / `pathfinder_inspect` for explicit on-demand reads. The full artifact returns at `pathfinder_finalize_for_app_platform`, which then deletes the session. Stateless `{artifact}` mode is an OSS / airgap fallback — do not use it when a `sessionToken` is available.',
  '',
  'Two rules that bite agents in production — observe them before writing blocks:',
  '',
  '- Never invent or guess Grafana DOM selectors for a `reftarget` field. If you do not have a verified selector, write a markdown block describing the action, use a `button` action with visible text matching, or ask the user. A wrong selector silently breaks the guide at runtime — the validator cannot catch this.',
  '',
  '- Prefer separate sibling blocks over a `multistep` block. Use `multistep` only when the steps must be completed in order and are tightly coupled. Never write a step with `action: noop` as filler — if there is nothing concrete for the user to do, write a markdown block describing what they would do instead.',
  '',
  `When NOT to use this server: ${PATHFINDER_NOT_FOR.join('; ')}. Those belong on other MCP servers or in a direct answer.`,
].join('\n');
