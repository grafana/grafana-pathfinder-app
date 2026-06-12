/**
 * Read-only MCP authoring tools: `pathfinder_inspect` and
 * `pathfinder_validate`. Both take an artifact in and return structured
 * data — no artifact mutation, so they don't need the writeback step in
 * `state-bridge`.
 *
 * Session-mode: each tool also accepts `{sessionToken}` instead of
 * `{artifact}`. The session-mode branch loads from the store and runs
 * the same read-only pipeline. `pathfinder_inspect` is the canonical
 * "give me the whole artifact" tool — when called in session-mode, the
 * artifact returns to the agent's context (the explicit escape hatch:
 * the agent chose to pull it).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { runInspect } from '../../commands/inspect';
import { runValidate } from '../../commands/validate';
import { buildArtifactSummary } from '../../utils/package-io';
import type { SessionStore } from '../lib/session-store';
import { readOnly } from './annotations';
import { resolveReadOnlyInput } from './read-input';
import { outcomeResult } from './result';
import { withArtifact } from './state-bridge';
import { ArtifactInputBase, SessionTokenBase } from './two-mode-input';

const ArtifactSchema = ArtifactInputBase.describe(
  'STATELESS MODE. Pass an in-flight artifact directly. Pass EITHER `artifact` OR `sessionToken`, not both.'
);

const SessionTokenSchema = SessionTokenBase.describe(
  'SESSION MODE. Token returned by pathfinder_create_package. The server loads the artifact from session storage.'
);

export function registerInspectionTools(
  server: McpServer,
  options: { sessionStore: SessionStore; mcpSessionId?: string }
): void {
  const { sessionStore, mcpSessionId } = options;

  server.registerTool(
    'pathfinder_inspect',
    {
      description:
        'Use this tool when you need to read the current state of an in-flight Pathfinder authoring artifact — tree summary, block lookup by id, or array enumeration at a JSONPath. Read-only. Pass `artifact` for stateless mode or `sessionToken` for session mode (the full artifact returns to your context in either case — this is the explicit "pull the artifact" escape hatch).',
      annotations: readOnly('Inspect Pathfinder artifact'),
      inputSchema: {
        artifact: ArtifactSchema,
        sessionToken: SessionTokenSchema,
        blockId: z.string().optional().describe('Show details for a single block by id.'),
        at: z
          .string()
          .optional()
          .describe(
            'Show the block (or enumerate the array) at a JSONPath, e.g. "blocks", "blocks[2]", "blocks[2].blocks".'
          ),
      },
    },
    async ({ artifact, sessionToken, blockId, at }) => {
      const resolved = await resolveReadOnlyInput(sessionStore, { artifact, sessionToken }, mcpSessionId);
      if (!resolved.ok) {
        return resolved.response;
      }
      const result = await withArtifact({ content: resolved.content, manifest: resolved.manifest }, (dir) =>
        runInspect({ dir, blockId, at })
      );
      return outcomeResult(result.outcome, result.artifact, result.summary);
    }
  );

  server.registerTool(
    'pathfinder_validate',
    {
      description:
        'Use this tool when you need to confirm an in-flight Pathfinder authoring artifact is publishable before calling finalize. Runs the canonical Pathfinder validation pipeline (Zod + cross-file checks + condition syntax). Read-only. Pass `artifact` or `sessionToken`.',
      annotations: readOnly('Validate Pathfinder artifact'),
      inputSchema: {
        artifact: ArtifactSchema,
        sessionToken: SessionTokenSchema,
      },
    },
    async ({ artifact, sessionToken }) => {
      const resolved = await resolveReadOnlyInput(sessionStore, { artifact, sessionToken }, mcpSessionId);
      if (!resolved.ok) {
        return resolved.response;
      }
      const outcome = runValidate({
        content: resolved.content,
        manifest: resolved.manifest,
        manifestSchemaVersionAuthored: resolved.manifestAuthored,
      });
      return outcomeResult(
        outcome,
        { content: resolved.content, manifest: resolved.manifest },
        buildArtifactSummary(resolved.content)
      );
    }
  );
}
