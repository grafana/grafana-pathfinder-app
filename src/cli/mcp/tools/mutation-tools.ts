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
import { ARTIFACT_ETAG_FIELD, computeArtifactEtag } from '../../utils/etag';
import type { CommandOutcome } from '../../utils/output';
import type { SessionStore } from '../lib/session-store';
import { writeAppend, writeDestructive } from './annotations';
import { resolveAndPinToken } from './read-input';
import {
  concurrentModificationResult,
  outcomeResult,
  sessionNotFoundResult,
  sessionOutcomeResult,
  sessionTooLargeResult,
  withToolErrorEnvelope,
} from './result';
import {
  dispatchSessionMutation,
  isConcurrentModification,
  isSessionNotFound,
  isSessionTooLarge,
  withArtifact,
} from './state-bridge';
import {
  ArtifactInputWithEtag,
  ExpectedGenerationBase,
  SessionTokenBase,
  classifyTwoModeInput,
} from './two-mode-input';

/**
 * Input schema for the two-mode dispatch (P7). Mutation tools accept
 * EITHER `artifact` (stateless mode, the historical contract) OR
 * `sessionToken` (session-mode). Both are optional at the
 * Zod layer; the handler enforces "exactly one of" at runtime via
 * `classifyTwoModeInput` — Zod's discriminated unions don't map cleanly
 * to MCP tool inputSchema, so the check is in handler code.
 */
const ArtifactInputSchema = {
  artifact: ArtifactInputWithEtag.describe(
    'STATELESS MODE. In-flight authoring artifact returned by the previous authoring tool. Echo it back verbatim — including `__etag`. Do not re-serialize, reformat, re-key, or "fix" any field; even fields that look wrong are valid CLI output. The server hashes content+manifest and checks it against the echoed `__etag`; a mismatch returns ARTIFACT_MUTATED before the schema validator runs. Pass EITHER `artifact` OR `sessionToken`, not both.'
  ),
  sessionToken: SessionTokenBase.describe(
    'SESSION MODE. Opaque token returned by pathfinder_create_package or a previous mutation ack. The server loads the artifact from session storage, runs the mutation, and writes the result back — the full artifact does not return to your context. Use pathfinder_inspect / pathfinder_get_block / pathfinder_list_blocks to read state on demand. Pass EITHER `artifact` OR `sessionToken`, not both.'
  ),
  expectedGeneration: ExpectedGenerationBase.describe(
    'OPTIONAL with sessionToken. The generation you observed on a previous call. When set, the server surfaces CONCURRENT_MODIFICATION immediately on mismatch instead of retrying. Omit this if you do not have specific concurrency expectations — the server will retry-once silently on a race.'
  ),
};

/**
 * Verify the agent echoed the artifact back verbatim — issue #1. Returns
 * an `ARTIFACT_MUTATED` outcome on mismatch, or `null` to proceed.
 *
 * When `__etag` is absent on the input we skip the check. This preserves
 * graceful behavior for the first call (no previous response to echo
 * from) and for any client that omits the field.
 */
function verifyArtifactEtag(artifact: {
  content: Record<string, unknown>;
  manifest?: Record<string, unknown>;
  __etag?: string;
}): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } | null {
  if (typeof artifact.__etag !== 'string' || artifact.__etag.length === 0) {
    return null;
  }
  const recomputed = computeArtifactEtag({ content: artifact.content, manifest: artifact.manifest });
  if (recomputed === artifact.__etag) {
    return null;
  }
  return outcomeResult({
    status: 'error',
    code: 'ARTIFACT_MUTATED',
    message:
      'The artifact you passed in does not match the integrity tag the server issued. Common cause: re-serializing or reformatting fields between calls (e.g., wrapping a markdown `content` string in an array, sorting keys, dropping fields you thought were optional). Re-fetch the latest artifact from your previous tool response and pass it back byte-for-byte.',
    data: {
      expected: artifact.__etag,
      actual: recomputed,
      field: ARTIFACT_ETAG_FIELD,
    },
  });
}

const FlagValuesSchema = z
  .record(z.string(), z.unknown())
  .describe('Block field values keyed by field name (e.g. content, action, target). The CLI is the sole validator.');

const BlockTypeEnum = Object.keys(BLOCK_SCHEMA_MAP) as BlockType[];

/**
 * Shared dispatch for every mutation tool's two-mode input. Validates
 * "exactly one of {artifact} / {sessionToken}", dispatches to the right
 * branch, maps the result onto a wire-shaped response.
 *
 * The `runner` argument is the same per-call runner closure each tool
 * already builds for `withArtifact` — no per-tool duplication of the
 * dispatch logic.
 */
async function dispatchMutation(
  store: SessionStore,
  mcpSessionId: string | undefined,
  inputs: {
    artifact?: {
      content: Record<string, unknown>;
      manifest?: Record<string, unknown>;
      __etag?: string;
    };
    sessionToken?: string;
    expectedGeneration?: number;
  },
  runner: (dir: string) => Promise<CommandOutcome> | CommandOutcome
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const classified = classifyTwoModeInput({ artifact: inputs.artifact, sessionToken: inputs.sessionToken });
  if (classified.kind === 'error') {
    return classified.response;
  }

  // Capture the (possibly invalid) token for error responses before any
  // throw can escape, so the catch-all envelope can echo it back.
  const rawToken = classified.kind === 'session' ? classified.token : undefined;

  return withToolErrorEnvelope(rawToken, 'mutation-tools', async () => {
    if (classified.kind === 'session') {
      const resolution = await resolveAndPinToken(store, classified.token, mcpSessionId);
      if (!resolution.ok) {
        return resolution.response;
      }
      const { token } = resolution;
      const r = await dispatchSessionMutation(token, store, runner, {
        expectedGeneration: inputs.expectedGeneration,
      });
      if (isSessionNotFound(r)) {
        return sessionNotFoundResult(token);
      }
      if (isConcurrentModification(r)) {
        return concurrentModificationResult(token, r);
      }
      if (isSessionTooLarge(r)) {
        return sessionTooLargeResult(token, r);
      }
      return sessionOutcomeResult(token, r.outcome, r.generation, r.summary);
    }

    // Stateless mode — unchanged behavior from before P7.
    const artifact = classified.artifact;
    const mismatch = verifyArtifactEtag(artifact);
    if (mismatch) {
      return mismatch;
    }
    const result = await withArtifact(asArtifact(artifact), runner);
    return outcomeResult(result.outcome, result.artifact, result.summary);
  });
}

export function registerMutationTools(
  server: McpServer,
  options: { sessionStore: SessionStore; mcpSessionId?: string }
): void {
  const { sessionStore, mcpSessionId } = options;
  server.registerTool(
    'pathfinder_add_block',
    {
      description:
        'Use this tool when the user wants to add a block (markdown, interactive step, multistep, quiz, section, conditional, video, etc.) to a Pathfinder guide. Block type and field schemas mirror the CLI — call `pathfinder_help` with command "add-block" for per-type fields. Returns the updated artifact.',
      annotations: writeAppend('Add Pathfinder block'),
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
    async ({
      artifact,
      sessionToken,
      expectedGeneration,
      type,
      parentId,
      branch,
      ifAbsent,
      explicitId,
      before,
      after,
      position,
      fields,
    }) =>
      dispatchMutation(sessionStore, mcpSessionId, { artifact, sessionToken, expectedGeneration }, (dir) =>
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
      )
  );

  server.registerTool(
    'pathfinder_add_step',
    {
      description:
        'Use this tool when the user wants to add a step inside a multistep or guided block in a Pathfinder guide. Returns the updated artifact.',
      annotations: writeAppend('Add Pathfinder step'),
      inputSchema: {
        ...ArtifactInputSchema,
        parentId: z.string().describe('Parent multistep or guided block id.'),
        fields: FlagValuesSchema.describe('Step fields (title, instruction, blocks, etc.).'),
      },
    },
    async ({ artifact, sessionToken, expectedGeneration, parentId, fields }) =>
      dispatchMutation(sessionStore, mcpSessionId, { artifact, sessionToken, expectedGeneration }, (dir) =>
        runAddStep({ dir, parentId, flagValues: fields })
      )
  );

  server.registerTool(
    'pathfinder_add_choice',
    {
      description:
        'Use this tool when the user wants to add a choice (answer option) to a quiz block in a Pathfinder guide. Returns the updated artifact.',
      annotations: writeAppend('Add Pathfinder choice'),
      inputSchema: {
        ...ArtifactInputSchema,
        parentId: z.string().describe('Parent quiz block id.'),
        fields: FlagValuesSchema.describe('Choice fields (text, isCorrect, feedback, etc.).'),
      },
    },
    async ({ artifact, sessionToken, expectedGeneration, parentId, fields }) =>
      dispatchMutation(sessionStore, mcpSessionId, { artifact, sessionToken, expectedGeneration }, (dir) =>
        runAddChoice({ dir, parentId, flagValues: fields })
      )
  );

  server.registerTool(
    'pathfinder_edit_block',
    {
      description:
        'Use this tool when the user wants to edit or update an existing block in a Pathfinder guide. Overwrites the named fields; other fields are left untouched. Returns the updated artifact.',
      annotations: writeDestructive('Edit Pathfinder block'),
      inputSchema: {
        ...ArtifactInputSchema,
        id: z.string().describe('Block id to edit.'),
        fields: FlagValuesSchema.describe('Fields to overwrite (others left untouched).'),
      },
    },
    async ({ artifact, sessionToken, expectedGeneration, id, fields }) =>
      dispatchMutation(sessionStore, mcpSessionId, { artifact, sessionToken, expectedGeneration }, (dir) =>
        runEditBlock({ dir, id, flagValues: fields })
      )
  );

  server.registerTool(
    'pathfinder_remove_block',
    {
      description:
        'Use this tool when the user wants to delete a block from a Pathfinder guide. Identifies the block by id. Returns the updated artifact.',
      annotations: writeDestructive('Remove Pathfinder block'),
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
    async ({ artifact, sessionToken, expectedGeneration, id, cascade, orphanChildren }) =>
      dispatchMutation(sessionStore, mcpSessionId, { artifact, sessionToken, expectedGeneration }, (dir) =>
        runRemoveBlock({ dir, id, cascade, orphanChildren })
      )
  );

  server.registerTool(
    'pathfinder_set_manifest',
    {
      description:
        'Use this tool when the user wants to set or update top-level Pathfinder guide metadata (description, category, language, etc.) on the package manifest. Returns the updated artifact.',
      annotations: writeDestructive('Set Pathfinder manifest', /* idempotent */ true),
      inputSchema: {
        ...ArtifactInputSchema,
        fields: FlagValuesSchema.describe('Manifest fields to set (description, category, language, etc.).'),
      },
    },
    async ({ artifact, sessionToken, expectedGeneration, fields }) =>
      dispatchMutation(sessionStore, mcpSessionId, { artifact, sessionToken, expectedGeneration }, (dir) =>
        runSetManifest({ dir, flagValues: fields })
      )
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
