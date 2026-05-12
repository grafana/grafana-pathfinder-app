/**
 * MCP `initialize`-handshake `instructions` string for the Pathfinder
 * authoring server (M1 layer 3 — see
 * [`MCP-AGENT-UX-HARDENING.md`](../../../../../docs/design/MCP-AGENT-UX-HARDENING.md)).
 *
 * Compliant MCP clients (Claude Code, Claude Desktop, Cursor, Grafana
 * Assistant via per-instance MCP config) surface this text as system-level
 * guidance before any tool call. It is the only hint layer that reaches the
 * model before tool selection — layer 1 (`description`) requires the model
 * to be considering this server already; layer 2 (response `warnings[]`) is
 * a feedback loop, not a prompt.
 *
 * The string is composed from `agent-routing.ts` so the trigger vocabulary
 * stays in one place. Two rules-of-thumb are baked in here because they
 * cause the costliest agent failure modes (issues #3 and #8 in the
 * hardening doc), so they need to land before the agent picks a tool.
 */

import {
  PATHFINDER_NOT_FOR,
  PATHFINDER_NOUNS,
  PATHFINDER_TRIGGER_PHRASES,
  PATHFINDER_USE_CASE_VERBS,
} from './agent-routing';

function joinList(items: readonly string[]): string {
  return items.map((s) => `"${s}"`).join(', ');
}

/**
 * Server-level instructions surfaced to MCP-aware clients on `initialize`.
 *
 * Length is deliberately tight (~20 lines). If this needs to grow, prefer
 * extending the per-tool `description` (layer 1) or `pathfinder_authoring_start`
 * (rich context, fetched after routing) over expanding this string — every
 * extra paragraph here is paid by every connected client on every session.
 */
export const SERVER_INSTRUCTIONS: string = [
  'Pathfinder is a Grafana plugin that runs interactive, contextual guides inside the Grafana UI. This MCP server lets agents author and publish those guides.',
  '',
  `Use this server when the user wants to ${PATHFINDER_USE_CASE_VERBS.slice(0, 4).join(', ')}, edit, update, or publish a Grafana ${PATHFINDER_NOUNS.slice(1).join(' / ')} — anything that becomes an interactive Pathfinder guide.`,
  '',
  `Common trigger phrases: ${joinList(PATHFINDER_TRIGGER_PHRASES)}.`,
  '',
  'Always call `pathfinder_authoring_start` first. It returns the schema version, workflow, composition rules, and discovery hints you will need for every subsequent tool call.',
  '',
  'Two rules that bite agents in production — observe them before writing blocks:',
  '',
  '- Never invent or guess Grafana DOM selectors for a `reftarget` field. If you do not have a verified selector, write a markdown block describing the action, use a `button` action with visible text matching, or ask the user. A wrong selector silently breaks the guide at runtime — the validator cannot catch this.',
  '',
  '- Prefer separate sibling blocks over a `multistep` block. Use `multistep` only when the steps must be completed in order and are tightly coupled. Never write a step with `action: noop` as filler — if there is nothing concrete for the user to do, write a markdown block describing what they would do instead.',
  '',
  `When NOT to use this server: ${PATHFINDER_NOT_FOR.join('; ')}. Those belong on other MCP servers or in a direct answer.`,
].join('\n');
