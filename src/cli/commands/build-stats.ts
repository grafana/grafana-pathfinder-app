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
  /** `guide`, `path`, or `journey`. Only the latter two may roll up milestones. */
  type: string;
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
    const message = `No package directories with manifest.json found under ${root}`;
    // Under --check this must fail: a gate pointed at a moved root, or an
    // --exclude that swallowed the tree, would otherwise report success having
    // verified nothing.
    if (options?.check) {
      result.errors.push(`${message} — --check verified nothing`);
    } else {
      result.warnings.push(message);
    }
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

  collectMilestoneStructureErrors(ordered, packages, result.errors);

  const resolved = new Map<string, GuideStatsSummary>();
  const failed = new Set<string>();
  const pending: Array<{ pkg: DiscoveredPackage; stats: GuideStatsSummary }> = [];

  for (const pkg of ordered) {
    const stats = resolveStats(pkg, packages, resolved, failed, [], result.errors);
    if (stats) {
      pending.push({ pkg, stats });
    }
  }

  // Every package resolves before any manifest is written, so a tree that
  // errors anywhere is left entirely unstamped rather than half-stamped.
  if (result.errors.length > 0) {
    return result;
  }

  for (const { pkg, stats } of pending) {
    if (statsMatch(pkg.rawManifest.stats, stats)) {
      result.unchanged.push(pkg.dirName);
      continue;
    }

    if (options?.check) {
      result.written.push(pkg.dirName);
      continue;
    }
    if (await writeManifestStats(pkg, stats, result.errors)) {
      result.written.push(pkg.dirName);
    }
  }

  return result;
}

type PackageReadOutcome = { pkg: DiscoveredPackage } | { error: string };

/**
 * Parse one package, or describe why it cannot be measured.
 *
 * A manifest that fails schema validation is an error rather than a warning —
 * `build-repository` degrades the same failure and carries on, and that
 * divergence is deliberate: a manifest this command cannot trust is one whose
 * milestone list it cannot trust either, and a rollup off an untrusted
 * milestone list is a wrong denominator.
 */
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
      type: manifestRead.data.type,
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
 * two paths is measured once.
 *
 * A milestone missing from the tree is a hard error, knowingly stricter than
 * `build-graph` (warns on an unresolvable milestone), `build-repository`
 * (degrades a manifest schema failure to a warning), and `package-content.ts`
 * (keeps a locked placeholder). Those tolerate a partial tree at read time;
 * this command exists to produce a denominator that is never wrong, and a
 * rollup silently missing a milestone would publish one that is.
 */
function resolveStats(
  pkg: DiscoveredPackage,
  packages: ReadonlyMap<string, DiscoveredPackage>,
  resolved: Map<string, GuideStatsSummary>,
  failed: Set<string>,
  ancestry: readonly string[],
  errors: string[]
): GuideStatsSummary | undefined {
  const memoized = resolved.get(pkg.id);
  if (memoized) {
    return memoized;
  }
  // Failures memoize too: without this the same missing milestone is reported
  // once per referrer, and the extra lines are attributed to the referenced
  // package rather than the parent that asked for it.
  if (failed.has(pkg.id)) {
    return undefined;
  }

  if (ancestry.includes(pkg.id)) {
    errors.push(`${pkg.dirName}: milestone cycle: ${[...ancestry, pkg.id].join(' -> ')}`);
    failed.add(pkg.id);
    return undefined;
  }

  const parts: GuideStatsSummary[] = [summarizeGuideBlocks(pkg.blocks)];
  // Only a path or journey rolls up. A guide carrying a stray milestones array
  // is already an error from `collectMilestoneStructureErrors`; ignoring it here
  // keeps a wrong denominator from being computed in the meantime.
  const milestones = pkg.type === 'path' || pkg.type === 'journey' ? pkg.milestones : [];

  for (const milestoneId of milestones) {
    const milestone = packages.get(milestoneId);
    if (!milestone) {
      errors.push(`${pkg.dirName}: milestone "${milestoneId}" not found in the package tree`);
      failed.add(pkg.id);
      return undefined;
    }
    const milestoneStats = resolveStats(milestone, packages, resolved, failed, [...ancestry, pkg.id], errors);
    if (!milestoneStats) {
      failed.add(pkg.id);
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
async function writeManifestStats(
  pkg: DiscoveredPackage,
  stats: GuideStatsSummary,
  errors: string[]
): Promise<boolean> {
  const manifestPath = path.join(pkg.packageDir, 'manifest.json');
  try {
    const json = await formatJsonWithPrettier(JSON.stringify({ ...pkg.rawManifest, stats }, null, 2));
    fs.writeFileSync(manifestPath, json, 'utf-8');
    return true;
  } catch (err) {
    errors.push(`${pkg.dirName}: cannot write manifest.json: ${err instanceof Error ? err.message : String(err)}`);
    return false;
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

/**
 * Field-wise comparison against {@link GuideStatsSummary}.
 *
 * A `JSON.stringify` compare is key-order sensitive, which would report
 * semantically identical stats as drift after a hand edit, a merge resolution,
 * or a port that emits a different key order — and `--check` is sold as a CI
 * gate, so a false failure there is expensive.
 */
function statsMatch(current: unknown, computed: GuideStatsSummary): boolean {
  if (!isPlainObject(current)) {
    return false;
  }
  const keys = Object.keys(computed) as Array<keyof GuideStatsSummary>;
  if (Object.keys(current).length !== keys.length) {
    return false;
  }
  return keys.every((key) => current[key] === computed[key]);
}

/**
 * Duplicate and diamond milestone references, and milestones on a package type
 * that may not have them.
 *
 * A package reached twice in one rollup is summed twice, and because
 * `positionsById` is first-occurrence-wins the duplicate copy's blocks can
 * never be evidenced — so the reader is permanently stuck below 100%. That is
 * the same failure this command avoids by refusing to descend into a
 * `conditional`, so it gets the same treatment: an error, not a silent dedup.
 *
 * Every defect is attributed to the package whose `milestones` array holds it
 * and reported exactly once, however many rollups reach that package. A
 * subtree is otherwise inspected once per ancestor, which duplicated stderr
 * lines and blamed a diamond on a different package on each pass.
 */
function collectMilestoneStructureErrors(
  ordered: readonly DiscoveredPackage[],
  packages: ReadonlyMap<string, DiscoveredPackage>,
  errors: string[]
): void {
  const metapackages: DiscoveredPackage[] = [];

  for (const pkg of ordered) {
    const isMetapackage = pkg.type === 'path' || pkg.type === 'journey';
    if (pkg.milestones.length > 0 && !isMetapackage) {
      errors.push(
        `${pkg.dirName}: type "${pkg.type}" cannot carry milestones, but lists ${pkg.milestones.length} — ` +
          `they would be rolled into its own denominator`
      );
      continue;
    }
    if (isMetapackage) {
      metapackages.push(pkg);
    }
  }

  const listedAsMilestone = new Set<string>();
  for (const pkg of metapackages) {
    const seenInList = new Set<string>();
    for (const milestoneId of pkg.milestones) {
      if (seenInList.has(milestoneId)) {
        errors.push(`${pkg.dirName}: lists milestone "${milestoneId}" more than once`);
        continue;
      }
      seenInList.add(milestoneId);
      listedAsMilestone.add(milestoneId);
    }
  }

  const reported = new Set<string>();
  const inspected = new Set<string>();

  function walkFrom(root: DiscoveredPackage): void {
    const reachedBy = new Map<string, string>();
    const ancestry: string[] = [];

    function walk(pkg: DiscoveredPackage): void {
      if (ancestry.includes(pkg.id)) {
        return; // resolveStats reports the cycle
      }
      inspected.add(pkg.id);
      const seenInList = new Set<string>();

      for (const milestoneId of pkg.milestones) {
        if (seenInList.has(milestoneId)) {
          continue; // already reported against this package
        }
        seenInList.add(milestoneId);

        const previous = reachedBy.get(milestoneId);
        if (previous !== undefined) {
          const key = JSON.stringify([pkg.id, milestoneId]);
          if (!reported.has(key)) {
            reported.add(key);
            errors.push(
              `${pkg.dirName}: milestone "${milestoneId}" is reachable twice (also via "${previous}"), ` +
                `so its blocks would be counted twice and could never be completed`
            );
          }
          continue;
        }
        reachedBy.set(milestoneId, pkg.id);

        const milestone = packages.get(milestoneId);
        if (milestone) {
          ancestry.push(pkg.id);
          walk(milestone);
          ancestry.pop();
        }
      }
    }

    walk(root);
  }

  // Walking from top-level roots only keeps `previous` — and so the reported
  // attribution — the same whichever ancestor a shared subtree hangs under.
  // The second pass covers metapackages no root reaches, which means a cycle.
  for (const pkg of metapackages) {
    if (!listedAsMilestone.has(pkg.id)) {
      walkFrom(pkg);
    }
  }
  for (const pkg of metapackages) {
    if (!inspected.has(pkg.id)) {
      walkFrom(pkg);
    }
  }
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
      console.error(
        written.length > 0
          ? `❌ ${errors.length} error(s) while writing manifests; the tree is partially stamped.`
          : `❌ ${errors.length} error(s) prevented computing stats; no manifests written.`
      );
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
