/**
 * `pathfinder_authoring_start` — first tool a client should call.
 *
 * Returns a compact context block telling the model what Pathfinder is, what
 * the authoring contract looks like, and which other tools to call to make
 * progress. Sourced from a single typed module here so updates land in one
 * place rather than being copy-pasted into every client's skill file.
 *
 * P7 rewrite: session-token mode is taught as the primary workflow. The
 * agent learns that the first mutation mints a sessionToken, mutation
 * responses are acks (not full artifacts), reads are explicit and
 * on-demand, and the full artifact returns only at finalize. Stateless
 * `{artifact}` mode is mentioned once as a fallback for OSS / airgap
 * environments where no GCS bucket is configured.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { CURRENT_SCHEMA_VERSION } from '../../../types/json-guide.schema';
import { PATHFINDER_DOMAINS, PATHFINDER_NOT_FOR, PATHFINDER_TRIGGER_PHRASES } from '../lib/agent-routing';
import { readOnly } from './annotations';
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
    '1. Call pathfinder_create_package with a title. The response carries BOTH a sessionToken (use this for subsequent calls) AND a seed artifact (ignore unless you are running in stateless fallback mode).',
    '2. Add blocks via pathfinder_add_block (and pathfinder_add_step / pathfinder_add_choice for container children) passing {sessionToken}. Each mutation response is an ACK — {sessionToken, generation, summary, outcome} — not the full artifact. The artifact lives in the session bucket.',
    '3. Navigate by id using the `summary` tree returned on every ack. For deeper reads, call pathfinder_list_blocks, pathfinder_get_block, or pathfinder_get_manifest_session with {sessionToken}. They are cheap; use them freely instead of re-reading the full artifact.',
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
      generation: 'number — monotonic; optional `expectedGeneration` on the next call surfaces a CONCURRENT_MODIFICATION error if the session moved underneath you',
      summary: 'compact tree of {path, id, type, hint?, children?} for navigation',
      outcome: 'CommandOutcome shape (status + any code/message/data on error)',
    },
    rules: [
      'Echo `sessionToken` on every subsequent call. Do NOT echo back the artifact body — it is not in the ack and the server already has it.',
      'Use `summary` for navigation. Do not call pathfinder_inspect after every mutation; the summary already tells you what changed.',
      '`expectedGeneration` is optional. Omit it for the common single-agent case (the server retries once on 412 internally). Pass it only if you specifically want to fail-fast on a concurrent edit.',
      'A failed mutation does NOT bump the generation — the bucket state is unchanged. Re-read with the same generation if you need to recover.',
      'On SESSION_NOT_FOUND (expired or finalized session), start over: call pathfinder_create_package for a fresh token.',
    ],
  },
  statelessModeFallback: {
    appliesWhen:
      'You are running against an MCP server with no session bucket configured (OSS deployments, airgapped environments, or any host with PATHFINDER_SESSION_STORE=memory across multiple processes). Every mutation tool also accepts `{artifact}` in place of `{sessionToken}` and returns the full artifact for you to thread to the next call.',
    rules: [
      'Pass {content, manifest} in. Use the {content, manifest} returned in the response for the next call.',
      'Never mix modes — pass EITHER `artifact` OR `sessionToken`, never both. Mixing returns INPUT_MODE_AMBIGUOUS.',
    ],
  },
  rules: [
    'The CLI runners are the sole validator. If a tool returns status "error" with code "SCHEMA_VALIDATION", the message lists every issue at once — fix all of them before retrying.',
    'Block ids: leaf blocks auto-id as <type>-<n> if you do not pass an id. Container blocks (section, multistep, guided, conditional, assistant, quiz) require an explicit id.',
    'Mutation acks include a `summary` field — a compact tree of every block ({path, id, type, hint?, children?}). Use the summary for navigation and to reference block ids.',
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
    'pathfinder_list_blocks — given a sessionToken, returns the tree summary without the block bodies. Cheap; use freely.',
    'pathfinder_get_block — given a sessionToken and block id, returns one block. Cheap targeted read.',
    'pathfinder_get_manifest_session — given a sessionToken, returns the session-stored manifest. Distinct from pathfinder_get_manifest (which reads from the CDN repository).',
    'pathfinder_inspect — escape hatch. Given a sessionToken (or artifact), returns the full artifact plus a tree summary.',
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
    async () => textResult(JSON.stringify(AUTHORING_CONTEXT, null, 2))
  );
}
