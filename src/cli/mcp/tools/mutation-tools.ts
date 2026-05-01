/**
 * MCP authoring mutation tools.
 *
 * Each tool accepts the in-flight artifact ({ content, manifest }) and
 * mutation arguments, dispatches to the corresponding CLI `runX` function
 * via the per-call tmpdir bridge in `state-bridge.ts`, and returns the
 * updated artifact alongside the CLI's `CommandOutcome` verbatim.
 *
 * The input schemas here are intentionally **permissive** — fields like
 * `flagValues` (and the nested per-block-type fields) pass through as
 * `record<string, unknown>` so the CLI is the sole validator. This is what
 * the design calls out as the MCP's defining property: schema-illegal
 * output is impossible because it is impossible in the CLI.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { runAddBlock } from '../../commands/add-block';
import { runAddChoice } from '../../commands/add-choice';
import { runAddStep } from '../../commands/add-step';
import { runEditBlock } from '../../commands/edit-block';
import { runRemoveBlock } from '../../commands/remove-block';
import { runSetManifest } from '../../commands/set-manifest';
import { BLOCK_SCHEMA_MAP, type BlockType } from '../../utils/block-registry';
import { outcomeResult } from './result';
import { withArtifact } from './state-bridge';

const ArtifactInputSchema = {
  artifact: z
    .object({
      content: z.record(z.string(), z.unknown()),
      manifest: z.record(z.string(), z.unknown()).optional(),
    })
    .describe('In-flight authoring artifact returned by the previous authoring tool. Pass it in unchanged.'),
};

const FlagValuesSchema = z
  .record(z.string(), z.unknown())
  .describe('Block field values keyed by field name (e.g. content, action, target). The CLI is the sole validator.');

const BlockTypeEnum = Object.keys(BLOCK_SCHEMA_MAP) as BlockType[];

export function registerMutationTools(server: McpServer): void {
  server.registerTool(
    'pathfinder_add_block',
    {
      description:
        'Append a block to the package. Block type and field schemas mirror the CLI. Use pathfinder_help with command "add-block" to see per-type fields. Returns the updated artifact.',
      inputSchema: {
        ...ArtifactInputSchema,
        type: z.enum(BlockTypeEnum as [string, ...string[]]).describe('Block type discriminator.'),
        parentId: z.string().optional().describe('Parent container id (omit for top-level append).'),
        branch: z.enum(['true', 'false']).optional().describe('Conditional branch when parent is a conditional block.'),
        ifAbsent: z
          .boolean()
          .optional()
          .describe('Skip the append if a block with the same id already exists at the target location.'),
        explicitId: z.string().optional().describe('Block id. Required for container blocks; auto-minted for leaves.'),
        before: z.string().optional().describe('Insert immediately before the block with this id.'),
        after: z.string().optional().describe('Insert immediately after the block with this id.'),
        position: z.number().int().nonnegative().optional().describe('Insert at this 0-based index.'),
        fields: FlagValuesSchema.optional().describe('Block fields keyed by name (e.g. content, action, target).'),
      },
    },
    async ({ artifact, type, parentId, branch, ifAbsent, explicitId, before, after, position, fields }) => {
      const result = await withArtifact(asArtifact(artifact), (dir) =>
        runAddBlock({
          dir,
          type: type as BlockType,
          parentId,
          branch,
          ifAbsent,
          explicitId,
          before,
          after,
          position,
          flagValues: fields ?? {},
        })
      );
      return outcomeResult(result.outcome, result.artifact, result.summary);
    }
  );

  server.registerTool(
    'pathfinder_add_step',
    {
      description: 'Append a step to a multistep or guided block. Returns the updated artifact.',
      inputSchema: {
        ...ArtifactInputSchema,
        parentId: z.string().describe('Parent multistep or guided block id.'),
        fields: FlagValuesSchema.describe('Step fields (title, instruction, blocks, etc.).'),
      },
    },
    async ({ artifact, parentId, fields }) => {
      const result = await withArtifact(asArtifact(artifact), (dir) =>
        runAddStep({ dir, parentId, flagValues: fields })
      );
      return outcomeResult(result.outcome, result.artifact, result.summary);
    }
  );

  server.registerTool(
    'pathfinder_add_choice',
    {
      description: 'Append a choice to a quiz block. Returns the updated artifact.',
      inputSchema: {
        ...ArtifactInputSchema,
        parentId: z.string().describe('Parent quiz block id.'),
        fields: FlagValuesSchema.describe('Choice fields (text, isCorrect, feedback, etc.).'),
      },
    },
    async ({ artifact, parentId, fields }) => {
      const result = await withArtifact(asArtifact(artifact), (dir) =>
        runAddChoice({ dir, parentId, flagValues: fields })
      );
      return outcomeResult(result.outcome, result.artifact, result.summary);
    }
  );

  server.registerTool(
    'pathfinder_edit_block',
    {
      description: 'Update fields on an existing block. Returns the updated artifact.',
      inputSchema: {
        ...ArtifactInputSchema,
        id: z.string().describe('Block id to edit.'),
        fields: FlagValuesSchema.describe('Fields to overwrite (others left untouched).'),
      },
    },
    async ({ artifact, id, fields }) => {
      const result = await withArtifact(asArtifact(artifact), (dir) => runEditBlock({ dir, id, flagValues: fields }));
      return outcomeResult(result.outcome, result.artifact, result.summary);
    }
  );

  server.registerTool(
    'pathfinder_remove_block',
    {
      description: 'Remove a block by id. Returns the updated artifact.',
      inputSchema: {
        ...ArtifactInputSchema,
        id: z.string().describe('Block id to remove.'),
        cascade: z.boolean().default(false).describe('When true, also remove children of a non-empty container.'),
        orphanChildren: z
          .boolean()
          .optional()
          .describe("When true, hoist children up to the removed block's parent instead of deleting them."),
      },
    },
    async ({ artifact, id, cascade, orphanChildren }) => {
      const result = await withArtifact(asArtifact(artifact), (dir) =>
        runRemoveBlock({ dir, id, cascade, orphanChildren })
      );
      return outcomeResult(result.outcome, result.artifact, result.summary);
    }
  );

  server.registerTool(
    'pathfinder_set_manifest',
    {
      description: 'Update fields on the package manifest. Returns the updated artifact.',
      inputSchema: {
        ...ArtifactInputSchema,
        fields: FlagValuesSchema.describe('Manifest fields to set (description, category, language, etc.).'),
      },
    },
    async ({ artifact, fields }) => {
      const result = await withArtifact(asArtifact(artifact), (dir) => runSetManifest({ dir, flagValues: fields }));
      return outcomeResult(result.outcome, result.artifact, result.summary);
    }
  );
}

function asArtifact(input: { content: Record<string, unknown>; manifest?: Record<string, unknown> }): {
  content: import('../../../types/package.types').ContentJson;
  manifest?: import('../../../types/package.types').ManifestJson;
} {
  return {
    content: input.content as unknown as import('../../../types/package.types').ContentJson,
    manifest: input.manifest as unknown as import('../../../types/package.types').ManifestJson | undefined,
  };
}
