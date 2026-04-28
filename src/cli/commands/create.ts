/**
 * `pathfinder-cli create <dir>` — create a new guide package.
 *
 * Writes a fresh `content.json` and `manifest.json` in `<dir>`, generating a
 * default kebab-case id from the title when `--id` is omitted.
 */

import { Command, Option } from 'commander';
import * as fs from 'fs';
import * as path from 'path';

import { defaultPackageId } from '../utils/auto-id';
import { newPackageState, PackageIOError, validatePackageState, writePackage } from '../utils/package-io';
import { issueToOutcome, printOutcome, readOutputOptions, type CommandOutcome } from '../utils/output';

export const createCommand = new Command('create')
  .description('Create a new guide package directory with content.json and manifest.json')
  .argument('<dir>', 'package directory to create (must not exist or must be empty)')
  .addOption(new Option('--title <string>', 'Guide title shown to learners').makeOptionMandatory())
  .addOption(new Option('--id <string>', 'Package identifier (kebab-case). Auto-generated from title when omitted'))
  .addOption(new Option('--type <type>', 'Package type').choices(['guide', 'path', 'journey']).default('guide'))
  .addOption(new Option('--description <string>', 'Short description shown in catalogs and recommenders'))
  .action(async function (this: Command, dir: string) {
    const opts = this.opts() as {
      title: string;
      id?: string;
      type: 'guide' | 'path' | 'journey';
      description?: string;
    };
    const output = readOutputOptions(this);

    const id = opts.id ?? deriveId(opts.title);
    if (!id) {
      const exitCode = printOutcome(
        {
          status: 'error',
          code: 'INVALID_TITLE',
          message:
            'Title must contain at least one alphanumeric character so an id can be generated. Pass --id explicitly to override.',
        },
        output
      );
      process.exit(exitCode);
    }

    const outcome = await runCreate({ dir, id, title: opts.title, type: opts.type, description: opts.description });
    process.exit(printOutcome(outcome, output));
  });

function deriveId(title: string): string | null {
  try {
    return defaultPackageId(title);
  } catch {
    return null;
  }
}

interface CreateArgs {
  dir: string;
  id: string;
  title: string;
  type: 'guide' | 'path' | 'journey';
  description?: string;
}

/**
 * Pure(ish) command body, separated from the Commander wiring so tests can
 * exercise the read/validate/write flow without spawning a subprocess.
 *
 * Returns a structured `CommandOutcome` rather than printing directly so
 * `printOutcome` owns the rendering decision (text vs --quiet vs JSON).
 */
export async function runCreate(args: CreateArgs): Promise<CommandOutcome> {
  if (fs.existsSync(args.dir)) {
    const entries = fs.readdirSync(args.dir);
    if (entries.length > 0) {
      return {
        status: 'error',
        code: 'DIR_NOT_EMPTY',
        message: `Directory "${args.dir}" already exists and is not empty.`,
      };
    }
  }

  let state;
  try {
    state = newPackageState({ id: args.id, title: args.title, type: args.type, description: args.description });
  } catch (err) {
    return {
      status: 'error',
      code: 'SCHEMA_VALIDATION',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  // Sanity-check the freshly built state — `newPackageState` already runs
  // `ManifestJsonSchema.parse`, but composing through the validator here
  // catches any drift between the builder and the cross-file checks.
  const validation = validatePackageState(state.content, state.manifest);
  if (!validation.ok) {
    const first = validation.issues[0];
    if (!first) {
      return { status: 'error', code: 'SCHEMA_VALIDATION', message: 'Package state is invalid' };
    }
    return issueToOutcome(first, { issues: validation.issues });
  }

  try {
    writePackage(args.dir, state);
  } catch (err) {
    if (err instanceof PackageIOError) {
      return issueToOutcome(err.issues[0] ?? { code: err.code, message: err.message });
    }
    return {
      status: 'error',
      code: 'WRITE_FAILED',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  return {
    status: 'ok',
    summary: `Created package ${path.basename(args.dir)}/ (id: ${args.id})`,
    details: {
      id: args.id,
      title: args.title,
      type: args.type,
      schemaVersion: state.content.schemaVersion ?? '',
      blocks: 0,
    },
    hints: [`Add blocks with: pathfinder-cli add-block ${args.dir} <type> [flags]`],
    data: {
      id: args.id,
      dir: args.dir,
      schemaVersion: state.content.schemaVersion,
    },
  };
}
