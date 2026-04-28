/**
 * `pathfinder-cli set-manifest <dir> [flags]` — update manifest fields.
 *
 * Flags are derived from `ManifestJsonObjectSchema`. Only fields with values
 * supplied at the CLI are written; unmentioned fields are preserved.
 */

import { Command } from 'commander';

import { ManifestJsonObjectSchema, ManifestJsonSchema } from '../../types/package.schema';
import type { ManifestJson } from '../../types/package.types';
import { mutateAndValidate, PackageIOError } from '../utils/package-io';
import { issueToOutcome, printOutcome, readOutputOptions, type CommandOutcome } from '../utils/output';
import { parseOptionValues, registerSchemaOptions } from '../utils/schema-options';

export const setManifestCommand = new Command('set-manifest')
  .description('Update manifest fields. Only the flags you pass are changed; everything else is preserved.')
  .argument('<dir>', 'package directory');

registerSchemaOptions(setManifestCommand, ManifestJsonObjectSchema);

setManifestCommand.action(async function (this: Command, dir: string) {
  const opts = this.opts() as Record<string, unknown>;
  const output = readOutputOptions(this);
  const outcome = await runSetManifest({ dir, flagValues: opts });
  process.exit(printOutcome(outcome, output));
});

interface SetManifestArgs {
  dir: string;
  flagValues: Record<string, unknown>;
}

export async function runSetManifest(args: SetManifestArgs): Promise<CommandOutcome> {
  const projected = parseOptionValues(ManifestJsonObjectSchema, args.flagValues) as Record<string, unknown>;

  // The bridge populates every known field — including ones the user didn't
  // pass when an array option was registered with a default `[]`. We need
  // merge semantics here, not replace, so commands like `--description X`
  // don't accidentally clear `depends`. Strip any field whose Commander
  // value source is the registered default.
  const userProvidedKeys = userProvidedFlagNames(args.flagValues);
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(projected)) {
    if (userProvidedKeys.has(key)) {
      patch[key] = projected[key];
    }
  }

  if (Object.keys(patch).length === 0) {
    return {
      status: 'error',
      code: 'NO_CHANGES',
      message: 'set-manifest needs at least one field flag to change. See --help for the field list.',
    };
  }

  let changed: string[] = [];
  try {
    const result = await mutateAndValidate(args.dir, ({ manifest }) => {
      if (!manifest) {
        throw new PackageIOError({
          code: 'CONTENT_MISSING',
          message: 'Package has no manifest.json — set-manifest can only update existing manifests',
        });
      }
      for (const [field, value] of Object.entries(patch)) {
        (manifest as unknown as Record<string, unknown>)[field] = value;
      }
      // Re-parse through the manifest schema to apply any computed defaults
      // and keep the on-disk shape canonical.
      const reparsed = ManifestJsonSchema.parse(manifest);
      Object.assign(manifest, reparsed as ManifestJson);
      changed = Object.keys(patch);
    });
    if (!result.validation.ok) {
      const first = result.validation.issues[0];
      return first
        ? issueToOutcome(first, { issues: result.validation.issues })
        : { status: 'error', code: 'SCHEMA_VALIDATION', message: 'Validation failed after manifest update' };
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
    summary: `Updated manifest in ${args.dir} (changed: ${changed.join(', ')})`,
    details: { changed, 'package valid': true },
    data: { changed },
  };
}

/**
 * Commander populates every option in `cmd.opts()`, including ones the user
 * didn't supply (filled in by `Option#default()`). Distinguishing
 * user-provided from default-populated values matters for the merge-vs-replace
 * semantics in this command. We rely on `getOptionValueSource()` via the
 * Commander v14 instance — but Commander only stores sources on the command
 * itself, so this helper takes the parsed opts and returns user-supplied
 * keys reconstructed from a raw process.argv-like input. For the production
 * code path, the simpler heuristic is "field is not a default empty value
 * set by the bridge" — empty arrays from the bridge default come back the
 * same; treating any `[]` as not-user-supplied works because the bridge sets
 * `default([])` only for repeatable flags.
 */
function userProvidedFlagNames(values: Record<string, unknown>): Set<string> {
  const provided = new Set<string>();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value) && value.length === 0) {
      // Bridge default — treat as not-supplied.
      continue;
    }
    if (typeof value === 'boolean' && value === false) {
      // Boolean flag not set on the CLI; Commander leaves it `undefined`
      // unless explicitly defaulted, but be defensive.
      continue;
    }
    provided.add(key);
  }
  return provided;
}
