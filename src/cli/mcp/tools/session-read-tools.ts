/**
 * Fine-grained read tools — session-scoped, lightweight.
 *
 * These three tools exist so the agent can read specific facets of a
 * session-stored artifact WITHOUT pulling the full artifact into
 * context. They are the primary "what does the guide look like right
 * now?" surface in session-mode; the full-artifact escape hatch is
 * pathfinder_inspect({sessionToken}).
 *
 *   - pathfinder_list_blocks      — top-level structure (block ids + types)
 *   - pathfinder_get_block        — one block by id
 *   - pathfinder_get_manifest_session — the manifest only
 *
 * Naming note: pathfinder_get_manifest is taken by the CDN repository
 * tools, so the session-scoped variant carries an explicit `_session`
 * suffix to avoid the collision.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { buildArtifactSummary, findBlockById } from '../../utils/package-io';
import { renderJsonPayload } from '../../utils/output';
import type { LoadedSession, AuthoringSessionStore } from '../lib/session-store';
import { readOnly } from './annotations';
import { resolveAndPinToken } from './read-input';
import { sessionNotFoundResult, textResult, withToolErrorEnvelope } from './result';

const SessionTokenInput = {
  sessionToken: z.string().describe('Session token returned by pathfinder_create_package or a previous mutation ack.'),
};

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

/**
 * Resolve + pin a session token, load the session, then either render the
 * success payload or short-circuit on absent-session / pin-failure / store
 * errors. The render callback returns:
 *   - a plain payload object — wrapped as `textResult(JSON.stringify(...))`.
 *   - a `ToolResult` directly — passed through verbatim (for in-band error
 *     branches like "block id not found" in `pathfinder_get_block`).
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
    return textResult(renderJsonPayload(rendered));
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
    'pathfinder_list_blocks',
    {
      description:
        "Use this tool to enumerate the block structure of a session-stored Pathfinder artifact — block ids and types only, no field content. Cheap. Pair with pathfinder_get_block to drill into a specific block. This is the agent's primary 'what does the guide look like right now?' surface in session-mode; the full-artifact escape hatch is pathfinder_inspect.",
      annotations: readOnly('List Pathfinder blocks (session)'),
      inputSchema: { ...SessionTokenInput },
    },
    async ({ sessionToken }) =>
      withLoadedSession(sessionStore, mcpSessionId, sessionToken, 'list_blocks', (loaded, token) => ({
        status: 'ok',
        sessionToken: token,
        generation: loaded.generation,
        blocks: buildArtifactSummary(loaded.artifact.content),
      }))
  );

  server.registerTool(
    'pathfinder_get_block',
    {
      description:
        'Use this tool to read a single block by id from a session-stored Pathfinder artifact. Returns the block object verbatim (the same shape pathfinder_add_block / pathfinder_edit_block produce). Pair with pathfinder_list_blocks to find ids.',
      annotations: readOnly('Get Pathfinder block (session)'),
      inputSchema: {
        ...SessionTokenInput,
        blockId: z.string().describe('Block id to fetch.'),
      },
    },
    async ({ sessionToken, blockId }) =>
      withLoadedSession(sessionStore, mcpSessionId, sessionToken, 'get_block', (loaded, token) => {
        const block = findBlockById(loaded.artifact.content, blockId);
        if (!block) {
          return textResult(
            renderJsonPayload({
              status: 'error',
              code: 'NOT_FOUND',
              message: `No block with id "${blockId}" in this session.`,
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
      })
  );

  server.registerTool(
    'pathfinder_get_manifest_session',
    {
      description:
        'Use this tool to read the manifest of a session-stored Pathfinder artifact — separate from pathfinder_get_manifest, which reads from the CDN repository. Returns the manifest object or null if no manifest is authored on this session.',
      annotations: readOnly('Get Pathfinder manifest (session)'),
      inputSchema: { ...SessionTokenInput },
    },
    async ({ sessionToken }) =>
      withLoadedSession(sessionStore, mcpSessionId, sessionToken, 'get_manifest_session', (loaded, token) => ({
        status: 'ok',
        sessionToken: token,
        generation: loaded.generation,
        manifest: loaded.artifact.manifest ?? null,
      }))
  );
}
