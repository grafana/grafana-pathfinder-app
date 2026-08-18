/**
 * `pathfinder_authoring_start` — first tool a client should call.
 *
 * Returns a compact context block telling the model what Pathfinder is, what
 * the authoring contract looks like, and which other tools to call to make
 * progress. Sourced from a single typed module here so updates land in one
 * place rather than being copy-pasted into every client's skill file.
 *
 * Session-token mode is taught as the primary workflow: the first
 * mutation mints a sessionToken, mutation responses are acks (not full
 * artifacts), reads are explicit and on-demand, and the full artifact
 * returns only at finalize. Stateless `{artifact}` mode is mentioned once
 * as a fallback for OSS / airgap or multi-instance deployments.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { CURRENT_SCHEMA_VERSION } from '../../../types/json-guide.schema';
import { BLOCK_TYPES, CONTAINER_BLOCK_TYPES } from '../../utils/block-registry';
import { renderMachineJson } from '../../utils/output';
import { PATHFINDER_DOMAINS, PATHFINDER_NOT_FOR, PATHFINDER_TRIGGER_PHRASES } from '../lib/agent-routing';
import { readOnly } from './annotations';
import { textResult } from './result';

// Derived from the CLI registry so this guidance can't drift from the rule
// pathfinder_manage_block enforces.
const CONTAINER_TYPES_TEXT = BLOCK_TYPES.filter((type) => CONTAINER_BLOCK_TYPES.has(type)).join(', ');

const AUTHORING_CONTEXT = {
  version: CURRENT_SCHEMA_VERSION,
  product:
    'Grafana Pathfinder is a Grafana plugin that runs interactive, contextual guides as a sidebar in Grafana. A guide is a tree of "blocks" — markdown, interactive UI actions, sections, conditionals, multistep, quizzes — stored as JSON.',
  // Routing reaffirmation surface. The same constants seed the server-level
  // `instructions` string in `lib/server-instructions.ts`, so an agent that
  // reached this tool via the initialize hint sees consistent vocabulary,
  // and clients that don't render `initialize.instructions` still get the
  // routing signal here.
  triggers: [...PATHFINDER_TRIGGER_PHRASES],
  notFor: [...PATHFINDER_NOT_FOR],
  domains: [...PATHFINDER_DOMAINS],
  workflow: [
    '1. Call pathfinder_create_package with a title. The response carries BOTH a sessionToken (use this for subsequent calls) AND a seed artifact (ignore unless you are running in stateless fallback mode).',
    '2. Mutate blocks via pathfinder_manage_block with operation "add-block" | "edit-block" | "remove-block" (CLI command names). Append steps with pathfinder_add_step and quiz choices with pathfinder_add_choice. All adds append under the parent, so author in display order. Steps and choices are not individually editable or removable; cascade-remove their parent block and rebuild it instead. Pass {sessionToken}; each mutation response is an ACK — {sessionToken, generation, summary, outcome} — not the full artifact.',
    '3. Navigate by id using the `summary` tree returned on every ack. For deeper reads, call pathfinder_read_session with operation "list-blocks" | "get-block" | "get-manifest" and {sessionToken}. Cheap; use freely instead of re-reading the full artifact.',
    '4. When you need the full artifact body in your context (rare — e.g. for a wholesale review before finalize), call pathfinder_inspect with {sessionToken}. This is the explicit "pull the artifact" escape hatch.',
    '5. Call pathfinder_validate with {sessionToken} before finalize.',
    '6. Call pathfinder_finalize_for_app_platform with {sessionToken} to receive the publish handoff (path templates, viewer link, localExport fallback). The full artifact returns here. The server deletes the session on success — the sessionToken is single-use through finalize.',
  ],
  sessionMode: {
    summary:
      'Primary contract. Mint a sessionToken on first mutation, echo it back on every subsequent call. Mutation responses are acks (no artifact body). Reads are explicit. Finalize returns the artifact and deletes the session.',
    ackShape: {
      status: 'ok | error',
      sessionToken: 'string — echo verbatim on the next call',
      generation:
        'number — monotonic; optional `expectedGeneration` on the next call surfaces a CONCURRENT_MODIFICATION error if the session moved underneath you',
      summary: 'compact tree of {path, id, type, hint?, children?} for navigation',
      outcome: 'CommandOutcome shape (status + any code/message/data on error)',
    },
    rules: [
      'Echo `sessionToken` on every subsequent call. Do NOT echo back the artifact body — it is not in the ack and the server already has it.',
      'Use `summary` for navigation. Do not call pathfinder_inspect after every mutation; the summary already tells you what changed.',
      '`expectedGeneration` is optional. Omit it for the common single-agent case (the server retries once on 412 internally). Pass it only if you specifically want to fail-fast on a concurrent edit.',
      'A failed mutation does NOT bump the generation — the session state is unchanged. Re-read with the same generation if you need to recover.',
      'On SESSION_NOT_FOUND (expired or finalized session), start over: call pathfinder_create_package for a fresh token.',
    ],
  },
  statelessModeFallback: {
    appliesWhen:
      'You are running against an MCP server where server-side sessions are unavailable or not durable — stdio transport, OSS / self-hosted deployments, or any host not pinned to a single instance. Every mutation tool also accepts `{artifact}` in place of `{sessionToken}` and returns the full artifact for you to thread to the next call.',
    rules: [
      'Pass {content, manifest} in. Use the {content, manifest} returned in the response for the next call.',
      'Never mix modes — pass EITHER `artifact` OR `sessionToken`, never both. Mixing returns INPUT_MODE_AMBIGUOUS.',
    ],
  },
  rules: [
    'The CLI runners are the sole validator. If a tool returns status "error" with code "SCHEMA_VALIDATION", the message lists every issue at once — fix all of them before retrying.',
    `Block ids: pass an explicit \`id\` whenever \`type\` is a container (${CONTAINER_TYPES_TEXT}) — they are rejected without one. Every other type auto-ids as <type>-<n> when you omit it.`,
    'Append-only: pathfinder_manage_block operation "add-block" always appends to the end of the parent. Author in display order. To reorder, remove-block and add-block in the desired order (there is no move/insert-index on this tool).',
    'Mutation acks include a `summary` field — a compact tree of every block ({path, id, type, hint?, children?}). Use the summary for navigation and to reference block ids.',
  ],
  // Distilled from grafana/interactive-tutorials `.cursor/authoring-guide.mdc`.
  // Curate ruthlessly — every connected client pays this length on every
  // `_start` call. If this list grows past ~20 rules, ship a separate
  // best-practices tool instead of expanding here.
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
    'Prefer a `grafana:` selector path, then a `data-testid`, over any text-based target. Visible text, `aria-label`, `placeholder` and `title` are all translated, so a guide anchored to them breaks for every user not running the locale you authored in — the engine flags these `i18n-sensitive` for exactly this reason. `action: button` with visible text remains the right fallback when you have no verified stable selector (never invent one), but treat it as a fallback, not a preference.',
    'If the target lives in a virtualized list, paginated table, or dashboard row below the fold, use a `guided` block with `lazyRender: true` on the step — a plain `interactive` will fail because `exists-reftarget` waits but cannot scroll.',
  ],
  discovery: [
    'pathfinder_help — CLI field schemas for mutation payloads. For pathfinder_manage_block, pass command equal to `operation` ("add-block" with subcommand=<type>, "edit-block", or "remove-block"). For dedicated tools: pathfinder_add_step → "add-step"; pathfinder_add_choice → "add-choice"; pathfinder_set_manifest → "set-manifest". Help flag names become `fields` keys; addressing flags map to tool args (`--parent`→`parentId`, `--id`→`id`).',
    'pathfinder_read_session — given a sessionToken and operation list-blocks | get-block | get-manifest, returns a cheap facet of the session artifact. Use freely.',
    'pathfinder_inspect — escape hatch. Given a sessionToken (or artifact), returns the full artifact plus a tree summary.',
    'pathfinder_read_repository — given operation list-packages | get-package | get-manifest, discovers or inspects published CDN packages. Sibling of pathfinder_read_session for published (not session) content.',
  ],
};

export function registerAuthoringStart(server: McpServer): void {
  server.registerTool(
    'pathfinder_authoring_start',
    {
      description:
        'Use this tool when the user wants to author, create, edit, or publish a Grafana Pathfinder interactive guide, tutorial, or walkthrough. Call this first — once per authoring session before any other Pathfinder tool. Returns Pathfinder authoring context, workflow, composition rules, and discovery hints.',
      annotations: readOnly('Start Pathfinder authoring'),
      inputSchema: {},
    },
    async () => textResult(renderMachineJson(AUTHORING_CONTEXT))
  );
}
