/**
 * `pathfinder-cli set-manifest <dir> [flags]` — update manifest fields.
 *
 * Flat scalar flags are derived from `ManifestJsonObjectSchema` via the
 * schema-options bridge. Nested-object fields (`author`, `targeting`,
 * `testEnvironment`) are exposed as flat flags here and merged into the
 * existing manifest shape so the user never has to hand-build the nested
 * JSON. Only fields with values supplied at the CLI are written; unmentioned
 * fields are preserved.
 */

import { Command, Option } from 'commander';

import { ManifestJsonObjectSchema, ManifestJsonSchema } from '../../types/package.schema';
import type { ManifestJson } from '../../types/package.types';
import { assertCliManifestFields, assertSemver, CliValidationError } from '../utils/cli-validators';
import { mutateAndValidate, PackageIOError } from '../utils/package-io';
import {
  issueToOutcome,
  manyIssuesOutcome,
  printOutcome,
  readOutputOptions,
  renderError,
  type CommandOutcome,
} from '../utils/output';
import { parseOptionValues, registerSchemaOptions } from '../utils/schema-options';

export const setManifestCommand = new Command('set-manifest')
  .description('Update manifest fields. Only the flags you pass are changed; everything else is preserved.')
  .argument('<dir>', 'package directory');

// `forceOptional` because set-manifest is patch-only — schema-level
// requireds (`id`, `type`) are filled in by the existing manifest, not by
// the user, and the action handler skips bridge-defaulted empties.
registerSchemaOptions(setManifestCommand, ManifestJsonObjectSchema, { forceOptional: true });

// Structural / nested-object flat flags. These project onto manifest.author,
// manifest.testEnvironment, and manifest.targeting respectively. The bridge
// declines to expose nested-object fields directly because there's no clean
// one-flag-per-key mapping; we hand-craft a flat surface here so authors
// don't need to drop to a text editor for these common fields.
setManifestCommand
  .addOption(new Option('--author-name <string>', 'manifest.author.name'))
  .addOption(new Option('--author-team <string>', 'manifest.author.team'))
  .addOption(new Option('--test-tier <string>', 'manifest.testEnvironment.tier (e.g., local, cloud)'))
  .addOption(new Option('--test-min-version <semver>', 'manifest.testEnvironment.minVersion (semver)'))
  .addOption(new Option('--test-instance <string>', 'manifest.testEnvironment.instance'))
  .addOption(
    new Option(
      '--target-url-prefix <string>',
      'Append { urlPrefix: <value> } to manifest.targeting.match.and (use multiple times to add several clauses)'
    ).argParser((value: string, prev: string[] | undefined) => [...(prev ?? []), value])
  )
  .addOption(
    new Option('--target-platform <platform>', 'Append { targetPlatform: <value> } to manifest.targeting.match.and')
      .choices(['oss', 'cloud', 'enterprise'])
      .argParser((value: string, prev: string[] | undefined) => [...(prev ?? []), value])
  )
  .addOption(
    new Option(
      '--target-and <json>',
      'Replace manifest.targeting.match.and with this raw JSON array (escape hatch for complex targeting)'
    )
  );

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

interface StructuralPatch {
  author?: { name?: string; team?: string };
  testEnvironment?: { tier?: string; minVersion?: string; instance?: string };
  targeting?: { match: { and: Array<Record<string, unknown>> } };
  /** Sentinel marker so the mutator knows to fully replace targeting.match.and. */
  targetingAndReplace?: Array<Record<string, unknown>>;
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

  // Pull our hand-crafted nested flags out of the raw flag values and build
  // a structural patch the mutator deep-merges onto the existing manifest.
  // buildStructuralPatch can throw CliValidationError for malformed --target-and
  // JSON; route that through the standard error printer rather than letting it
  // surface as an uncaught stack trace.
  let structural: StructuralPatch | undefined;
  try {
    structural = buildStructuralPatch(args.flagValues);
  } catch (err) {
    if (err instanceof CliValidationError) {
      return { status: 'error', code: 'SCHEMA_VALIDATION', message: err.message };
    }
    throw err;
  }

  if (Object.keys(patch).length === 0 && structural === undefined) {
    return {
      status: 'error',
      code: 'NO_CHANGES',
      message: 'set-manifest needs at least one field flag to change. See --help for the field list.',
    };
  }

  // CLI-strict semantic checks (semver schemaVersion, http(s) repository,
  // kebab-case package id refs, non-empty description, ...). Schemas stay
  // loose; the CLI gate is here.
  try {
    assertCliManifestFields(patch);
    if (structural?.testEnvironment?.minVersion !== undefined) {
      assertSemver(structural.testEnvironment.minVersion, 'testEnvironment.minVersion');
    }
  } catch (err) {
    if (err instanceof CliValidationError) {
      return { status: 'error', code: 'SCHEMA_VALIDATION', message: err.message };
    }
    throw err;
  }

  const changedFields = new Set<string>(Object.keys(patch));
  let writeResult;
  try {
    writeResult = await mutateAndValidate(args.dir, (state) => {
      const { content, manifest } = state;
      if (!manifest) {
        throw new PackageIOError({
          code: 'CONTENT_MISSING',
          message: 'Package has no manifest.json — set-manifest can only update existing manifests',
        });
      }
      for (const [field, value] of Object.entries(patch)) {
        (manifest as unknown as Record<string, unknown>)[field] = value;
      }
      // Keep content.json's schemaVersion in lockstep with manifest.json's
      // when the user explicitly bumps it via set-manifest. Without this the
      // two files drift silently and the cross-file consistency check
      // (in validatePackageState) flags it. Also flip the authored flag so
      // the value is persisted on write (writePackage strips defaulted
      // schemaVersion to avoid retroactively activating drift checks).
      if (Object.prototype.hasOwnProperty.call(patch, 'schemaVersion')) {
        content.schemaVersion = patch.schemaVersion as string;
        state.manifestSchemaVersionAuthored = true;
      }
      // Apply nested structural fields (author / testEnvironment / targeting)
      // by deep-merging onto whatever is already there. Records existing keys
      // in `changedFields` so the success summary is accurate.
      applyStructural(manifest, structural, changedFields);
      // Re-parse through the manifest schema to apply any computed defaults
      // and keep the on-disk shape canonical.
      const reparsed = ManifestJsonSchema.parse(manifest);
      Object.assign(manifest, reparsed as ManifestJson);
    });
    if (!writeResult.validation.ok) {
      const issues = writeResult.validation.issues;
      if (issues.length === 0) {
        return { status: 'error', code: 'SCHEMA_VALIDATION', message: 'Validation failed after manifest update' };
      }
      if (issues.length === 1) {
        return issueToOutcome(issues[0]!, { issues });
      }
      const multi = manyIssuesOutcome(issues, 'manifest');
      return { ...multi, code: issues[0]!.code, data: { ...(multi.data ?? {}), issues } };
    }
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

  const changed = [...changedFields];
  const legacyIdsMinted = writeResult.state.idsAssignedOnRead ?? 0;
  return {
    status: 'ok',
    summary: `Updated manifest in ${args.dir} (changed: ${changed.join(', ')})`,
    details: {
      changed,
      'package valid': true,
      ...(legacyIdsMinted > 0 ? { 'ids minted on legacy blocks': legacyIdsMinted } : {}),
    },
    data: {
      changed,
      ...(legacyIdsMinted > 0 ? { idsAssignedOnRead: legacyIdsMinted } : {}),
    },
  };
}

/**
 * Read the structural flat-flag values off the parsed CLI opts and shape them
 * into a deep-mergeable patch. Returns undefined when no structural flag was
 * supplied so callers can short-circuit.
 */
function buildStructuralPatch(values: Record<string, unknown>): StructuralPatch | undefined {
  const out: StructuralPatch = {};

  const authorName = readString(values.authorName);
  const authorTeam = readString(values.authorTeam);
  if (authorName !== undefined || authorTeam !== undefined) {
    out.author = {
      ...(authorName !== undefined ? { name: authorName } : {}),
      ...(authorTeam !== undefined ? { team: authorTeam } : {}),
    };
  }

  const testTier = readString(values.testTier);
  const testMinVersion = readString(values.testMinVersion);
  const testInstance = readString(values.testInstance);
  if (testTier !== undefined || testMinVersion !== undefined || testInstance !== undefined) {
    out.testEnvironment = {
      ...(testTier !== undefined ? { tier: testTier } : {}),
      ...(testMinVersion !== undefined ? { minVersion: testMinVersion } : {}),
      ...(testInstance !== undefined ? { instance: testInstance } : {}),
    };
  }

  // Targeting: --target-and replaces the whole and-array; --target-url-prefix
  // and --target-platform append clauses. The two modes are mutually
  // exclusive in practice but we don't enforce it — the replace wins.
  const targetAndJson = readString(values.targetAnd);
  if (targetAndJson !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(targetAndJson);
    } catch {
      throw new CliValidationError('targeting.match.and', `--target-and must be valid JSON: ${targetAndJson}`);
    }
    if (!Array.isArray(parsed)) {
      throw new CliValidationError('targeting.match.and', '--target-and must be a JSON array');
    }
    out.targetingAndReplace = parsed as Array<Record<string, unknown>>;
  } else {
    const urlPrefixes = readStringArray(values.targetUrlPrefix);
    const platforms = readStringArray(values.targetPlatform);
    if ((urlPrefixes && urlPrefixes.length > 0) || (platforms && platforms.length > 0)) {
      const and: Array<Record<string, unknown>> = [];
      for (const prefix of urlPrefixes ?? []) {
        and.push({ urlPrefix: prefix });
      }
      for (const platform of platforms ?? []) {
        and.push({ targetPlatform: platform });
      }
      out.targeting = { match: { and } };
    }
  }

  return Object.keys(out).length === 0 ? undefined : out;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

/**
 * Deep-merge structural patch onto the manifest. Existing nested values on
 * untouched keys are preserved (e.g., `--author-name X` keeps the existing
 * `team` if any).
 */
function applyStructural(manifest: ManifestJson, structural: StructuralPatch | undefined, changed: Set<string>): void {
  if (!structural) {
    return;
  }
  const m = manifest as unknown as Record<string, unknown>;

  if (structural.author) {
    const existing = (m.author as Record<string, unknown> | undefined) ?? {};
    m.author = { ...existing, ...structural.author };
    changed.add('author');
  }

  if (structural.testEnvironment) {
    const existing = (m.testEnvironment as Record<string, unknown> | undefined) ?? {};
    m.testEnvironment = { ...existing, ...structural.testEnvironment };
    changed.add('testEnvironment');
  }

  if (structural.targetingAndReplace !== undefined) {
    const existing = (m.targeting as { match?: Record<string, unknown> } | undefined) ?? {};
    const existingMatch = (existing.match as Record<string, unknown> | undefined) ?? {};
    m.targeting = { ...existing, match: { ...existingMatch, and: structural.targetingAndReplace } };
    changed.add('targeting');
  } else if (structural.targeting) {
    const existing = (m.targeting as { match?: Record<string, unknown> } | undefined) ?? {};
    const existingMatch = (existing.match as Record<string, unknown> | undefined) ?? {};
    const existingAnd = Array.isArray(existingMatch.and) ? (existingMatch.and as Array<Record<string, unknown>>) : [];
    const merged = [...existingAnd, ...structural.targeting.match.and];
    m.targeting = { ...existing, match: { ...existingMatch, and: merged } };
    changed.add('targeting');
  }
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
