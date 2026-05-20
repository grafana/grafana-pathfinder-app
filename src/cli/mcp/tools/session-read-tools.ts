/**
 * P7 fine-grained read tools — session-scoped, lightweight.
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
 * Naming note: pathfinder_get_manifest is taken by P6 (CDN repository
 * tools), so the session-scoped variant carries an explicit `_session`
 * suffix to avoid the collision. The P6 decision log
 * (ai-authoring-6-cdn-repository-tools.md) called this out.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { buildArtifactSummary, findBlockById } from '../../utils/package-io';
import { normalizeSessionToken } from '../lib/session-token';
import type { SessionStore } from '../lib/session-store';
import { readOnly } from './annotations';
import {
  invalidSessionTokenResult,
  sessionNotFoundResult,
  textResult,
} from './result';

const SessionTokenInput = {
  sessionToken: z
    .string()
    .describe('Session token returned by pathfinder_create_package or a previous mutation ack.'),
};

export function registerSessionReadTools(server: McpServer, options: { sessionStore: SessionStore }): void {
  const { sessionStore } = options;

  server.registerTool(
    'pathfinder_list_blocks',
    {
      description:
        "Use this tool to enumerate the block structure of a session-stored Pathfinder artifact — block ids and types only, no field content. Cheap. Pair with pathfinder_get_block to drill into a specific block. This is the agent's primary 'what does the guide look like right now?' surface in session-mode; the full-artifact escape hatch is pathfinder_inspect.",
      annotations: readOnly('List Pathfinder blocks (session)'),
      inputSchema: { ...SessionTokenInput },
    },
    async ({ sessionToken }) => {
      const token = normalizeSessionToken(sessionToken);
      if (!token) {
        return invalidSessionTokenResult();
      }
      const loaded = await sessionStore.load(token);
      if (loaded === null) {
        return sessionNotFoundResult(token);
      }
      const summary = buildArtifactSummary(loaded.artifact.content);
      return textResult(
        JSON.stringify(
          {
            status: 'ok',
            sessionToken: token,
            generation: loaded.generation,
            blocks: summary,
          },
          null,
          2
        )
      );
    }
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
    async ({ sessionToken, blockId }) => {
      const token = normalizeSessionToken(sessionToken);
      if (!token) {
        return invalidSessionTokenResult();
      }
      const loaded = await sessionStore.load(token);
      if (loaded === null) {
        return sessionNotFoundResult(token);
      }
      const block = findBlockById(loaded.artifact.content, blockId);
      if (!block) {
        return textResult(
          JSON.stringify(
            {
              status: 'error',
              code: 'NOT_FOUND',
              message: `No block with id "${blockId}" in this session.`,
              sessionToken: token,
              generation: loaded.generation,
            },
            null,
            2
          ),
          /* isError */ true
        );
      }
      return textResult(
        JSON.stringify(
          {
            status: 'ok',
            sessionToken: token,
            generation: loaded.generation,
            block,
          },
          null,
          2
        )
      );
    }
  );

  server.registerTool(
    'pathfinder_get_manifest_session',
    {
      description:
        "Use this tool to read the manifest of a session-stored Pathfinder artifact — separate from pathfinder_get_manifest, which reads from the CDN repository. Returns the manifest object or null if no manifest is authored on this session.",
      annotations: readOnly('Get Pathfinder manifest (session)'),
      inputSchema: { ...SessionTokenInput },
    },
    async ({ sessionToken }) => {
      const token = normalizeSessionToken(sessionToken);
      if (!token) {
        return invalidSessionTokenResult();
      }
      const loaded = await sessionStore.load(token);
      if (loaded === null) {
        return sessionNotFoundResult(token);
      }
      return textResult(
        JSON.stringify(
          {
            status: 'ok',
            sessionToken: token,
            generation: loaded.generation,
            manifest: loaded.artifact.manifest ?? null,
          },
          null,
          2
        )
      );
    }
  );
}
