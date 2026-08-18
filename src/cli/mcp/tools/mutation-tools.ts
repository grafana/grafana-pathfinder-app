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
import { BLOCK_SCHEMA_MAP, CONTAINER_BLOCK_TYPES, type BlockType } from '../../utils/block-registry';
import { ARTIFACT_ETAG_FIELD, computeArtifactEtag } from '../../utils/etag';
import type { CommandOutcome } from '../../utils/output';
import type { AuthoringSessionStore } from '../lib/session-store';
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
    'SESSION MODE. Opaque token returned by pathfinder_create_package or a previous mutation ack. The server loads the artifact from session storage, runs the mutation, and writes the result back — the full artifact does not return to your context. Use pathfinder_inspect / pathfinder_read_session to read state on demand. Pass EITHER `artifact` OR `sessionToken`, not both.'
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
  .describe('Payload fields keyed by name (e.g. content, action, reftarget). The CLI is the sole validator.');

const BlockTypeEnum = Object.keys(BLOCK_SCHEMA_MAP) as [BlockType, ...BlockType[]];

// Containers need an author-supplied id so later calls can target them as
// `parentId`. Derived from the CLI registry rather than hand-listed, so the
// agent-facing copy can't drift from the CONTAINER_REQUIRES_ID check.
const CONTAINER_TYPES_TEXT = BlockTypeEnum.filter((type) => CONTAINER_BLOCK_TYPES.has(type)).join(', ');

/**
 * Single source of truth for pathfinder_manage_block args. Resource selection
 * happens at the tool boundary; only the add/edit/remove block matrix remains.
 */
const ManageBlockInputSchema = z
  .object({
    ...ArtifactInputSchema,
    operation: z.enum(['add', 'edit', 'remove']).describe('Block mutation to perform.'),
    type: z
      .enum(BlockTypeEnum)
      .optional()
      .describe(`[add] Required block type. Container types (${CONTAINER_TYPES_TEXT}) must also be given an \`id\`.`),
    parentId: z.string().optional().describe('[add] Optional parent container id. Omit to append at the guide root.'),
    branch: z
      .enum(['true', 'false'])
      .optional()
      .describe(
        '[add] Required when `parentId` is a conditional — destination arm (`whenTrue` / `whenFalse`). Omit otherwise.'
      ),
    id: z
      .string()
      .optional()
      .describe(
        `[add] Create-time id; required for containers (${CONTAINER_TYPES_TEXT}), auto-minted for leaves. [edit|remove] Required target block id.`
      ),
    fields: FlagValuesSchema.optional().describe(
      '[add] Optional block payload (CLI validates). [edit] Required non-empty fields to overwrite.'
    ),
    cascade: z
      .boolean()
      .default(false)
      .describe(
        '[remove] When true, also delete children. Required for a non-empty container (else CONTAINER_HAS_CHILDREN). Default false.'
      ),
  })
  .superRefine((args, ctx) => {
    const requireString = (field: 'type' | 'parentId' | 'id', message: string): void => {
      if (typeof args[field] !== 'string' || args[field].trim() === '') {
        ctx.addIssue({ code: 'custom', path: [field], message });
      }
    };
    const requireFields = (message: string): void => {
      if (!args.fields || Object.keys(args.fields).length === 0) {
        ctx.addIssue({ code: 'custom', path: ['fields'], message });
      }
    };

    if (args.operation === 'add') {
      requireString('type', 'Adding a block requires `type`.');
      // The CLI rejects an id-less container with CONTAINER_REQUIRES_ID. Catch it
      // at the schema boundary instead so the agent gets the rule stated in MCP
      // terms (`id`, not the CLI's `--id`) before any session mutation is attempted.
      if (typeof args.type === 'string' && CONTAINER_BLOCK_TYPES.has(args.type)) {
        requireString(
          'id',
          `add+block with type "${args.type}" requires \`id\` — container blocks must be addressable so later calls can pass them as \`parentId\`.`
        );
      }
    } else if (args.operation === 'edit') {
      requireString('id', 'Editing a block requires `id`.');
      requireFields('Editing a block requires non-empty `fields`.');
    } else if (args.operation === 'remove') {
      requireString('id', 'Removing a block requires `id`.');
    }
  });

/** Post-parse manage_block args (cascade always present via `.default(false)`). */
type ManageBlockInput = z.infer<typeof ManageBlockInputSchema>;

const AddStepInputSchema = z.object({
  ...ArtifactInputSchema,
  parentId: z.string().min(1).describe('Parent multistep or guided block id.'),
  fields: FlagValuesSchema.refine((fields) => Object.keys(fields).length > 0, {
    message: 'Adding a step requires at least one field.',
  }).describe('Step fields such as action, description, reftarget, and requirements.'),
});

const AddChoiceInputSchema = z.object({
  ...ArtifactInputSchema,
  parentId: z.string().min(1).describe('Parent quiz block id.'),
  fields: FlagValuesSchema.refine((fields) => Object.keys(fields).length > 0, {
    message: 'Adding a choice requires at least one field.',
  }).describe('Choice fields such as id, text, correct, and feedback.'),
});

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
  store: AuthoringSessionStore,
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

/**
 * Map a Zod-validated block operation to its existing CLI runner.
 */
function manageBlockRunner(args: ManageBlockInput): (dir: string) => Promise<CommandOutcome> | CommandOutcome {
  switch (args.operation) {
    case 'add':
      return (dir) =>
        runAddBlock({
          dir,
          // superRefine requires type before the handler runs.
          type: args.type!,
          parentId: args.parentId,
          branch: args.branch,
          explicitId: args.id,
          flagValues: args.fields ?? {},
        });
    case 'edit':
      return (dir) => runEditBlock({ dir, id: args.id!, flagValues: args.fields! });
    case 'remove':
      return (dir) =>
        runRemoveBlock({
          dir,
          id: args.id!,
          cascade: args.cascade,
        });
  }
}

export function registerMutationTools(
  server: McpServer,
  options: { sessionStore: AuthoringSessionStore; mcpSessionId?: string }
): void {
  const { sessionStore, mcpSessionId } = options;

  // Block mutations share one resource-focused tool. Steps and choices remain
  // separate append tools because they are child members with different parent
  // and payload contracts, not addressable blocks.
  server.registerTool(
    'pathfinder_manage_block',
    {
      description: [
        'Use this tool when the user wants to add, edit, or remove a block in a Pathfinder guide.',
        'Adds append under the parent (reorder = remove + re-add). Duplicate ids → DUPLICATE_ID.',
        'Field schemas: pathfinder_help with command "add-block" (subcommand=<type>), "edit-block", or "remove-block" matching `operation`.',
        'CLI flag names (e.g. --content, --action) become keys in `fields`; addressing flags map to tool args (`--parent`→`parentId`, `--id`→`id`, `--branch`→`branch`).',
        'Returns updated artifact (stateless) or session ack (sessionToken).',
      ].join(' '),
      // Conservative: the tool can remove/overwrite, so clients that respect
      // destructiveHint treat the whole surface as confirmation-worthy.
      annotations: writeDestructive('Manage Pathfinder block'),
      inputSchema: ManageBlockInputSchema,
    },
    async (args) =>
      dispatchMutation(
        sessionStore,
        mcpSessionId,
        { artifact: args.artifact, sessionToken: args.sessionToken, expectedGeneration: args.expectedGeneration },
        manageBlockRunner(args)
      )
  );

  server.registerTool(
    'pathfinder_add_step',
    {
      description:
        'Use this tool when the user wants to append a step to a multistep or guided block. Pass `parentId` and step `fields`. Field schemas: pathfinder_help(command="add-step"). CLI flags become `fields` keys (`--action`→`fields.action`); `--parent` is the tool arg `parentId`.',
      annotations: writeAppend('Add Pathfinder step'),
      inputSchema: AddStepInputSchema,
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
        'Use this tool when the user wants to append a choice to a quiz block. Pass `parentId` and choice `fields`. Field schemas: pathfinder_help(command="add-choice"). CLI flags become `fields` keys (`--text`→`fields.text`); `--parent` is the tool arg `parentId`.',
      annotations: writeAppend('Add Pathfinder choice'),
      inputSchema: AddChoiceInputSchema,
    },
    async ({ artifact, sessionToken, expectedGeneration, parentId, fields }) =>
      dispatchMutation(sessionStore, mcpSessionId, { artifact, sessionToken, expectedGeneration }, (dir) =>
        runAddChoice({ dir, parentId, flagValues: fields })
      )
  );

  server.registerTool(
    'pathfinder_set_manifest',
    {
      description:
        'Use this tool when the user wants to set or update top-level Pathfinder guide metadata (description, category, language, etc.) on the package manifest. Field schemas: pathfinder_help(command="set-manifest"). Returns the updated artifact.',
      annotations: writeDestructive('Set Pathfinder manifest', /* idempotent */ true),
      inputSchema: {
        ...ArtifactInputSchema,
        fields: FlagValuesSchema.describe(
          'Manifest fields to set. Discover names via pathfinder_help(command="set-manifest"); CLI flag names become keys here.'
        ),
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
