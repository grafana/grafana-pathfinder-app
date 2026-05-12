/**
 * `pathfinder_authoring_start` — first tool a client should call.
 *
 * Returns a compact context block telling the model what Pathfinder is, what
 * the authoring contract looks like, and which other tools to call to make
 * progress. Sourced from a single typed module here so updates land in one
 * place rather than being copy-pasted into every client's skill file.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { CURRENT_SCHEMA_VERSION } from '../../../types/json-guide.schema';
import { PATHFINDER_DOMAINS, PATHFINDER_NOT_FOR, PATHFINDER_TRIGGER_PHRASES } from '../lib/agent-routing';
import { textResult } from './result';

const AUTHORING_CONTEXT = {
  version: CURRENT_SCHEMA_VERSION,
  product:
    'Grafana Pathfinder is a Grafana plugin that runs interactive, contextual guides as a sidebar in Grafana. A guide is a tree of "blocks" — markdown, interactive UI actions, sections, conditionals, multistep, quizzes — stored as JSON.',
  // Routing reaffirmation surface (M1 layer 2). The same constants seed the
  // server-level `instructions` string in `lib/server-instructions.ts`, so an
  // agent that reached this tool via layer-3 hints sees consistent vocabulary,
  // and clients that don't render `initialize.instructions` still get the
  // routing signal here. `domains` added in slice 3 (2026-05-12) so the
  // agent has explicit vocabulary for product-area follow-up prompts.
  triggers: [...PATHFINDER_TRIGGER_PHRASES],
  notFor: [...PATHFINDER_NOT_FOR],
  domains: [...PATHFINDER_DOMAINS],
  workflow: [
    '1. Call pathfinder_create_package with a title to get a fresh artifact ({ content, manifest }).',
    '2. Add blocks via pathfinder_add_block (and pathfinder_add_step / pathfinder_add_choice for container children). Pass the artifact in and use the artifact returned in the response for the next call.',
    '3. Inspect with pathfinder_inspect at any time (no mutation).',
    '4. Validate with pathfinder_validate before finalize.',
    '5. Call pathfinder_finalize_for_app_platform to receive a publish handoff with App Platform path templates and a localExport fallback.',
  ],
  rules: [
    'Every authoring tool is stateless — pass {content, manifest} in, use the returned {content, manifest} for the next call. There is no sessionId.',
    'The CLI runners are the sole validator. If a tool returns status "error" with code "SCHEMA_VALIDATION", the message lists every issue at once — fix all of them before retrying.',
    'Block ids: leaf blocks auto-id as <type>-<n> if you do not pass an id. Container blocks (section, multistep, guided, conditional, assistant, quiz) require an explicit id.',
    'Mutation responses include a `summary` field — a compact tree of every block ({path, id, type, hint?, children?}). Use the summary for navigation and to reference block ids; you do not need to re-read `artifact.content` after every mutation.',
  ],
  // Distilled from grafana/interactive-tutorials `.cursor/authoring-guide.mdc`.
  // Curate ruthlessly — every connected client pays this length on every
  // `_start` call. If this list grows past ~20 rules, ship a separate
  // `pathfinder_authoring_best_practices` tool (OQ7) instead of expanding here.
  compositionRules: [
    'Prefer separate sibling blocks over a `multistep` block. Use `multistep` only when the steps must run in order AND are tightly coupled.',
    'Never write a step with `action: noop` as filler. If there is nothing concrete for the user to do, write a `markdown` block describing what they would do instead.',
    'If you do not have a verified Grafana DOM selector for a `reftarget` field, do NOT write a step that requires one. Write a `markdown` block, use `action: button` with the visible button text, or ask the user — never invent a selector.',
    'If a `multistep` would end up with only one step, replace it with an `interactive` block. Single-step multisteps add overhead with no benefit.',
    "Use `section` blocks instead of markdown `##` headings — sections give the app control over rendering, closeable groups, and progress tracking. Don't open a guide with a `## Title` markdown block; the guide's `title` is already rendered in the enclosing frame.",
    "Anchor the user on the first interactive step: add `on-page:/path` to its `requirements`, or use a `navigate` action — the guide can't assume it starts on the right page.",
    'Add contextual `requirements` to every interactive step that touches the DOM. At minimum `on-page:/path`; also `navmenu-open` for nav clicks and `is-admin` (or a role) for admin-only features.',
    "Use `verify` on actions that change state (save, create, navigate) so the next step can't run against a half-completed action.",
    'Keep prose punchy and action-oriented — the guide shows in a sidebar. "Click **Save**" beats "The save button can be clicked."',
    "Prefer `action: button` with the visible button text over a CSS selector when possible — Grafana's button text changes far less often than the DOM tree.",
    'If the target lives in a virtualized list, paginated table, or dashboard row below the fold, use a `guided` block with `lazyRender: true` on the step — a plain `interactive` will fail because `exists-reftarget` waits but cannot scroll.',
  ],
  discovery: [
    'pathfinder_help — returns the structured CLI help surface, equivalent to `pathfinder-cli <cmd> --help --format json`. Use this when you need exact flag names or block-type field schemas.',
    'pathfinder_inspect — given an artifact, returns a tree summary so you can address blocks by id or JSONPath without re-reading the artifact yourself.',
  ],
};

export function registerAuthoringStart(server: McpServer): void {
  server.registerTool(
    'pathfinder_authoring_start',
    {
      description:
        'Use this tool when the user wants to author, create, edit, or publish a Grafana Pathfinder interactive guide, tutorial, or walkthrough. Call this first — once per authoring session before any other Pathfinder tool. Returns Pathfinder authoring context, workflow, composition rules, and discovery hints.',
      inputSchema: {},
    },
    async () => textResult(JSON.stringify(AUTHORING_CONTEXT, null, 2))
  );
}
