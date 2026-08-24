/**
 * Contract: cli-routed
 *
 * Thin wrap of CLI tree/manifest commands. `operation` is the Commander
 * command name; `opts` is the help-derived bag. Shared MCP plumbing
 * (tmpdir bridge, `artifact` | `sessionToken`) sits around the runner and
 * is not a second command interface.
 *
 * `opts` is intentionally permissive (`record<string, unknown>`) so the CLI
 * remains the sole content validator.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { runAddBlock } from '../../commands/add-block';
import { runAddChoice } from '../../commands/add-choice';
import { runAddStep } from '../../commands/add-step';
import { runEditBlock } from '../../commands/edit-block';
import { runRemoveBlock } from '../../commands/remove-block';
import { runSetManifest } from '../../commands/set-manifest';
import type { BlockType } from '../../utils/block-registry';
import { ARTIFACT_ETAG_FIELD, computeArtifactEtag } from '../../utils/etag';
import type { CommandOutcome } from '../../utils/output';
import { registerCommandInterfaceConfig, validateCommandArgs } from '../lib/command-interface';
import type { AuthoringSessionStore } from '../lib/session-store';
import { writeAppend } from './annotations';
import { resolveAndPinToken } from './read-input';
import {
  concurrentModificationResult,
  outcomeResult,
  sessionNotFoundResult,
  sessionOutcomeResult,
  sessionTooLargeResult,
  withToolErrorEnvelope,
  type ToolResult,
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
}): ToolResult | null {
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

const OptsSchema = z
  .record(z.string(), z.unknown())
  .describe(
    'Opaque CLI runner parameters keyed exactly as pathfinder_help returns them (camelCase). The CLI is the sole content validator.'
  );

const MANAGE_BLOCK_OPERATIONS = ['add-block', 'edit-block', 'remove-block', 'add-step', 'add-choice'] as const;
const MANAGE_GUIDE_OPERATIONS = ['set-manifest'] as const;

type ManageBlockOperation = (typeof MANAGE_BLOCK_OPERATIONS)[number];
type ManageGuideOperation = (typeof MANAGE_GUIDE_OPERATIONS)[number];
type MutationOperation = ManageBlockOperation | ManageGuideOperation;

/**
 * Stable MCP transport plus a CLI operation and its opaque parameter bag.
 * Operation-specific shape and validation belong to the command interface and
 * imported CLI runner, not this MCP schema.
 */
function mutationSuiteSchema<T extends readonly [string, ...string[]]>(operations: T) {
  return z.object({
    ...ArtifactInputSchema,
    operation: z.enum(operations).describe(`CLI command to run: ${operations.map((name) => `"${name}"`).join(' | ')}.`),
    opts: OptsSchema.describe(
      'Parameters for the selected CLI command, keyed exactly as pathfinder_help returns them.'
    ),
  });
}

const ManageBlockInputSchema = mutationSuiteSchema(MANAGE_BLOCK_OPERATIONS);
const ManageGuideInputSchema = mutationSuiteSchema(MANAGE_GUIDE_OPERATIONS);

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
  envelopeName: string,
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
): Promise<ToolResult> {
  const classified = classifyTwoModeInput({ artifact: inputs.artifact, sessionToken: inputs.sessionToken });
  if (classified.kind === 'error') {
    return classified.response;
  }

  // Capture the (possibly invalid) token for error responses before any
  // throw can escape, so the catch-all envelope can echo it back.
  const rawToken = classified.kind === 'session' ? classified.token : undefined;

  return withToolErrorEnvelope(rawToken, envelopeName, async () => {
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
 * The CLI's CONTAINER_HAS_CHILDREN remedy names `--orphan-children`, which
 * the MCP surface withholds (append-only procedure — see the remove-block
 * `optBlacklist` below). Re-word the remedy in MCP terms so agents are not
 * told to retry with a parameter the validator will reject as unsupported.
 */
function adaptContainerHasChildren(outcome: CommandOutcome): CommandOutcome {
  if (outcome.status !== 'error' || outcome.code !== 'CONTAINER_HAS_CHILDREN') {
    return outcome;
  }
  // The CLI message's first clause is surface-neutral ('Block "x" has N
  // child(ren)'); everything after the semicolon is CLI-flag advice.
  const factClause = outcome.message.split(';')[0];
  return {
    ...outcome,
    message:
      `${factClause}. Pass \`cascade: true\` to remove the block and its entire subtree — destructive, no undo. ` +
      'To keep the children, read them first (pathfinder_read_session with operation "get-block", or pathfinder_inspect), ' +
      'then cascade-remove and re-add them under the parent in display order.',
  };
}

// `before` / `after` / `position` / `orphanChildren` are withheld from the
// MCP interface (blacklisted below → rejected as UNSUPPORTED_PARAMETER before
// any runner is called), so the runners bind only the parameters an agent can
// actually send.
const MUTATION_RUNNERS: Record<
  MutationOperation,
  (dir: string, opts: Record<string, unknown>) => Promise<CommandOutcome> | CommandOutcome
> = {
  'add-block': (dir, opts) =>
    runAddBlock({
      dir,
      type: opts.type as BlockType,
      parentId: opts.parent as string | undefined,
      branch: opts.branch as 'true' | 'false' | undefined,
      ifAbsent: opts.ifAbsent === true,
      explicitId: opts.id as string | undefined,
      flagValues: opts,
    }),
  // The CLI takes the target id positionally, so `editBlock` treats an `id` in
  // the patch as a rename and rejects it. Here `id` is the address, not a
  // field, and must not reach the patch.
  'edit-block': (dir, { id, ...flagValues }) => runEditBlock({ dir, id: id as string, flagValues }),
  'remove-block': async (dir, opts) =>
    adaptContainerHasChildren(
      await runRemoveBlock({
        dir,
        id: opts.id as string,
        cascade: opts.cascade === true,
      })
    ),
  // These runners take the bag as-is and drop `parent` from the projection
  // themselves, so the binding only lifts out the addressing field.
  'add-step': (dir, opts) => runAddStep({ dir, parentId: opts.parent as string, flagValues: opts }),
  'add-choice': (dir, opts) => runAddChoice({ dir, parentId: opts.parent as string, flagValues: opts }),
  'set-manifest': (dir, opts) => runSetManifest({ dir, flagValues: opts }),
};

/** Bind a validated command-interface bag to its CLI runner. */
function mutationRunner(
  operation: MutationOperation,
  opts: Record<string, unknown>
): (dir: string) => Promise<CommandOutcome> | CommandOutcome {
  return (dir) => MUTATION_RUNNERS[operation](dir, opts);
}

export function registerMutationTools(
  server: McpServer,
  options: { sessionStore: AuthoringSessionStore; mcpSessionId?: string }
): void {
  const { sessionStore, mcpSessionId } = options;

  registerCommandInterfaceConfig('add-block', {
    optBlacklist: ['dir', 'before', 'after', 'position'],
    subcommandOpt: 'type',
  });
  registerCommandInterfaceConfig('edit-block', { optBlacklist: ['dir'] });
  registerCommandInterfaceConfig('remove-block', { optBlacklist: ['dir', 'orphanChildren'] });
  registerCommandInterfaceConfig('add-step', { optBlacklist: ['dir'] });
  registerCommandInterfaceConfig('add-choice', { optBlacklist: ['dir'] });
  registerCommandInterfaceConfig('set-manifest', { optBlacklist: ['dir'] });

  const runSuite = async (args: {
    operation: MutationOperation;
    opts: Record<string, unknown>;
    artifact?: {
      content: Record<string, unknown>;
      manifest?: Record<string, unknown>;
      __etag?: string;
    };
    sessionToken?: string;
    expectedGeneration?: number;
  }) => {
    const rejected = validateCommandArgs(args.operation, args.opts);
    if (rejected) {
      return rejected;
    }
    return dispatchMutation(
      sessionStore,
      mcpSessionId,
      // Faulted mutations log e.g. `mutation:add-block`, not a suite-wide name.
      `mutation:${args.operation}`,
      { artifact: args.artifact, sessionToken: args.sessionToken, expectedGeneration: args.expectedGeneration },
      mutationRunner(args.operation, args.opts)
    );
  };

  // Tree writes share one resource-focused tool. `operation` is the CLI
  // command name; `opts` is the help-derived bag for that command.
  server.registerTool(
    'pathfinder_manage_block',
    {
      description: [
        'Use this tool when the user wants to add, edit, or remove a single block, or append a step or quiz choice, in a Pathfinder guide.',
        'Scope: one block at a time, addressed by id inside the guide tree. Guide-level metadata (description, category, language, targeting) is NOT a block operation — use pathfinder_manage_guide for that.',
        'Pass `operation` as the CLI command name: "add-block" | "edit-block" | "remove-block" | "add-step" | "add-choice".',
        'Adds append under the parent (reorder = remove-block + add-block). Duplicate ids → DUPLICATE_ID.',
        'Steps and choices are not individually editable or removable; cascade-remove their parent block and rebuild it instead.',
        'Call pathfinder_help({ command: <operation> }) for the `opts` interface; for add-block, call help again with the chosen block type as `subcommand`.',
        'Returns a session ack (or the updated artifact in stateless mode).',
      ].join(' '),
      // Deliberately NOT destructive: MCP hints are per-tool (no per-operation
      // hints), and every operation here mutates an in-flight authoring
      // artifact, never live Grafana data. Marking the suite destructive
      // would make hint-respecting clients confirm every append.
      annotations: writeAppend('Manage Pathfinder block'),
      inputSchema: ManageBlockInputSchema,
    },
    runSuite
  );

  server.registerTool(
    'pathfinder_manage_guide',
    {
      description: [
        'Use this tool when the user wants to set or update the guide as a whole — top-level Pathfinder metadata on the package manifest (description, category, language, tags, targeting).',
        'Scope: guide-level only, and the usual home for the final metadata pass before validate and finalize. For individual blocks, steps, or choices, use pathfinder_manage_block instead.',
        'Pass `operation` as the CLI command name: "set-manifest".',
        'Call pathfinder_help({ command: "set-manifest" }) for the `opts` interface.',
        'Returns a session ack (or the updated artifact in stateless mode).',
      ].join(' '),
      annotations: writeAppend('Manage Pathfinder guide'),
      inputSchema: ManageGuideInputSchema,
    },
    runSuite
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
