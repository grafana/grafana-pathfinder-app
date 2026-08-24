/**
 * Build Repository Command
 *
 * Scans a package tree for manifest.json files, reads content.json and
 * manifest.json for each discovered package directory, and emits a
 * denormalized repository.json with bare IDs.
 */

import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

import type { RepositoryEntry, RepositoryJson } from '../../types/package.types';
// ManifestJsonObjectSchema (pre-refinement) is intentional: build-repository
// applies graceful degradation — a path/journey manifest missing `milestones` produces
// a repository entry rather than failing. The `validate` command enforces the
// refinement (ManifestJsonSchema) for strict correctness checking.
import {
  ContentJsonSchema,
  ManifestJsonObjectSchema,
  RepositoryEntrySchema,
  RepositoryJsonSchema,
} from '../../types/package.schema';
import { readJsonFile } from '../../validation/package-io';
import { defineCommand, mountCommander } from '../contracts';
import { preserveAuthoredStartingLocation } from '../e2e/starting-location';
import { resolveCliPath } from '../utils/file-loader';
import { formatJsonWithPrettier, type CommandOutcome } from '../utils/output';

/**
 * Manifest keys the builder maps onto a repository entry by hand. Everything
 * else in a manifest is extension metadata and is forwarded verbatim.
 */
const NAMED_MANIFEST_FIELDS: ReadonlySet<string> = new Set(Object.keys(ManifestJsonObjectSchema.shape));

/**
 * Repository-entry fields the builder computes itself (`path` from the package
 * directory, `title` from content.json). A manifest key of the same name is
 * refused rather than allowed to overwrite the computed value. `__proto__` is
 * belt-and-braces on an assignment sink fed by file content — zod's loose parse
 * already drops a JSON `__proto__` own-key before the copy runs.
 */
const RESERVED_ENTRY_FIELDS: ReadonlySet<string> = new Set([
  ...Object.keys(RepositoryEntrySchema.shape).filter((key) => !NAMED_MANIFEST_FIELDS.has(key)),
  '__proto__',
]);

/**
 * Copy every manifest key the builder does not name explicitly onto the entry.
 * Reports a warning for each key refused as reserved, and the names of the keys
 * it forwarded — an open namespace means a misspelled known field is forwarded
 * as a plausible-looking extension field, and the build log is where that is
 * findable.
 */
function forwardExtensionFields(
  manifest: Record<string, unknown>,
  entry: RepositoryEntry
): { warnings: string[]; forwarded: string[] } {
  const warnings: string[] = [];
  const forwarded: string[] = [];

  for (const key of Object.keys(manifest)) {
    if (NAMED_MANIFEST_FIELDS.has(key)) {
      continue;
    }
    if (RESERVED_ENTRY_FIELDS.has(key)) {
      warnings.push(`Ignoring manifest field "${key}": reserved for a repository entry field the build computes`);
      continue;
    }
    entry[key] = manifest[key];
    forwarded.push(key);
  }

  return { warnings, forwarded };
}

/**
 * Returns true if dir is equal to or under any of the excluded absolute paths.
 */
function isExcluded(dir: string, excludePaths: string[]): boolean {
  const normalizedDir = path.normalize(dir);
  return excludePaths.some((excluded) => {
    const normalizedExcluded = path.normalize(excluded);
    return normalizedDir === normalizedExcluded || normalizedDir.startsWith(normalizedExcluded + path.sep);
  });
}

/**
 * Discover package directories under a root.
 * A package directory is any directory containing manifest.json.
 * Recurses arbitrarily deep, excluding assets/ subtrees and any paths in excludePaths (absolute).
 *
 * Exported so `build-stats` walks the tree with identical semantics — the two
 * commands run over the same root in the same pipeline and must agree on what
 * a package is.
 */
export function discoverPackages(root: string, excludePaths: string[] = []): string[] {
  if (!fs.existsSync(root)) {
    return [];
  }

  const packages: string[] = [];
  const stack = [root];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) {
      continue;
    }

    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    const hasManifest = entries.some((entry) => entry.isFile() && entry.name === 'manifest.json');

    if (hasManifest) {
      packages.push(currentDir);
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'assets') {
        continue;
      }
      const childDir = path.join(currentDir, entry.name);
      if (isExcluded(childDir, excludePaths)) {
        continue;
      }
      stack.push(childDir);
    }
  }

  return packages.sort();
}

interface PackageReadResult {
  id: string;
  dirName: string;
  entry: RepositoryEntry;
  warnings: string[];
  errors: string[];
  info: string[];
}

/**
 * Read a single package directory and produce a repository entry.
 */
function readPackage(root: string, packageDir: string): PackageReadResult {
  const relativeDir = path.relative(root, packageDir).split(path.sep).join('/');
  const dirName = relativeDir || path.basename(packageDir);
  const warnings: string[] = [];
  const errors: string[] = [];
  const info: string[] = [];
  const fallbackEntry: RepositoryEntry = { path: `${dirName}/`, type: 'guide' };

  const contentPath = path.join(packageDir, 'content.json');
  const manifestPath = path.join(packageDir, 'manifest.json');

  const contentRead = readJsonFile(contentPath, ContentJsonSchema);
  if (!contentRead.ok) {
    const msg =
      contentRead.code === 'schema_validation'
        ? `content.json validation failed: ${contentRead.issues?.map((i) => i.message).join('; ')}`
        : contentRead.message;
    errors.push(msg);
    return { id: dirName, dirName, entry: fallbackEntry, warnings, errors, info };
  }

  const content = contentRead.data;
  const id = content.id;

  const entry: RepositoryEntry = {
    path: `${dirName}/`,
    title: content.title,
    type: 'guide',
  };

  if (fs.existsSync(manifestPath)) {
    const manifestRead = readJsonFile(manifestPath, ManifestJsonObjectSchema);
    if (!manifestRead.ok) {
      const msg =
        manifestRead.code === 'schema_validation'
          ? `manifest.json validation failed: ${manifestRead.issues?.map((i) => i.message).join('; ')}`
          : `${manifestRead.message}, using content.json only`;
      warnings.push(msg);
      return { id, dirName, entry, warnings, errors, info };
    }

    const manifest = preserveAuthoredStartingLocation(manifestRead.parsed, manifestRead.data);

    if (manifest.id !== id) {
      errors.push(`ID mismatch: content.json has "${id}", manifest.json has "${manifest.id}"`);
    }

    entry.type = manifest.type;
    entry.description = manifest.description;
    entry.category = manifest.category;
    entry.author = manifest.author;
    entry.estimatedMinutes = manifest.estimatedMinutes;
    if (manifest.startingLocation !== undefined) {
      entry.startingLocation = manifest.startingLocation;
    }
    entry.milestones = manifest.milestones;
    entry.depends = manifest.depends?.length ? manifest.depends : undefined;
    entry.recommends = manifest.recommends?.length ? manifest.recommends : undefined;
    entry.suggests = manifest.suggests?.length ? manifest.suggests : undefined;
    entry.provides = manifest.provides?.length ? manifest.provides : undefined;
    entry.conflicts = manifest.conflicts?.length ? manifest.conflicts : undefined;
    entry.replaces = manifest.replaces?.length ? manifest.replaces : undefined;
    entry.targeting = manifest.targeting;
    entry.testEnvironment = manifest.testEnvironment;
    // Named since #1682 declared it on the manifest schema, so the extension
    // forwarding below now skips it. Without this line the stamp silently stopped
    // reaching repository.json — the generated denominator, dropped between a
    // schema change and a copy loop that never mentioned it.
    if (manifest.stats !== undefined) {
      entry.stats = manifest.stats;
    }

    const forwarding = forwardExtensionFields(manifest, entry);
    warnings.push(...forwarding.warnings);
    if (forwarding.forwarded.length > 0) {
      info.push(`forwarding ${forwarding.forwarded.length} extension field(s): ${forwarding.forwarded.join(', ')}`);
    }
  }

  return { id, dirName, entry, warnings, errors, info };
}

/**
 * Build a repository.json from a package tree root.
 * @param root - Absolute path to the package tree root
 * @param options.exclude - Optional list of paths to exclude (relative to root or absolute); excluded trees are not descended into
 */
export function buildRepository(
  root: string,
  options?: { exclude?: string[] }
): {
  repository: RepositoryJson;
  warnings: string[];
  errors: string[];
  info: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];
  const info: string[] = [];
  const repository: RepositoryJson = {};

  const absoluteExcludes =
    options?.exclude?.map((p) => (path.isAbsolute(p) ? path.normalize(p) : path.join(root, p))) ?? [];
  const packageDirs = discoverPackages(root, absoluteExcludes);

  if (packageDirs.length === 0) {
    warnings.push(`No package directories with manifest.json found under ${root}`);
    return { repository, warnings, errors, info };
  }

  for (const packageDir of packageDirs) {
    const result = readPackage(root, packageDir);

    for (const w of result.warnings) {
      warnings.push(`${result.dirName}: ${w}`);
    }
    for (const e of result.errors) {
      errors.push(`${result.dirName}: ${e}`);
    }
    for (const i of result.info) {
      info.push(`${result.dirName}: ${i}`);
    }

    if (result.errors.length === 0) {
      if (repository[result.id] !== undefined) {
        errors.push(`Duplicate package ID "${result.id}" in ${result.dirName}`);
      } else {
        repository[result.id] = result.entry;
      }
    }
  }

  const repoValidation = RepositoryJsonSchema.safeParse(repository);
  if (!repoValidation.success) {
    const messages = repoValidation.error.issues.map((i) => i.message).join('; ');
    errors.push(`Generated repository.json is invalid: ${messages}`);
  }

  return { repository, warnings, errors, info };
}

export const BuildRepositoryCommand = z.object({
  root: z.string().describe('Root directory containing package directories').meta({ role: 'io' }),
  output: z.string().optional().describe('Output file path (default: stdout)').meta({ role: 'io' }),
  exclude: z
    .array(z.string())
    .default([])
    .describe('Path(s) to exclude from scan (relative to root); excluded trees are not descended into')
    .meta({ role: 'control' }),
});

export type BuildRepositoryInput = z.output<typeof BuildRepositoryCommand>;

export async function runBuildRepository(args: BuildRepositoryInput): Promise<CommandOutcome> {
  const absoluteRoot = resolveCliPath(args.root);

  if (!fs.existsSync(absoluteRoot)) {
    console.error(`Directory not found: ${absoluteRoot}`);
    return { status: 'error', code: 'DIR_NOT_FOUND', message: `Directory not found: ${absoluteRoot}` };
  }

  const { repository, warnings, errors, info } = buildRepository(absoluteRoot, { exclude: args.exclude });

  for (const line of info) {
    console.error(`ℹ️  ${line}`);
  }

  for (const warning of warnings) {
    console.warn(`⚠️  ${warning}`);
  }

  for (const error of errors) {
    console.error(`❌ ${error}`);
  }

  if (errors.length > 0) {
    console.error(`❌ ${errors.length} error(s) prevented building repository.json; no output written.`);
    return { status: 'error', code: 'BUILD_FAILED', message: `${errors.length} error(s) building repository.json` };
  }

  const json = await formatJsonWithPrettier(JSON.stringify(repository, null, 2));

  if (args.output) {
    const outputPath = resolveCliPath(args.output);
    fs.writeFileSync(outputPath, json, 'utf-8');
    console.log(`✅ Wrote repository.json to ${outputPath} (${Object.keys(repository).length} packages)`);
  } else {
    process.stdout.write(json);
  }
  return { status: 'ok', summary: `Built repository.json (${Object.keys(repository).length} packages)` };
}

export const buildRepositorySpec = defineCommand({
  name: 'build-repository',
  summary: 'Build repository.json from a package tree',
  schema: BuildRepositoryCommand,
  // Without --output the generated document *is* stdout, and `repository:check`
  // diffs it; with it, the progress lines are the contract.
  emits: 'stream',
  run: runBuildRepository,
});

export const buildRepositoryCommand = mountCommander(buildRepositorySpec, {
  positionals: ['root'],
  placeholders: { output: 'file', exclude: 'paths...' },
  shorts: { output: 'o', exclude: 'e' },
});
