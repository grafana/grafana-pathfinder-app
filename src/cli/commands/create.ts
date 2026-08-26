/**
 * `pathfinder-cli create <dir>` — create a new guide package.
 *
 * Writes a fresh `content.json` and `manifest.json` in `<dir>`, generating a
 * default kebab-case id from the title when `--id` is omitted.
 *
 * The id derivation used to be duplicated in the Commander action and the MCP binding,
 * with two different error messages for the same bad input. It lives in the runner
 * now, the one place both adapters reach.
 */

import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

import { defineCommand, mountCommander } from '../contracts';
import {
  ContentJsonSchema,
  ManifestJsonObjectSchema,
  PackageTypeSchema,
  packageIdSchema,
} from '../../types/package.schema';
import { defaultPackageId } from '../utils/auto-id';
import { newPackageState, PackageIOError, validatePackageState, writePackage } from '../utils/package-io';
import { issueToOutcome, renderError, type CommandOutcome } from '../utils/output';

// Every field below is the same Zod instance the artifact schemas use for
// `content.json` / `manifest.json` (`.describe()`/`.meta()` wrap it without
// changing its validation) — a bare `z.string()` copy here would happily
// accept an empty title or a non-kebab id that `newPackageState` rejects two
// steps later with a less specific error.
export const CreateCommand = z.object({
  dir: z.string().describe('package directory to create (must not exist or must be empty)').meta({ role: 'io' }),
  title: ContentJsonSchema.shape.title.describe('Guide title shown to learners').meta({ role: 'content' }),
  id: packageIdSchema
    .optional()
    .describe('Package identifier (kebab-case). Auto-generated from title when omitted')
    .meta({ role: 'content' }),
  type: PackageTypeSchema.default('guide').describe('Package type').meta({ role: 'content' }),
  description: ManifestJsonObjectSchema.shape.description
    .describe('Short description shown in catalogs and recommenders')
    .meta({ role: 'content' }),
});

export type CreateInput = z.output<typeof CreateCommand>;

function deriveId(title: string): string | null {
  try {
    return defaultPackageId(title);
  } catch {
    return null;
  }
}

/**
 * Pure(ish) command body, separated from the adapter wiring so tests can
 * exercise the read/validate/write flow without spawning a subprocess.
 *
 * Returns a structured `CommandOutcome` rather than printing directly so
 * `printOutcome` owns the rendering decision (text vs --quiet vs JSON).
 */
export async function runCreate(args: CreateInput): Promise<CommandOutcome> {
  const id = args.id ?? deriveId(args.title);
  if (!id) {
    return {
      status: 'error',
      code: 'INVALID_TITLE',
      message:
        'Title must contain at least one alphanumeric character so an id can be generated. Pass id explicitly to override.',
    };
  }

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
    state = newPackageState({ id, title: args.title, type: args.type, description: args.description });
  } catch (err) {
    return {
      status: 'error',
      code: 'SCHEMA_VALIDATION',
      message: renderError(err),
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
      message: renderError(err),
    };
  }

  return {
    status: 'ok',
    summary: `Created package ${path.basename(args.dir)}/ (id: ${id})`,
    details: {
      id,
      title: args.title,
      type: args.type,
      schemaVersion: state.content.schemaVersion ?? '',
      repository: state.manifest?.repository ?? '',
      language: state.manifest?.language ?? '',
      'testEnvironment.tier': state.manifest?.testEnvironment?.tier ?? '',
      blocks: 0,
    },
    hints: [`Add blocks with: pathfinder-cli add-block <type> ${args.dir} [flags]`],
    data: {
      id,
      dir: args.dir,
      schemaVersion: state.content.schemaVersion,
    },
  };
}

export const createSpec = defineCommand({
  name: 'create',
  summary: 'Create a new guide package directory with content.json and manifest.json',
  schema: CreateCommand,
  run: runCreate,
});

// `<type>` rather than the generated `<guide|path|journey>`: the choices are already
// spelled out in the description, and the wider token rewraps every other option.
export const createCommand = mountCommander(createSpec, { positionals: ['dir'], placeholders: { type: 'type' } });
