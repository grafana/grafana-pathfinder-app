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
import type { AuthoringSessionStore } from '../lib/session-store';
import { writeDestructive } from './annotations';
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

const NonEmptyFlagValuesSchema = FlagValuesSchema.refine((fields) => Object.keys(fields).length > 0, {
  message: 'At least one field is required.',
});

/**
 * Validation contract with one object schema (so MCP discovery stays
 * flat and readable) plus conditional Zod refinement for the operation × resource matrix.
 */
const ManageBlockInputSchema = z
  .object({
    ...ArtifactInputSchema,
    operation: z.enum(['add', 'edit', 'remove']).describe('Mutation verb.'),
    resource: z
      .enum(['block', 'step', 'choice'])
      .describe('Resource to mutate. Blocks support add/edit/remove; steps and choices currently support add only.'),
    type: z
      .enum(BlockTypeEnum as [string, ...string[]])
      .optional()
      .describe('Required for add+block. Block type discriminator.'),
    parentId: z.string().optional().describe('Optional for add+block; required for add+step and add+choice.'),
    branch: z.enum(['true', 'false']).optional().describe('For add+block with a conditional parent.'),
    ifAbsent: z.boolean().optional().describe('For add+block, skip when a matching id already exists.'),
    explicitId: z.string().optional().describe('For add+block. Required for containers; auto-minted for leaves.'),
    before: z.string().optional().describe('For add+block, insert before this block id.'),
    after: z.string().optional().describe('For add+block, insert after this block id.'),
    position: z.number().int().nonnegative().optional().describe('For add+block, insert at this zero-based index.'),
    fields: FlagValuesSchema.optional().describe(
      'Block, step, or choice fields. Required and non-empty for edit+block, add+step, and add+choice.'
    ),
    id: z.string().optional().describe('Required for edit+block and remove+block.'),
    cascade: z.boolean().default(false).describe('For remove+block, also remove children.'),
    orphanChildren: z.boolean().optional().describe("For remove+block, hoist children to the removed block's parent."),
  })
  .superRefine((args, ctx) => {
    const requireString = (field: 'type' | 'parentId' | 'id', message: string): void => {
      if (typeof args[field] !== 'string' || args[field].trim() === '') {
        ctx.addIssue({ code: 'custom', path: [field], message });
      }
    };
    const requireFields = (message: string): void => {
      const parsed = NonEmptyFlagValuesSchema.safeParse(args.fields);
      if (!parsed.success) {
        ctx.addIssue({ code: 'custom', path: ['fields'], message });
      }
    };

    if (args.operation === 'add' && args.resource === 'block') {
      requireString('type', 'add+block requires `type`.');
    } else if (args.operation === 'add' && (args.resource === 'step' || args.resource === 'choice')) {
      requireString('parentId', `add+${args.resource} requires \`parentId\`.`);
      requireFields(`add+${args.resource} requires non-empty \`fields\`.`);
    } else if (args.operation === 'edit' && args.resource === 'block') {
      requireString('id', 'edit+block requires `id`.');
      requireFields('edit+block requires non-empty `fields`.');
    } else if (args.operation === 'remove' && args.resource === 'block') {
      requireString('id', 'remove+block requires `id`.');
    }
    // edit/remove × step/choice are valid reserved calls. They proceed
    // through two-mode/session checks and return UNSUPPORTED_OPERATION.
  });

type ManageBlockInput = z.infer<typeof ManageBlockInputSchema>;

const UNSUPPORTED_CHILD_MUTATION: CommandOutcome = {
  status: 'error',
  code: 'UNSUPPORTED_OPERATION',
  message:
    'edit/remove of step and choice are not available yet (steps/choices are not individually addressable — see OQ2 in MCP-AGENT-UX-HARDENING). Workaround: pathfinder_manage_block with operation "remove", resource "block", cascade true on the parent multistep/guided/quiz, then re-add children with operation "add".',
};

function invalidManageInput(message: string): CommandOutcome {
  return { status: 'error', code: 'INVALID_INPUT', message };
}

/**
 * Map a Zod-validated operation × resource call to its existing CLI runner.
 * Supported calls cannot reach this function without their required fields.
 */
function manageBlockRunner(args: ManageBlockInput): (dir: string) => Promise<CommandOutcome> | CommandOutcome {
  const { operation, resource } = args;

  // Conditional topology will coalesce once edit and remove exist for steps and choices.
  // Pending future addition of addressability for steps and choices, see OQ2 in MCP-AGENT-UX-HARDENING.
  if ((operation === 'edit' || operation === 'remove') && (resource === 'step' || resource === 'choice')) {
    return () => UNSUPPORTED_CHILD_MUTATION;
  }

  if (resource === 'block') {
    switch (operation) {
      case 'add': {
        return (dir) =>
          runAddBlock({
            dir,
            type: args.type as BlockType,
            parentId: args.parentId,
            branch: args.branch,
            ifAbsent: args.ifAbsent,
            explicitId: args.explicitId,
            before: args.before,
            after: args.after,
            position: args.position,
            flagValues: args.fields ?? {},
          });
      }
      case 'edit': {
        return (dir) => runEditBlock({ dir, id: args.id!, flagValues: args.fields! });
      }
      case 'remove': {
        return (dir) =>
          runRemoveBlock({
            dir,
            id: args.id!,
            cascade: args.cascade,
            orphanChildren: args.orphanChildren,
          });
      }
    }
  }

  // resource === 'step' | 'choice' — only add is live (edit/remove stubbed above).
  if (operation === 'add') {
    if (resource === 'step') {
      return (dir) => runAddStep({ dir, parentId: args.parentId!, flagValues: args.fields! });
    }
    return (dir) => runAddChoice({ dir, parentId: args.parentId!, flagValues: args.fields! });
  }

  return () => invalidManageInput(`Unsupported operation/resource pair: ${operation}/${resource}.`);
}

export function registerMutationTools(
  server: McpServer,
  options: { sessionStore: AuthoringSessionStore; mcpSessionId?: string }
): void {
  const { sessionStore, mcpSessionId } = options;

  // One MCP tool for the whole guide-tree write enablement: operation ×
  // resource. CLI runners stay verb-shaped; this is an MCP-only adapter so
  // agents pay one tool slot for mutating the tree. edit/remove of step and
  // choice are stubbed (UNSUPPORTED_OPERATION) until OQ2 lands.
  server.registerTool(
    'pathfinder_manage_block',
    {
      description:
        'Use this tool when the user wants to mutate the block tree of a Pathfinder guide. Pass `operation: "add" | "edit" | "remove"` and `resource: "block" | "step" | "choice"`. Supported today: add/edit/remove on block; add on step (inside multistep/guided) and choice (inside quiz). edit/remove on step or choice return UNSUPPORTED_OPERATION — workaround: remove the parent block with cascade and re-add children. Field schemas mirror the CLI — call `pathfinder_help` with command "add-block", "edit-block", "remove-block", "add-step", or "add-choice". Returns the updated artifact (or a session ack).',
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
