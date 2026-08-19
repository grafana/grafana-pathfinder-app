/**
 * Build Stats Command
 *
 * Stamps each package's `manifest.json` with the computed block stats that
 * completion tracking uses as its denominator, so no human ever asserts them.
 * Runs over the same package tree as `build-repository` and belongs immediately
 * before it in a deploy pipeline: `build-stats` writes the manifests,
 * `build-repository` denormalizes them into `repository.json`.
 *
 * All arithmetic lives in `src/lib/guide-stats`. This file only parses
 * arguments, reads and writes files, and orders the work so a path's
 * milestones are measured before the path itself.
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';

import {
  rollUpGuideStats,
  summarizeGuideBlocks,
  type CountableBlock,
  type GuideStatsSummary,
} from '../../lib/guide-stats';
import { ContentJsonSchema, ManifestJsonObjectSchema } from '../../types/package.schema';
import { readJsonFile } from '../../validation/package-io';
import { resolveCliPath } from '../utils/file-loader';
import { formatJsonWithPrettier } from '../utils/output';
import { discoverPackages } from './build-repository';

interface BuildStatsOptions {
  exclude?: string[];
  check?: boolean;
}

interface DiscoveredPackage {
  id: string;
  dirName: string;
  packageDir: string;
  blocks: readonly CountableBlock[];
  milestones: readonly string[];
  /** Raw parsed manifest, key order intact, so a rewrite is a minimal diff. */
  rawManifest: Record<string, unknown>;
}

export interface BuildStatsResult {
  /** Packages whose on-disk stats already matched, in discovery order. */
  unchanged: string[];
  /** Packages whose stats were written, or would be written under `--check`. */
  written: string[];
  warnings: string[];
  errors: string[];
}

/**
 * Read every package under `root`, compute its stats, and write them into its
 * `manifest.json` under the `stats` key.
 *
 * `check` computes and compares without touching disk — for a CI job that
 * fails when a committed manifest has drifted from its content.
 */
export async function buildStats(
  root: string,
  options?: { exclude?: string[]; check?: boolean }
): Promise<BuildStatsResult> {
  const result: BuildStatsResult = { unchanged: [], written: [], warnings: [], errors: [] };

  const absoluteExcludes =
    options?.exclude?.map((p) => (path.isAbsolute(p) ? path.normalize(p) : path.join(root, p))) ?? [];
  const packageDirs = discoverPackages(root, absoluteExcludes);

  if (packageDirs.length === 0) {
    result.warnings.push(`No package directories with manifest.json found under ${root}`);
    return result;
  }

  const packages = new Map<string, DiscoveredPackage>();
  const ordered: DiscoveredPackage[] = [];

  for (const packageDir of packageDirs) {
    const read = readPackage(root, packageDir);
    if ('error' in read) {
      result.errors.push(read.error);
      continue;
    }
    const existing = packages.get(read.pkg.id);
    if (existing) {
      result.errors.push(`${read.pkg.dirName}: duplicate package ID "${read.pkg.id}" (also ${existing.dirName})`);
      continue;
    }
    packages.set(read.pkg.id, read.pkg);
    ordered.push(read.pkg);
  }

  if (result.errors.length > 0) {
    return result;
  }

  const resolved = new Map<string, GuideStatsSummary>();

  for (const pkg of ordered) {
    const stats = resolveStats(pkg, packages, resolved, [], result.errors);
    if (!stats) {
      continue;
    }

    const current = pkg.rawManifest.stats;
    if (deepEqual(current, stats)) {
      result.unchanged.push(pkg.dirName);
      continue;
    }

    result.written.push(pkg.dirName);
    if (!options?.check) {
      await writeManifestStats(pkg, stats, result.errors);
    }
  }

  return result;
}

type PackageReadOutcome = { pkg: DiscoveredPackage } | { error: string };

function readPackage(root: string, packageDir: string): PackageReadOutcome {
  const relativeDir = path.relative(root, packageDir).split(path.sep).join('/');
  const dirName = relativeDir || path.basename(packageDir);

  const contentRead = readJsonFile(path.join(packageDir, 'content.json'), ContentJsonSchema);
  if (!contentRead.ok) {
    return { error: `${dirName}: ${describeReadFailure('content.json', contentRead)}` };
  }

  const manifestRead = readJsonFile(path.join(packageDir, 'manifest.json'), ManifestJsonObjectSchema);
  if (!manifestRead.ok) {
    return { error: `${dirName}: ${describeReadFailure('manifest.json', manifestRead)}` };
  }
  if (!isPlainObject(manifestRead.parsed)) {
    return { error: `${dirName}: manifest.json must be a JSON object` };
  }

  const content = contentRead.data;
  if (manifestRead.data.id !== content.id) {
    return {
      error: `${dirName}: ID mismatch: content.json has "${content.id}", manifest.json has "${manifestRead.data.id}"`,
    };
  }

  return {
    pkg: {
      id: content.id,
      dirName,
      packageDir,
      blocks: content.blocks as readonly CountableBlock[],
      milestones: manifestRead.data.milestones ?? [],
      rawManifest: manifestRead.parsed,
    },
  };
}

/**
 * Stats for one package, recursing into its milestones first.
 *
 * A path or journey rolls up as its own body followed by its milestones in
 * declared order. Recursing depth-first is what guarantees milestones are
 * measured before their parents; `resolved` memoizes so a milestone shared by
 * two paths is measured once. A milestone that does not exist in the tree is an
 * error, matching the write-time rule that a pathway cannot refer to a
 * milestone that is not there.
 */
function resolveStats(
  pkg: DiscoveredPackage,
  packages: ReadonlyMap<string, DiscoveredPackage>,
  resolved: Map<string, GuideStatsSummary>,
  ancestry: readonly string[],
  errors: string[]
): GuideStatsSummary | undefined {
  const memoized = resolved.get(pkg.id);
  if (memoized) {
    return memoized;
  }

  if (ancestry.includes(pkg.id)) {
    errors.push(`${pkg.dirName}: milestone cycle: ${[...ancestry, pkg.id].join(' -> ')}`);
    return undefined;
  }

  const parts: GuideStatsSummary[] = [summarizeGuideBlocks(pkg.blocks)];

  for (const milestoneId of pkg.milestones) {
    const milestone = packages.get(milestoneId);
    if (!milestone) {
      errors.push(`${pkg.dirName}: milestone "${milestoneId}" not found in the package tree`);
      return undefined;
    }
    const milestoneStats = resolveStats(milestone, packages, resolved, [...ancestry, pkg.id], errors);
    if (!milestoneStats) {
      return undefined;
    }
    parts.push(milestoneStats);
  }

  const stats = rollUpGuideStats(parts);
  resolved.set(pkg.id, stats);
  return stats;
}

/**
 * Rewrite `manifest.json` with `stats` set.
 *
 * The spread preserves the authored key order and replaces `stats` in place
 * when it is already present, so re-running never reshuffles a manifest. The
 * shared prettier formatter keeps a stamped manifest lint-clean in a repo that
 * gates JSON formatting, and is what the sibling build-* commands write with.
 */
async function writeManifestStats(pkg: DiscoveredPackage, stats: GuideStatsSummary, errors: string[]): Promise<void> {
  const manifestPath = path.join(pkg.packageDir, 'manifest.json');
  const json = await formatJsonWithPrettier(JSON.stringify({ ...pkg.rawManifest, stats }, null, 2));
  try {
    fs.writeFileSync(manifestPath, json, 'utf-8');
  } catch (err) {
    errors.push(`${pkg.dirName}: cannot write manifest.json: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function describeReadFailure(
  label: string,
  failure: { code: string; message: string; issues?: Array<{ message: string }> }
): string {
  return failure.code === 'schema_validation'
    ? `${label} validation failed: ${failure.issues?.map((issue) => issue.message).join('; ')}`
    : failure.message;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export const buildStatsCommand = new Command('build-stats')
  .description('Compute block stats for every package under a tree and write them into each manifest.json')
  .argument('<root>', 'Root directory containing package directories')
  .option(
    '-e, --exclude <paths...>',
    'Path(s) to exclude from scan (relative to root); excluded trees are not descended into'
  )
  .option('--check', 'Report packages whose stats are out of date and exit non-zero; write nothing')
  .action(async (root: string, options: BuildStatsOptions) => {
    const absoluteRoot = resolveCliPath(root);

    if (!fs.existsSync(absoluteRoot)) {
      console.error(`Directory not found: ${absoluteRoot}`);
      process.exit(1);
    }

    const exclude = options.exclude ? (Array.isArray(options.exclude) ? options.exclude : [options.exclude]) : [];
    const { unchanged, written, warnings, errors } = await buildStats(absoluteRoot, {
      exclude,
      check: options.check,
    });

    for (const warning of warnings) {
      console.warn(`⚠️  ${warning}`);
    }

    for (const error of errors) {
      console.error(`❌ ${error}`);
    }

    if (errors.length > 0) {
      console.error(`❌ ${errors.length} error(s) prevented computing stats; no manifests written.`);
      process.exit(1);
    }

    if (options.check) {
      if (written.length > 0) {
        for (const dirName of written) {
          console.error(`❌ ${dirName}: manifest stats are out of date`);
        }
        console.error(`❌ ${written.length} manifest(s) out of date; run build-stats to update them.`);
        process.exit(1);
      }
      console.log(`✅ ${unchanged.length} manifest(s) up to date`);
      return;
    }

    for (const dirName of written) {
      console.log(`   updated ${dirName}/manifest.json`);
    }
    console.log(`✅ ${written.length} manifest(s) updated, ${unchanged.length} already up to date`);
  });
