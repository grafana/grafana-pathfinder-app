/**
 * `pathfinder-cli edit-block <dir> <id> [flags]` — update fields on an
 * existing block. Scalar fields use merge semantics; arrays replace
 * entirely. Structural fields and `--type` are rejected.
 */

import { Command, Option } from 'commander';

import { editBlock, findBlockById, mutateAndValidate, PackageIOError, readPackage } from '../utils/package-io';
import { issueToOutcome, printOutcome, readOutputOptions, type CommandOutcome } from '../utils/output';
import { BLOCK_SCHEMA_MAP, type BlockType } from '../utils/block-registry';
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

editBlockCommand
  // After the schema-derived options register, ensure --quiet / --format
  // remain visible from the parent.
  .addOption(new Option('--no-validate', 'Skip post-edit validation (advanced)').hideHelp())
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
    return { status: 'error', code: 'NOT_FOUND', message: err instanceof Error ? err.message : String(err) };
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

  let changed: string[] = [];
  try {
    const result = await mutateAndValidate(args.dir, ({ content }) => {
      const r = editBlock(content, args.id, { patch });
      changed = r.changed;
    });
    if (!result.validation.ok) {
      const first = result.validation.issues[0];
      return first
        ? issueToOutcome(first, { issues: result.validation.issues })
        : { status: 'error', code: 'SCHEMA_VALIDATION', message: 'Validation failed after edit' };
    }
  } catch (err) {
    if (err instanceof PackageIOError) {
      return issueToOutcome(err.issues[0] ?? { code: err.code, message: err.message });
    }
    return {
      status: 'error',
      code: 'SCHEMA_VALIDATION',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  return {
    status: 'ok',
    summary: `Updated ${blockType} block "${args.id}" (changed: ${changed.join(', ')})`,
    details: { type: blockType, id: args.id, changed, 'package valid': true },
    data: { type: blockType, id: args.id, changed },
  };
}
