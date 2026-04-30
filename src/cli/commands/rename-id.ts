/**
 * `pathfinder-cli rename-id <dir> <new-id>` — atomically rename a package's
 * id in both content.json and manifest.json.
 *
 * The ID-mismatch error in `validatePackageState` previously had no remediation
 * path through the CLI: `set-manifest --id` errored on mismatch (because
 * content.json wasn't updated), and `edit-block` refuses to touch the `id`
 * field. This command closes that hole.
 *
 * Block-level id renames (renaming an interactive block from `tour-home` to
 * `tour-start`) remain out of scope; doing those safely requires walking the
 * tree to update every reference. See the TODO at the edit-block forbid-list
 * site.
 */

import { Command } from 'commander';

import { PACKAGE_ID_REGEX } from '../../types/package.schema';
import { mutateAndValidate, PackageIOError } from '../utils/package-io';
import { issueToOutcome, printOutcome, readOutputOptions, renderError, type CommandOutcome } from '../utils/output';

export const renameIdCommand = new Command('rename-id')
  .description('Atomically rename a package id in both content.json and manifest.json')
  .argument('<dir>', 'package directory')
  .argument('<new-id>', 'new package id (kebab-case, must match PACKAGE_ID_REGEX)')
  .action(async function (this: Command, dir: string, newId: string) {
    const output = readOutputOptions(this);
    const outcome = await runRenameId({ dir, newId });
    process.exit(printOutcome(outcome, output));
  });

interface RenameIdArgs {
  dir: string;
  newId: string;
}

export async function runRenameId(args: RenameIdArgs): Promise<CommandOutcome> {
  if (!PACKAGE_ID_REGEX.test(args.newId)) {
    return {
      status: 'error',
      code: 'SCHEMA_VALIDATION',
      message: `id must be kebab-case (lowercase alphanumeric and hyphens, no leading/trailing hyphen): "${args.newId}"`,
    };
  }

  let oldId = '';
  let renamed = false;
  try {
    const result = await mutateAndValidate(args.dir, ({ content, manifest }) => {
      oldId = content.id;
      if (oldId === args.newId) {
        return; // No-op
      }
      content.id = args.newId;
      if (manifest) {
        manifest.id = args.newId;
      }
      renamed = true;
    });
    if (!result.validation.ok) {
      const first = result.validation.issues[0];
      return first
        ? issueToOutcome(first, { issues: result.validation.issues })
        : { status: 'error', code: 'SCHEMA_VALIDATION', message: 'Validation failed after rename-id' };
    }
  } catch (err) {
    if (err instanceof PackageIOError) {
      return issueToOutcome(err.issues[0] ?? { code: err.code, message: err.message });
    }
    return { status: 'error', code: 'SCHEMA_VALIDATION', message: renderError(err) };
  }

  if (!renamed) {
    return {
      status: 'ok',
      summary: `Package id is already "${args.newId}" (no change)`,
      details: { id: args.newId, 'package valid': true },
      data: { id: args.newId, renamed: false },
    };
  }

  return {
    status: 'ok',
    summary: `Renamed package id from "${oldId}" to "${args.newId}"`,
    details: {
      'old id': oldId,
      'new id': args.newId,
      'package valid': true,
    },
    hints: [
      // The directory name often equals the old id; nudge the user to rename
      // it manually so on-disk state matches the package id.
      `If the directory name still references "${oldId}", consider renaming it: mv ${args.dir} <new-dir>`,
    ],
    data: { oldId, newId: args.newId, renamed: true },
  };
}
