/**
 * Fine-grained read tools — session-scoped, lightweight.
 *
 * `pathfinder_read_session` collapses the former list_blocks / get_block /
 * get_manifest_session trio into one tool with an operation flag so agents
 * pay a single tool slot for cheap session reads. The full-artifact escape
 * hatch remains `pathfinder_inspect({sessionToken})`.
 *
 * Operations use kebab-case capability names (same style as CLI command
 * names). There is no CLI twin for these reads — they are MCP-only facets
 * of the session store:
 *   - list-blocks  — top-level structure (block ids + types)
 *   - get-block    — one block by id
 *   - get-manifest — the session-stored manifest only
 *
 * CDN package metadata lives under `pathfinder_read_repository` — different
 * data source, different tool (shares the `get-manifest` operation name).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { buildArtifactSummary, findBlockById } from '../../utils/package-io';
import { renderMachineJson } from '../../utils/output';
import type { LoadedSession, AuthoringSessionStore } from '../lib/session-store';
import { readOnly } from './annotations';
import { resolveAndPinToken } from './read-input';
import { sessionNotFoundResult, textResult, withToolErrorEnvelope } from './result';

const READ_SESSION_OPERATIONS = ['list-blocks', 'get-block', 'get-manifest'] as const;

/**
 * Single source of truth for pathfinder_read_session args. Published schema
 * and renderReadSession both derive from this (same pattern as manage_block).
 */
const ReadSessionInputSchema = z
  .object({
    sessionToken: z
      .string()
      .describe('Session token returned by pathfinder_create_package or a previous mutation ack.'),
    operation: z
      .enum(READ_SESSION_OPERATIONS)
      .describe(
        'Read to perform: "list-blocks" returns ids/types only, "get-block" returns one block by id (requires blockId), "get-manifest" returns the session-stored manifest (or null).'
      ),
    blockId: z.string().optional().describe('[get-block] Required block id to fetch.'),
  })
  .superRefine((args, ctx) => {
    if (args.operation === 'get-block') {
      if (typeof args.blockId !== 'string' || args.blockId.trim() === '') {
        ctx.addIssue({
          code: 'custom',
          path: ['blockId'],
          message: 'operation "get-block" requires `blockId`.',
        });
      }
    }
  });

type ReadSessionInput = z.infer<typeof ReadSessionInputSchema>;

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

/**
 * Resolve + pin a session token, load the session, then either render the
 * success payload or short-circuit on absent-session / pin-failure / store
 * errors. The render callback returns:
 *   - a plain payload object — wrapped as `textResult(JSON.stringify(...))`.
 *   - a `ToolResult` directly — passed through verbatim (for in-band error
 *     branches like "block id not found" in get-block).
 */
async function withLoadedSession(
  store: AuthoringSessionStore,
  mcpSessionId: string | undefined,
  rawToken: string,
  toolName: string,
  render: (loaded: LoadedSession, token: string) => ToolResult | Record<string, unknown>
): Promise<ToolResult> {
  return withToolErrorEnvelope(rawToken, toolName, async () => {
    const r = await resolveAndPinToken(store, rawToken, mcpSessionId);
    if (!r.ok) {
      return r.response;
    }
    const { token } = r;
    const loaded = await store.load(token);
    if (loaded === null) {
      return sessionNotFoundResult(token);
    }
    const rendered = render(loaded, token);
    if (isToolResult(rendered)) {
      return rendered;
    }
    return textResult(renderMachineJson(rendered));
  });
}

function isToolResult(value: ToolResult | Record<string, unknown>): value is ToolResult {
  return Array.isArray((value as ToolResult).content);
}

export function registerSessionReadTools(
  server: McpServer,
  options: { sessionStore: AuthoringSessionStore; mcpSessionId?: string }
): void {
  const { sessionStore, mcpSessionId } = options;

  server.registerTool(
    'pathfinder_read_session',
    {
      description:
        'Use this tool to read facets of a session-stored Pathfinder artifact without pulling the full artifact into context. Pass `operation: "list-blocks" | "get-block" | "get-manifest"` (kebab-case capability names; MCP-only — no CLI twins). Cheap; use freely for navigation. For the full artifact body use pathfinder_inspect. CDN / published package reads use pathfinder_read_repository instead.',
      annotations: readOnly('Read Pathfinder session'),
      // Flat object + superRefine so operation-required fields fail at the MCP
      // schema boundary (same contract as pathfinder_manage_block).
      inputSchema: ReadSessionInputSchema,
    },
    async ({ sessionToken, operation, blockId }) =>
      withLoadedSession(sessionStore, mcpSessionId, sessionToken, 'read_session', (loaded, token) =>
        renderReadSession({ operation, blockId }, loaded, token)
      )
  );
}

function renderReadSession(
  args: Pick<ReadSessionInput, 'operation' | 'blockId'>,
  loaded: LoadedSession,
  token: string
): ToolResult | Record<string, unknown> {
  switch (args.operation) {
    case 'list-blocks':
      return {
        status: 'ok',
        sessionToken: token,
        generation: loaded.generation,
        blocks: buildArtifactSummary(loaded.artifact.content),
      };
    case 'get-block': {
      const id = args.blockId!;
      const block = findBlockById(loaded.artifact.content, id);
      if (!block) {
        return textResult(
          renderMachineJson({
            status: 'error',
            code: 'NOT_FOUND',
            message: `No block with id "${id}" in this session.`,
            sessionToken: token,
            generation: loaded.generation,
          }),
          /* isError */ true
        );
      }
      return {
        status: 'ok',
        sessionToken: token,
        generation: loaded.generation,
        block,
      };
    }
    case 'get-manifest':
      return {
        status: 'ok',
        sessionToken: token,
        generation: loaded.generation,
        manifest: loaded.artifact.manifest ?? null,
      };
  }
}
