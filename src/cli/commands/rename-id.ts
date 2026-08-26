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

import { z } from 'zod';

import { packageIdSchema } from '../../types/package.schema';
import { defineCommand, mountCommander } from '../contracts';
import { mutateAndValidate, PackageIOError } from '../utils/package-io';
import { issueToOutcome, renderError, type CommandOutcome } from '../utils/output';

export const RenameIdCommand = z.object({
  dir: z.string().describe('package directory').meta({ role: 'io' }),
  // Same schema `content.id`/`manifest.id` validate against — a bare
  // `z.string()` here would let a bad id past the CommandSpec parse and rely
  // on a second, hand-written regex check to reject it later.
  newId: packageIdSchema.describe('new package id (kebab-case)').meta({ role: 'content' }),
});

export type RenameIdInput = z.output<typeof RenameIdCommand>;

export async function runRenameId(args: RenameIdInput): Promise<CommandOutcome> {
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

export const renameIdSpec = defineCommand({
  name: 'rename-id',
  summary: 'Atomically rename a package id in both content.json and manifest.json',
  schema: RenameIdCommand,
  run: runRenameId,
});

// `new-id` keeps the hyphenated spelling the usage line has always shown; the schema
// field is `newId`, which is what Commander would print unaided.
export const renameIdCommand = mountCommander(renameIdSpec, {
  positionals: ['dir', 'newId'],
  placeholders: { newId: 'new-id' },
});
