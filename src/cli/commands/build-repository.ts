/**
 * Build Repository Command
 *
 * Scans a package tree, reads content.json and optional manifest.json
 * for each package, and emits a denormalized repository.json with bare IDs.
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';

import type { RepositoryEntry, RepositoryJson } from '../../types/package.types';
import { ContentJsonSchema, ManifestJsonObjectSchema, RepositoryJsonSchema } from '../../types/package.schema';

interface BuildRepositoryOptions {
  output?: string;
}

/**
 * Discover package directories under a root.
 * A package directory contains at minimum a content.json file.
 * Searches one level deep (immediate children of root).
 */
function discoverPackages(root: string): string[] {
  if (!fs.existsSync(root)) {
    return [];
  }

  const entries = fs.readdirSync(root, { withFileTypes: true });
  const packages: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const contentPath = path.join(root, entry.name, 'content.json');
    if (fs.existsSync(contentPath)) {
      packages.push(path.join(root, entry.name));
    }
  }

  return packages;
}

interface PackageReadResult {
  id: string;
  dirName: string;
  entry: RepositoryEntry;
  warnings: string[];
  errors: string[];
}

/**
 * Read a single package directory and produce a repository entry.
 */
function readPackage(packageDir: string): PackageReadResult {
  const dirName = path.basename(packageDir);
  const warnings: string[] = [];
  const errors: string[] = [];

  const contentPath = path.join(packageDir, 'content.json');
  const manifestPath = path.join(packageDir, 'manifest.json');

  let contentRaw: string;
  try {
    contentRaw = fs.readFileSync(contentPath, 'utf-8');
  } catch {
    errors.push(`Cannot read ${contentPath}`);
    return { id: dirName, dirName, entry: { path: `${dirName}/`, type: 'guide' }, warnings, errors };
  }

  let contentParsed: unknown;
  try {
    contentParsed = JSON.parse(contentRaw);
  } catch {
    errors.push(`Invalid JSON in ${contentPath}`);
    return { id: dirName, dirName, entry: { path: `${dirName}/`, type: 'guide' }, warnings, errors };
  }

  const contentResult = ContentJsonSchema.safeParse(contentParsed);
  if (!contentResult.success) {
    const messages = contentResult.error.issues.map((i) => i.message).join('; ');
    errors.push(`content.json validation failed: ${messages}`);
    return { id: dirName, dirName, entry: { path: `${dirName}/`, type: 'guide' }, warnings, errors };
  }

  const content = contentResult.data;
  const id = content.id;

  const entry: RepositoryEntry = {
    path: `${dirName}/`,
    title: content.title,
    type: 'guide',
  };

  if (fs.existsSync(manifestPath)) {
    let manifestRaw: string;
    try {
      manifestRaw = fs.readFileSync(manifestPath, 'utf-8');
    } catch {
      warnings.push(`Cannot read ${manifestPath}, using content.json only`);
      return { id, dirName, entry, warnings, errors };
    }

    let manifestParsed: unknown;
    try {
      manifestParsed = JSON.parse(manifestRaw);
    } catch {
      warnings.push(`Invalid JSON in ${manifestPath}, using content.json only`);
      return { id, dirName, entry, warnings, errors };
    }

    const manifestResult = ManifestJsonObjectSchema.safeParse(manifestParsed);
    if (!manifestResult.success) {
      const messages = manifestResult.error.issues.map((i) => i.message).join('; ');
      warnings.push(`manifest.json validation failed: ${messages}`);
      return { id, dirName, entry, warnings, errors };
    }

    const manifest = manifestResult.data;

    if (manifest.id !== id) {
      errors.push(`ID mismatch: content.json has "${id}", manifest.json has "${manifest.id}"`);
    }

    entry.type = manifest.type;
    entry.description = manifest.description;
    entry.category = manifest.category;
    entry.startingLocation = manifest.startingLocation;
    entry.steps = manifest.steps;
    entry.depends = manifest.depends?.length ? manifest.depends : undefined;
    entry.recommends = manifest.recommends?.length ? manifest.recommends : undefined;
    entry.suggests = manifest.suggests?.length ? manifest.suggests : undefined;
    entry.provides = manifest.provides?.length ? manifest.provides : undefined;
    entry.conflicts = manifest.conflicts?.length ? manifest.conflicts : undefined;
    entry.replaces = manifest.replaces?.length ? manifest.replaces : undefined;
  }

  return { id, dirName, entry, warnings, errors };
}

/**
 * Build a repository.json from a package tree root.
 */
export function buildRepository(root: string): {
  repository: RepositoryJson;
  warnings: string[];
  errors: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];
  const repository: RepositoryJson = {};

  const packageDirs = discoverPackages(root);

  if (packageDirs.length === 0) {
    warnings.push(`No package directories found under ${root}`);
    return { repository, warnings, errors };
  }

  for (const packageDir of packageDirs) {
    const result = readPackage(packageDir);

    for (const w of result.warnings) {
      warnings.push(`${result.dirName}: ${w}`);
    }
    for (const e of result.errors) {
      errors.push(`${result.dirName}: ${e}`);
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

  return { repository, warnings, errors };
}

export const buildRepositoryCommand = new Command('build-repository')
  .description('Build repository.json from a package tree')
  .argument('<root>', 'Root directory containing package directories')
  .option('-o, --output <file>', 'Output file path (default: stdout)')
  .action((root: string, options: BuildRepositoryOptions) => {
    const absoluteRoot = path.isAbsolute(root) ? root : path.resolve(process.cwd(), root);

    if (!fs.existsSync(absoluteRoot)) {
      console.error(`Directory not found: ${absoluteRoot}`);
      process.exit(1);
    }

    const { repository, warnings, errors } = buildRepository(absoluteRoot);

    for (const warning of warnings) {
      console.warn(`⚠️  ${warning}`);
    }

    for (const error of errors) {
      console.error(`❌ ${error}`);
    }

    const json = JSON.stringify(repository, null, 2);

    if (options.output) {
      const outputPath = path.isAbsolute(options.output) ? options.output : path.resolve(process.cwd(), options.output);
      fs.writeFileSync(outputPath, json + '\n', 'utf-8');
      console.log(`✅ Wrote repository.json to ${outputPath} (${Object.keys(repository).length} packages)`);
    } else {
      console.log(json);
    }

    if (errors.length > 0) {
      process.exit(1);
    }
  });
