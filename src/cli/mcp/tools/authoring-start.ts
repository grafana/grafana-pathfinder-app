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
import { textResult } from './result';

const AUTHORING_CONTEXT = {
  version: CURRENT_SCHEMA_VERSION,
  product:
    'Grafana Pathfinder is a Grafana plugin that runs interactive, contextual guides as a sidebar in Grafana. A guide is a tree of "blocks" — markdown, interactive UI actions, sections, conditionals, multistep, quizzes — stored as JSON.',
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
        'First tool to call. Returns Pathfinder authoring context, workflow, and tool discovery hints. Read this once per authoring session before calling any mutation tool.',
      inputSchema: {},
    },
    async () => textResult(JSON.stringify(AUTHORING_CONTEXT, null, 2))
  );
}
