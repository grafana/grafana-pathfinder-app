/**
 * `pathfinder-cli edit-block <dir> <id> [flags]` — update fields on an
 * existing block. Scalar fields use merge semantics; arrays replace
 * entirely. Structural fields and `--type` are rejected.
 */

import { Command, Option } from 'commander';

import { editBlock, findBlockById, mutateAndValidate, PackageIOError, readPackage } from '../utils/package-io';
import {
  issueToOutcome,
  manyIssuesOutcome,
  printOutcome,
  readOutputOptions,
  renderError,
  type CommandOutcome,
} from '../utils/output';
import { BLOCK_SCHEMA_MAP, type BlockType } from '../utils/block-registry';
import { assertCliBlockFields, CliValidationError } from '../utils/cli-validators';
import { parseOptionValues, registerSchemaOptions } from '../utils/schema-options';

export const editBlockCommand = new Command('edit-block')
  .description('Update fields on an existing block by id')
  .argument('<dir>', 'package directory')
  .argument('<id>', 'id of the block to edit')
  // We can't know the block type until we read it from disk, so register a
  // permissive set of options. Each block-specific option is added below
  // for completeness — the action handler validates the resulting block
  // shape against the schema for the actual block type after the patch.
  .allowUnknownOption(true);

// Aggregate every flag that any block schema exposes. Multiple schemas share
// fields like `--id` and `--content`; `skipExisting: true` keeps the first
// occurrence (with its first-found .describe() text) and ignores duplicates.
// `forceOptional: true` strips mandatory-flag markers — fields that are
// required at *create* time (e.g., image.src) are merely optional at patch
// time. The action handler uses the block's actual schema to project values
// and then re-validates, so flags not relevant to a given block type are
// silently dropped.
for (const schema of Object.values(BLOCK_SCHEMA_MAP)) {
  registerSchemaOptions(editBlockCommand, schema, { skipExisting: true, forceOptional: true });
}

// `--id` is in `id` is in the forbid-list inside editBlock (block-level rename
// requires updating every reference in the package, which is non-trivial),
// so hide it from --help. Keeping the flag registered (rather than removing)
// preserves Commander parsing — passing `--id` still produces a structured
// error from editBlock rather than Commander's "unknown option".
const idOption = editBlockCommand.options.find((o) => o.long === '--id');
if (idOption) {
  idOption.hideHelp(true);
}

editBlockCommand
  // After the schema-derived options register, ensure --quiet / --format
  // remain visible from the parent.
  .addOption(new Option('--no-validate', 'Skip post-edit validation (advanced)').hideHelp())
  // Recognize position-shaped flags so Commander's "too many arguments" error
  // doesn't mislead authors. The action handler intercepts and redirects to
  // move-block.
  .addOption(new Option('--position <n>', 'Reordering is not handled here — use move-block').hideHelp())
  .addOption(new Option('--before <id>', 'Reordering is not handled here — use move-block').hideHelp())
  .addOption(new Option('--after <id>', 'Reordering is not handled here — use move-block').hideHelp())
  .action(async function (this: Command, dir: string, id: string) {
    const opts = this.opts() as Record<string, unknown>;
    const output = readOutputOptions(this);
    const outcome = await runEditBlock({ dir, id, flagValues: opts });
    process.exit(printOutcome(outcome, output));
  });

interface EditBlockArgs {
  dir: string;
  id: string;
  flagValues: Record<string, unknown>;
}

export async function runEditBlock(args: EditBlockArgs): Promise<CommandOutcome> {
  // Reordering attempts are accepted by the parser (so users don't see
  // Commander's misleading "too many arguments") but redirected here.
  for (const reorderFlag of ['position', 'before', 'after'] as const) {
    if (args.flagValues[reorderFlag] !== undefined) {
      return {
        status: 'error',
        code: 'SCHEMA_VALIDATION',
        message: `edit-block does not change block position. Use: pathfinder-cli move-block <dir> ${args.id} --${reorderFlag === 'position' ? 'to-position' : reorderFlag} <value>`,
      };
    }
  }

  // Inspect the block first to figure out which schema its flags must
  // project through. This is the price of a single command targeting any
  // block type — we pay one read up front.
  let blockType: BlockType;
  try {
    const state = readPackage(args.dir);
    const block = findBlockById(state.content, args.id);
    if (!block) {
      return {
        status: 'error',
        code: 'BLOCK_NOT_FOUND',
        message: `Block "${args.id}" not found in ${args.dir}`,
      };
    }
    blockType = block.type as BlockType;
  } catch (err) {
    if (err instanceof PackageIOError) {
      return issueToOutcome(err.issues[0] ?? { code: err.code, message: err.message });
    }
    return { status: 'error', code: 'NOT_FOUND', message: renderError(err) };
  }

  const schema = BLOCK_SCHEMA_MAP[blockType];
  if (!schema) {
    return {
      status: 'error',
      code: 'BLOCK_NOT_FOUND',
      message: `Block "${args.id}" is type "${blockType}" which the CLI cannot edit (excluded from authoring surface)`,
    };
  }

  const patch = parseOptionValues(schema, args.flagValues) as Record<string, unknown>;
  // Drop bridge-defaulted empties — the user didn't provide them, so we
  // shouldn't accidentally clobber existing values.
  for (const [k, v] of Object.entries(patch)) {
    if (Array.isArray(v) && v.length === 0) {
      delete patch[k];
    }
  }

  if (Object.keys(patch).length === 0) {
    return {
      status: 'error',
      code: 'NO_CHANGES',
      message: 'edit-block needs at least one field flag to change. See --help for the field list of this block type.',
    };
  }

  // CLI-strict semantic checks against the patch values.
  try {
    assertCliBlockFields(blockType, patch);
  } catch (err) {
    if (err instanceof CliValidationError) {
      return { status: 'error', code: 'SCHEMA_VALIDATION', message: err.message };
    }
    throw err;
  }

  let changed: string[] = [];
  let legacyIdsMinted = 0;
  try {
    const result = await mutateAndValidate(args.dir, ({ content }) => {
      const r = editBlock(content, args.id, { patch });
      changed = r.changed;
    });
    if (!result.validation.ok) {
      const issues = result.validation.issues;
      if (issues.length === 0) {
        return { status: 'error', code: 'SCHEMA_VALIDATION', message: 'Validation failed after edit' };
      }
      if (issues.length === 1) {
        return issueToOutcome(issues[0]!, { issues });
      }
      const multi = manyIssuesOutcome(issues, `${blockType} block`);
      return { ...multi, code: issues[0]!.code, data: { ...(multi.data ?? {}), issues } };
    }
    legacyIdsMinted = result.state.idsAssignedOnRead ?? 0;
  } catch (err) {
    if (err instanceof PackageIOError) {
      return issueToOutcome(err.issues[0] ?? { code: err.code, message: err.message });
    }
    return {
      status: 'error',
      code: 'SCHEMA_VALIDATION',
      message: renderError(err),
    };
  }

  return {
    status: 'ok',
    summary: `Updated ${blockType} block "${args.id}" (changed: ${changed.join(', ')})`,
    details: {
      type: blockType,
      id: args.id,
      changed,
      'package valid': true,
      ...(legacyIdsMinted > 0 ? { 'ids minted on legacy blocks': legacyIdsMinted } : {}),
    },
    data: {
      type: blockType,
      id: args.id,
      changed,
      ...(legacyIdsMinted > 0 ? { idsAssignedOnRead: legacyIdsMinted } : {}),
    },
  };
}
