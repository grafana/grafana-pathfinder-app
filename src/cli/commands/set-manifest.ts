/**
 * `pathfinder-cli set-manifest <dir> [flags]` — update manifest fields.
 *
 * Patch semantics are stated by the schema rather than reconstructed by the runner:
 * every field is optional and default-free (`patchShape`), and Commander's defaults
 * are dropped by source, so absence is an omitted key on both entrypoints (§8.5
 * decision (b)). That is what retired the heuristic reading `false` and `[]` as
 * "unset" — an agent can now clear an array field by sending `[]`.
 *
 * Nested manifest objects are patched through flat prefixed parameters, since an
 * object has no flag spelling. `NESTED_PARAMS` is the single declaration of that
 * projection — schema fields, help text, and the patch the runner applies — and its
 * paths are typed against `ManifestJson`, so a flat parameter cannot name a nested
 * field that does not exist.
 */

import { z } from 'zod';

import { ManifestJsonObjectSchema, ManifestJsonSchema } from '../../types/package.schema';
import type { ManifestJson } from '../../types/package.types';
import { defineCommand, mountCommander, patchShape, pickSupplied, withPolicy } from '../contracts';
import { assertCliManifestFields, assertSemver, CliValidationError } from '../utils/cli-validators';
import { mutateAndValidate, PackageIOError } from '../utils/package-io';
import { issueToOutcome, manyIssuesOutcome, renderError, type CommandOutcome } from '../utils/output';

/**
 * Manifest fields this command does not patch. `type` governs whether `milestones` is
 * required (the refinement on `ManifestJsonSchema`), so changing it is a package
 * conversion rather than a field edit — previously withheld by
 * `STRUCTURAL_SKIP_FIELDS`, which matched the name and caught unrelated fields
 * elsewhere (§3.4 i). The other three are objects, patched through the flat
 * parameters below.
 */
const NOT_PATCHABLE = { type: true, author: true, targeting: true, testEnvironment: true } as const;

const PATCHABLE_MANIFEST = ManifestJsonObjectSchema.omit(NOT_PATCHABLE);

/** Manifest field names this command patches directly. */
const PATCH_KEYS: readonly string[] = Object.keys(PATCHABLE_MANIFEST.shape);

/** A flat parameter's destination inside the manifest, checked against the type. */
type NestedPath =
  | readonly ['author', keyof NonNullable<ManifestJson['author']>]
  | readonly ['testEnvironment', keyof NonNullable<ManifestJson['testEnvironment']>];

interface NestedParam {
  path: NestedPath;
  /** Appended to the derived `manifest.<path>` help text. */
  hint?: string;
}

const NESTED_PARAMS = {
  authorName: { path: ['author', 'name'] },
  authorTeam: { path: ['author', 'team'] },
  testTier: { path: ['testEnvironment', 'tier'], hint: '(e.g., local, cloud)' },
  testMinVersion: { path: ['testEnvironment', 'minVersion'], hint: '(semver)' },
  testInstance: { path: ['testEnvironment', 'instance'] },
} as const satisfies Record<string, NestedParam>;

type NestedParamName = keyof typeof NESTED_PARAMS;

function nestedParam(param: NestedParam): z.ZodOptional<z.ZodString> {
  const hint = param.hint === undefined ? '' : ` ${param.hint}`;
  return z
    .string()
    .min(1)
    .optional()
    .describe(`manifest.${param.path.join('.')}${hint}`)
    .meta({ role: 'content' });
}

const nestedFields = Object.fromEntries(
  Object.entries(NESTED_PARAMS).map(([name, param]) => [name, nestedParam(param)])
) as Record<NestedParamName, z.ZodOptional<z.ZodString>>;

export const SetManifestCommand = z.object({
  dir: z.string().describe('package directory').meta({ role: 'io' }),
  ...withPolicy(patchShape(PATCHABLE_MANIFEST.shape), { role: 'content' }),
  ...nestedFields,
  targetUrlPrefix: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Append { urlPrefix: <value> } to manifest.targeting.match.and (use multiple times to add several clauses)'
    )
    .meta({ role: 'content' }),
  targetPlatform: z
    .array(z.enum(['oss', 'cloud', 'enterprise']))
    .optional()
    .describe('Append { targetPlatform: <value> } to manifest.targeting.match.and')
    .meta({ role: 'content' }),
  targetAnd: z
    .string()
    .min(1)
    .optional()
    .describe('Replace manifest.targeting.match.and with this raw JSON array (escape hatch for complex targeting)')
    .meta({ role: 'content' }),
});

export type SetManifestInput = z.output<typeof SetManifestCommand>;

/**
 * Content parameters landing somewhere nested rather than on a top-level field: the
 * `NESTED_PARAMS` table plus the three targeting clauses. Exported so the consumption
 * harness can tell a flattened parameter from one naming a manifest field without
 * transcribing the list.
 */
export const FLATTENED_MANIFEST_PARAMS: readonly string[] = [
  ...Object.keys(NESTED_PARAMS),
  'targetUrlPrefix',
  'targetPlatform',
  'targetAnd',
];

/** Clauses destined for `targeting.match.and`, and whether they replace it. */
interface TargetingPatch {
  and: Array<Record<string, unknown>>;
  replace: boolean;
}

export async function runSetManifest(args: SetManifestInput): Promise<CommandOutcome> {
  const patch = pickSupplied(args as Record<string, unknown>, PATCH_KEYS);
  const nested = collectNested(args);

  let targeting: TargetingPatch | undefined;
  try {
    targeting = buildTargeting(args);
  } catch (err) {
    if (err instanceof CliValidationError) {
      return { status: 'error', code: 'SCHEMA_VALIDATION', message: err.message };
    }
    throw err;
  }

  if (Object.keys(patch).length === 0 && nested.size === 0 && targeting === undefined) {
    return {
      status: 'error',
      code: 'NO_CHANGES',
      message: 'set-manifest needs at least one field to change.',
    };
  }

  // CLI-strict semantic checks (semver schemaVersion, http(s) repository,
  // kebab-case package id refs, non-empty description, ...). Schemas stay
  // loose; the CLI gate is here.
  try {
    assertCliManifestFields(patch);
    if (args.testMinVersion !== undefined) {
      assertSemver(args.testMinVersion, 'testEnvironment.minVersion');
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
      const fields = manifest as unknown as Record<string, unknown>;
      for (const [field, value] of Object.entries(patch)) {
        fields[field] = value;
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
      applyNested(fields, nested, changedFields);
      applyTargeting(fields, targeting, changedFields);
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

export const setManifestSpec = defineCommand({
  name: 'set-manifest',
  summary: 'Update manifest fields. Only the fields you pass are changed; everything else is preserved.',
  schema: SetManifestCommand,
  run: runSetManifest,
});

export const setManifestCommand = mountCommander(setManifestSpec, {
  positionals: ['dir'],
  // `<semver>` and `<platform>` read better than the type-derived `<string>`;
  // `<json>` warns that the escape hatch wants a JSON array, not a value.
  placeholders: { testMinVersion: 'semver', targetPlatform: 'platform', targetAnd: 'json' },
});

/** Group the supplied flat parameters by the nested object they patch. */
function collectNested(args: SetManifestInput): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  for (const [name, param] of Object.entries(NESTED_PARAMS)) {
    const value = args[name as NestedParamName];
    if (value === undefined) {
      continue;
    }
    const [object, key] = param.path;
    const bucket = out.get(object) ?? {};
    bucket[key] = value;
    out.set(object, bucket);
  }
  return out;
}

/**
 * `--target-and` replaces the whole and-array; `--target-url-prefix` and
 * `--target-platform` append clauses. The two modes are mutually exclusive in
 * practice but not enforced — the replace wins.
 */
function buildTargeting(args: SetManifestInput): TargetingPatch | undefined {
  if (args.targetAnd !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(args.targetAnd);
    } catch {
      throw new CliValidationError('targeting.match.and', `{@targetAnd} must be valid JSON: ${args.targetAnd}`);
    }
    if (!Array.isArray(parsed)) {
      throw new CliValidationError('targeting.match.and', '{@targetAnd} must be a JSON array');
    }
    return { and: parsed as Array<Record<string, unknown>>, replace: true };
  }

  const and: Array<Record<string, unknown>> = [];
  for (const prefix of args.targetUrlPrefix ?? []) {
    and.push({ urlPrefix: prefix });
  }
  for (const platform of args.targetPlatform ?? []) {
    and.push({ targetPlatform: platform });
  }
  return and.length > 0 ? { and, replace: false } : undefined;
}

/**
 * Deep-merge the nested patches. Untouched keys of a patched object survive, so
 * `--author-name X` keeps an existing `team`.
 */
function applyNested(
  fields: Record<string, unknown>,
  nested: Map<string, Record<string, string>>,
  changed: Set<string>
): void {
  for (const [object, values] of nested) {
    const existing = (fields[object] as Record<string, unknown> | undefined) ?? {};
    fields[object] = { ...existing, ...values };
    changed.add(object);
  }
}

/** Append to, or replace, `targeting.match.and`, preserving the rest of `match`. */
function applyTargeting(
  fields: Record<string, unknown>,
  targeting: TargetingPatch | undefined,
  changed: Set<string>
): void {
  if (!targeting) {
    return;
  }
  const existing = (fields.targeting as { match?: Record<string, unknown> } | undefined) ?? {};
  const existingMatch = existing.match ?? {};
  const kept =
    targeting.replace || !Array.isArray(existingMatch.and) ? [] : (existingMatch.and as Array<Record<string, unknown>>);
  fields.targeting = { ...existing, match: { ...existingMatch, and: [...kept, ...targeting.and] } };
  changed.add('targeting');
}
