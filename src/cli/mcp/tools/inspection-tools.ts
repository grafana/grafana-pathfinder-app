/**
 * Read-only MCP authoring tools: `pathfinder_inspect` and
 * `pathfinder_validate`. Both take an artifact in and return structured
 * data — no artifact mutation, so they don't need the writeback step in
 * `state-bridge`.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { runInspect } from '../../commands/inspect';
import { runValidate } from '../../commands/validate';
import type { ContentJson, ManifestJson } from '../../../types/package.types';
import { buildArtifactSummary } from '../../utils/package-io';
import { outcomeResult } from './result';
import { withArtifact } from './state-bridge';

const ArtifactSchema = z.object({
  content: z.record(z.string(), z.unknown()),
  manifest: z.record(z.string(), z.unknown()).optional(),
});

export function registerInspectionTools(server: McpServer): void {
  server.registerTool(
    'pathfinder_inspect',
    {
      description:
        'Inspect an artifact: tree summary, block lookup by id, or array enumeration at a JSONPath. Read-only; the artifact passes through unchanged.',
      inputSchema: {
        artifact: ArtifactSchema,
        blockId: z.string().optional().describe('Show details for a single block by id.'),
        at: z
          .string()
          .optional()
          .describe(
            'Show the block (or enumerate the array) at a JSONPath, e.g. "blocks", "blocks[2]", "blocks[2].blocks".'
          ),
      },
    },
    async ({ artifact, blockId, at }) => {
      const result = await withArtifact(
        {
          content: artifact.content as unknown as ContentJson,
          manifest: artifact.manifest as unknown as ManifestJson | undefined,
        },
        (dir) => runInspect({ dir, blockId, at })
      );
      return outcomeResult(result.outcome, result.artifact, result.summary);
    }
  );

  server.registerTool(
    'pathfinder_validate',
    {
      description:
        'Validate an in-flight artifact against the canonical Pathfinder validation pipeline (Zod + cross-file checks + condition syntax). Read-only.',
      inputSchema: {
        artifact: ArtifactSchema,
      },
    },
    async ({ artifact }) => {
      const content = artifact.content as unknown as ContentJson;
      const outcome = runValidate({
        content,
        manifest: artifact.manifest as unknown as ManifestJson | undefined,
        manifestSchemaVersionAuthored: artifact.manifest !== undefined,
      });
      return outcomeResult(
        outcome,
        { content: artifact.content, manifest: artifact.manifest },
        buildArtifactSummary(content)
      );
    }
  );
}
