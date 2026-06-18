/**
 * E2E Test Command
 *
 * Run E2E tests on JSON guide files. Spawns Playwright to inject guides
 * into localStorage and verify they load correctly in the docs panel.
 */

import { existsSync, statSync } from 'fs';
import { dirname, isAbsolute, join, resolve } from 'path';

import { Command, Option } from 'commander';

import { validateGuideFromString, toLegacyResult } from '../../validation';
import {
  loadGuideFiles,
  loadBundledGuides,
  loadRepositoryIndex,
  bundledRepositoryPath,
  type LoadedGuide,
} from '../utils/file-loader';
import { planGuideExecution } from '../utils/guide-chains';
import {
  generateReport,
  writeReport,
  generateMultiGuideReport,
  writeMultiGuideReport,
  formatMultiGuideSummary,
  type TestResultsData,
  type PreRunSkip,
} from '../utils/e2e-reporter';
import {
  checkTier,
  loadManifestFromDir,
  runManifestPreflight,
  type PreflightOutcome,
  type CurrentTier,
} from '../utils/manifest-preflight';
import {
  resolveRemotePackage,
  resolveRemoteRepository,
  REMOTE_SKIP_REASONS,
  type RemoteResolution,
  type RemoteSkipReason,
  type ResolvedRemoteGuide,
  type SkippedPackage,
} from '../utils/e2e-package';
import { checkGrafanaHealth } from '../utils/grafana-health';
import { CleanEnvironment, CLEAN_COMPOSE_PROJECT, CLEAN_GRAFANA_URL } from '../utils/clean-environment';
import { ExitCode } from '../utils/exit-codes';
import { runPlaywrightTests, type AbortReason } from '../utils/playwright-runner';
import type { ManifestJson, RepositoryEntry, RepositoryJson } from '../../types/package.types';

import { randomUUID } from 'crypto';

/**
 * CLI options for the e2e command
 */
interface E2ECommandOptions {
  grafanaUrl: string;
  output?: string;
  artifacts: string;
  verbose: boolean;
  bundled: boolean;
  package?: string;
  tier: CurrentTier;
  trace: boolean;
  headed: boolean;
  alwaysScreenshot: boolean;
  clean: boolean;
  cleanReadyTimeoutMs: number;
  repository?: string;
  /** Resolve and test every package in the CDN repository index. */
  remote: boolean;
  /** CDN base URL override for --remote. */
  repoUrl?: string;
  /** Recommender base URL for --package <id> resolution. */
  resolverUrl: string;
}

const DEFAULT_GRAFANA_URL = 'http://localhost:3000';
const DEFAULT_RESOLVER_URL = 'https://recommender.grafana.com';

/** How guide inputs are resolved for a run. */
type RunMode = 'local' | 'remote-package' | 'remote-repository';

/** Package metadata attached to a remotely-resolved guide's report. */
interface PackageMeta {
  packageId: string;
  tier?: string;
  instance?: string;
  targetUrl?: string;
  sourceUrl?: string;
}

/**
 * A guide's terminal status: either a run outcome (the runner executed or aborted
 * it) or a remote skip reason (the resolver skipped it before execution). The
 * skip half is derived from the resolver's `RemoteSkipReason` so the two
 * vocabularies cannot drift.
 */
type GuideStatus = 'passed' | 'failed' | 'auth_expired' | 'skipped_prereq' | RemoteSkipReason;

/** Statuses that count as a test failure (non-zero exit). */
const FAILURE_STATUSES: ReadonlySet<GuideStatus> = new Set<GuideStatus>(['failed', 'validation_failed']);

/** Pre-run skips (the resolver's skip reasons) recorded in the JSON report; excludes skipped_prereq, which carries step data. */
const PRE_RUN_SKIP_STATUSES: ReadonlySet<GuideStatus> = new Set<GuideStatus>(REMOTE_SKIP_REASONS);

/** Summary line labels in display order. */
const GUIDE_STATUS_LABELS: ReadonlyArray<readonly [GuideStatus, string]> = [
  ['passed', '✅ Passed'],
  ['failed', '❌ Failed'],
  ['validation_failed', '❌ Validation failed'],
  ['auth_expired', '🔐 Auth expired'],
  ['skipped_prereq', '⊘ Skipped (prerequisite failed)'],
  ['skipped_tier_mismatch', '⊘ Skipped (tier mismatch)'],
  ['skipped_no_auth', '⊘ Skipped (no cloud auth)'],
  ['unsupported_type', '⊘ Skipped (unsupported type)'],
  ['fetch_failed', '⊘ Skipped (fetch failed)'],
  ['resolution_failed', '⊘ Skipped (resolution failed)'],
];

/** Per-guide listing icons. */
const GUIDE_STATUS_ICONS: Record<GuideStatus, string> = {
  passed: '✅',
  failed: '❌',
  validation_failed: '❌',
  auth_expired: '🔐',
  skipped_prereq: '⊘',
  skipped_tier_mismatch: '⊘',
  skipped_no_auth: '⊘',
  unsupported_type: '⊘',
  fetch_failed: '⊘',
  resolution_failed: '⊘',
};

interface GuideRunResult {
  guide: string;
  id: string;
  status: GuideStatus;
  exitCode: number;
  traceFile?: string;
  abortReason?: AbortReason;
  abortMessage?: string;
  resultsData?: TestResultsData;
  autoIncluded: boolean;
  failedPrerequisite?: string;
  /** Declared tier for pre-run skips (for reporting). */
  tier?: string;
}

/** Repository source for dependency-aware planning (local index or remote CDN index). */
interface RepoSource {
  repository: RepositoryJson;
  loadGuideById: (id: string, entry: RepositoryEntry) => LoadedGuide | null;
}

/**
 * Everything the run pipeline needs, resolved from CLI inputs regardless of
 * source (local files/bundled, a remote package, or the remote repository).
 * Hiding the local-vs-remote decision behind this one shape keeps the command
 * action a straight pipeline.
 */
interface RunInputs {
  mode: RunMode;
  /** Guides to validate, plan, and run. */
  guides: LoadedGuide[];
  /** Dependency-planning source; undefined falls back to the local/bundled index. */
  repoSource?: RepoSource;
  /** Packages skipped before execution (remote modes). */
  preRunSkipped: GuideRunResult[];
  /** Per-guide package metadata for report enrichment (remote modes). */
  packageMetaById: Map<string, PackageMeta>;
  /** Local package directory for manifest pre-flight, when applicable. */
  localPackageDir?: string;
}

type GuideValidationError = { file: string; errors: string[] };

/**
 * Format guide validation errors as an indented, file-grouped report.
 */
function formatGuideValidationErrors(errors: GuideValidationError[]): string {
  return errors
    .map(({ file, errors: fileErrors }) =>
      [`  ${file}:`, ...fileErrors.map((error) => `    - ${error}`), ''].join('\n')
    )
    .join('\n');
}

/**
 * Validate all loaded guides, partitioning them into valid guides and per-file errors.
 */
function validateAllGuides(
  guides: LoadedGuide[],
  options: E2ECommandOptions
): { valid: LoadedGuide[]; errors: GuideValidationError[]; hasErrors: boolean } {
  const results = guides.map((guide) => ({ guide, result: validateGuideFromString(guide.content) }));

  if (options.verbose) {
    results
      .filter(({ result }) => result.isValid && result.warnings.length > 0)
      .forEach(({ guide, result }) => console.log(`⚠️  ${guide.path}: ${result.warnings.length} warning(s)`));
  }

  const valid = results.filter(({ result }) => result.isValid).map(({ guide }) => guide);
  const errors = results
    .filter(({ result }) => !result.isValid)
    .map(({ guide, result }) => ({ file: guide.path, errors: toLegacyResult(result).errors }));

  return { valid, errors, hasErrors: errors.length > 0 };
}

/**
 * Load a specific bundled guide by name (e.g., "bundled:welcome-to-grafana")
 * Matches against the filename without extension.
 */
function loadBundledGuide(name: string): LoadedGuide | null {
  const guideName = name.replace(/^bundled:/, '');
  const allBundled = loadBundledGuides();

  // First try exact match (filename without .json)
  const exactMatch = allBundled.find((g) => {
    const filename = g.path.split('/').pop()?.replace('.json', '') ?? '';
    return filename === guideName;
  });

  if (exactMatch) {
    return exactMatch;
  }

  // Fall back to partial match for convenience
  return allBundled.find((g) => g.path.includes(guideName)) ?? null;
}

/**
 * Load a guide from a package directory.
 * Reads content.json from the directory; the manifest (if present) is handled separately.
 */
function loadGuideFromPackageDir(packageDir: string): LoadedGuide | null {
  const contentPath = join(packageDir, 'content.json');
  if (!existsSync(contentPath)) {
    console.error(`❌ No content.json found in package directory: ${packageDir}`);
    return null;
  }
  const loaded = loadGuideFiles([contentPath]);
  return loaded[0] ?? null;
}

/**
 * Resolve guide inputs to LoadedGuide array.
 * Supports: file paths, --bundled flag, bundled:name syntax, and --package <dir>.
 */
function resolveGuides(files: string[], options: E2ECommandOptions): LoadedGuide[] {
  const guides: LoadedGuide[] = [];

  // --package <dir> takes precedence over positional args and --bundled
  if (options.package) {
    const guide = loadGuideFromPackageDir(options.package);
    if (guide) {
      guides.push(guide);
    }
    return guides;
  }

  if (options.bundled) {
    // Load all bundled guides
    return loadBundledGuides();
  }

  for (const file of files) {
    if (file.startsWith('bundled:')) {
      // Handle bundled:name syntax
      const guide = loadBundledGuide(file);
      if (guide) {
        guides.push(guide);
      } else {
        console.warn(`Bundled guide not found: ${file}`);
      }
    } else {
      // Regular file path
      const loaded = loadGuideFiles([file]);
      guides.push(...loaded);
    }
  }

  return guides;
}

/**
 * Print the results of a manifest pre-flight check to the console.
 */
function printPreflightOutcome(outcome: PreflightOutcome, verbose: boolean): void {
  for (const result of outcome.results) {
    if (result.status === 'pass') {
      if (verbose) {
        console.log(`   ✓ ${result.check}`);
      }
    } else if (result.status === 'skip') {
      if (verbose) {
        console.log(`   ⊘ ${result.check}: ${result.reason}`);
      }
    } else {
      console.error(`   ✗ ${result.check}: ${result.message}`);
    }
  }
}

/** The dependency-aware execution plan produced by planGuideExecution. */
type ExecutionPlan = ReturnType<typeof planGuideExecution>;

/** Outcome of running every planned chain: per-guide results plus exit signals. */
interface ChainRunOutcome {
  results: GuideRunResult[];
  allPassed: boolean;
  hasAuthExpiry: boolean;
}

/**
 * Install exit/signal handlers that tear down the isolated --clean docker stack
 * exactly once. On SIGINT/SIGTERM, re-raise with the conventional 128+signal code.
 */
function installCleanTeardownHandlers(cleanEnv: CleanEnvironment): void {
  const exitHandler = () => cleanEnv.teardownIfOwned();
  const signalHandler = (signal: NodeJS.Signals) => {
    cleanEnv.teardownIfOwned();
    // Re-raise the signal with the conventional 128 + signal-number exit code
    const code = signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1;
    process.exit(code);
  };
  process.on('exit', exitHandler);
  process.on('SIGINT', signalHandler);
  process.on('SIGTERM', signalHandler);
}

/**
 * Resolve guide inputs, fail fast on an empty set, and return the guides that
 * pass schema validation. Exits with a configuration-error code on any failure.
 */
function resolveValidGuides(files: string[], options: E2ECommandOptions): LoadedGuide[] {
  const guides = resolveGuides(files, options);

  if (guides.length === 0) {
    if (options.package) {
      // Error already printed by loadGuideFromPackageDir
    } else if (options.bundled) {
      console.error('❌ No bundled guides found in src/bundled-interactives/');
    } else if (files.length === 0) {
      console.error('❌ Please specify guide files or use --bundled flag');
      console.error('   Usage: pathfinder-cli e2e ./guide.json');
      console.error('          pathfinder-cli e2e --bundled');
      console.error('          pathfinder-cli e2e bundled:welcome-to-grafana');
      console.error('          pathfinder-cli e2e --package ./my-package/');
    } else {
      console.error('❌ No valid guide files found in the specified paths');
    }
    process.exit(ExitCode.CONFIGURATION_ERROR);
  }

  if (options.verbose) {
    console.log(`\n📂 Loaded ${guides.length} guide(s):`);
    for (const guide of guides) {
      console.log(`   - ${guide.path}`);
    }
    console.log();
  }

  const { valid, errors, hasErrors } = validateAllGuides(guides, options);
  if (hasErrors) {
    console.error('\n❌ Guide validation failed:\n');
    console.error(formatGuideValidationErrors(errors));
    process.exit(ExitCode.CONFIGURATION_ERROR);
  }

  return valid;
}

/**
 * Print the validation-passed banner and the resolved run configuration.
 */
function printRunConfiguration(valid: LoadedGuide[], options: E2ECommandOptions, mode: RunMode): void {
  console.log(`\n✅ Guide validation passed for ${valid.length} guide(s).`);
  console.log('\n📋 E2E test configuration:');
  console.log(`   Grafana URL: ${options.grafanaUrl}`);
  console.log(`   Tier:        ${options.tier}`);
  console.log(`   Artifacts:   ${options.artifacts}`);
  if (mode === 'remote-package') {
    console.log(`   Package:     ${options.package} (remote)`);
  } else if (mode === 'remote-repository') {
    console.log(`   Source:      remote repository index`);
  } else if (options.package) {
    console.log(`   Package:     ${options.package}`);
  }
  if (options.output) {
    console.log(`   Output:      ${options.output}`);
  }
  if (options.trace) {
    console.log(`   Trace:       enabled`);
  }
  if (options.headed) {
    console.log(`   Headed:      enabled (browser visible)`);
  }
  if (options.alwaysScreenshot) {
    console.log(`   Screenshots: on success and failure`);
  }
  if (options.clean) {
    console.log(`   Clean:       enabled (project "${CLEAN_COMPOSE_PROJECT}", isolated from any dev stack)`);
  }
}

/**
 * Build a dependency-aware execution plan. Guides linked by `depends` run in
 * dependency order; under --clean each chain gets a fresh environment. Resolves
 * the repository index, validates any auto-included prerequisites, and prints
 * the plan in verbose mode. Exits on configuration errors.
 */
function buildExecutionPlan(valid: LoadedGuide[], options: E2ECommandOptions, repoSource?: RepoSource): ExecutionPlan {
  let repository: RepositoryJson;
  let loadGuideById: (id: string, entry: RepositoryEntry) => LoadedGuide | null;

  if (repoSource) {
    // Remote modes drive chaining from the CDN index and load prerequisites
    // from already-fetched guides rather than the local filesystem.
    repository = repoSource.repository;
    loadGuideById = repoSource.loadGuideById;
  } else {
    const repositoryPath = options.repository
      ? isAbsolute(options.repository)
        ? options.repository
        : resolve(process.cwd(), options.repository)
      : bundledRepositoryPath();

    if (options.repository && !existsSync(repositoryPath)) {
      console.error(`\n❌ Repository index not found: ${repositoryPath}`);
      process.exit(ExitCode.CONFIGURATION_ERROR);
    }

    repository = {};
    if (existsSync(repositoryPath)) {
      const loaded = loadRepositoryIndex(repositoryPath);
      if (loaded.error) {
        // An explicitly requested index that fails to load is a configuration
        // error; a malformed default (bundled) index degrades to no planning.
        if (options.repository) {
          console.error(`\n❌ Failed to load repository index (${repositoryPath}): ${loaded.error}`);
          process.exit(ExitCode.CONFIGURATION_ERROR);
        }
        console.warn(`⚠️  Ignoring default repository index (${repositoryPath}): ${loaded.error}`);
      }
      repository = loaded.repository ?? {};
    }

    const repoBaseDir = dirname(repositoryPath);
    loadGuideById = (id: string, entry: RepositoryEntry): LoadedGuide | null => {
      const rel = entry.path || `${id}/`;
      const contentPath = rel.endsWith('.json') ? join(repoBaseDir, rel) : join(repoBaseDir, rel, 'content.json');
      return loadGuideFiles([contentPath])[0] ?? null;
    };
  }

  const plan = planGuideExecution({ guides: valid, repository, loadGuideById });

  if (plan.errors.length > 0) {
    console.error('\n❌ Failed to plan guide execution:');
    for (const planError of plan.errors) {
      console.error(`   • ${planError}`);
    }
    process.exit(ExitCode.CONFIGURATION_ERROR);
  }

  // Validate prerequisites that were auto-included to satisfy dependencies.
  const autoIncludedGuides = plan.chains
    .flat()
    .filter((p) => p.autoIncluded)
    .map((p) => p.guide);
  const { hasErrors: autoHasErrors, errors: autoErrors } = validateAllGuides(autoIncludedGuides, options);
  if (autoHasErrors) {
    console.error('\n❌ Auto-included prerequisite validation failed:\n');
    console.error(formatGuideValidationErrors(autoErrors));
    process.exit(ExitCode.CONFIGURATION_ERROR);
  }
  if (autoIncludedGuides.length > 0) {
    console.log(
      `\n➕ Auto-included ${autoIncludedGuides.length} prerequisite guide(s): ${plan.autoIncludedIds.join(', ')}`
    );
  }

  if (options.verbose) {
    console.log(`\n🔗 Execution plan: ${plan.chains.length} chain(s)`);
    plan.chains.forEach((chain, idx) => {
      const names = chain.map((p) => `${p.id}${p.autoIncluded ? ' (auto)' : ''}`).join(' → ');
      console.log(`   Chain ${idx + 1}: ${names}`);
    });
  }

  return plan;
}

/**
 * Under --clean, reset the isolated docker stack before any tests run.
 * Exits on failure. No-op otherwise.
 */
async function maybeCleanStart(cleanEnv: CleanEnvironment, options: E2ECommandOptions): Promise<void> {
  if (!options.clean) {
    return;
  }
  console.log('\n🧹 Clean start — resetting docker compose before tests...');
  try {
    await cleanEnv.reset(options.grafanaUrl, options.cleanReadyTimeoutMs);
  } catch (err) {
    console.error(`\n❌ Failed to reset docker compose: ${err instanceof Error ? err.message : 'Unknown error'}`);
    process.exit(ExitCode.CONFIGURATION_ERROR);
  }
}

/**
 * Run CLI-level pre-flight checks: load the package manifest (when --package),
 * apply the tier check, verify Grafana health, then run manifest version/plugin
 * checks. Exits with the appropriate code on any failure or tier skip.
 */
async function runPreflightChecks(options: E2ECommandOptions, packageDir?: string): Promise<void> {
  console.log('\n🔍 Running pre-flight checks...');

  // Manifest pre-flight applies to a local package directory only. Remote modes
  // resolve tier/target during package resolution, so there is no local manifest
  // to read here.
  // Load manifest early so the tier check can run before any network I/O.
  // A tier mismatch (e.g. cloud guide on a local env) means the guide should be
  // skipped — we want that message even when Grafana is not reachable.
  let packageManifest: ManifestJson | null = null;
  if (packageDir) {
    try {
      packageManifest = loadManifestFromDir(packageDir);
    } catch (err) {
      console.error(`\n❌ Failed to load manifest.json: ${err instanceof Error ? err.message : 'Unknown error'}`);
      process.exit(ExitCode.CONFIGURATION_ERROR);
    }

    if (packageManifest) {
      const tierResult = checkTier(packageManifest.testEnvironment ?? {}, options.tier);
      if (tierResult.status === 'skip' && tierResult.code === 'tier-mismatch') {
        const tierMsg = packageManifest.testEnvironment?.tier ?? 'unknown';
        console.log(`\n⊘ Guide skipped: requires tier "${tierMsg}" but current environment is "${options.tier}".`);
        console.log(`   Use --tier ${tierMsg} to run this guide against a matching environment.`);
        process.exit(ExitCode.SUCCESS);
      }
    }
  }

  // 1. Check Grafana health (public endpoint, no auth needed)
  const healthCheck = await checkGrafanaHealth(options.grafanaUrl);

  if (options.verbose) {
    const status = healthCheck.passed ? '✓' : '✗';
    console.log(`   ${status} grafana-reachable [${healthCheck.durationMs}ms]`);
    if (!healthCheck.passed && healthCheck.error) {
      console.log(`     Error: ${healthCheck.error}`);
    }
  }

  if (!healthCheck.passed) {
    console.error(`\n❌ Pre-flight check failed: ${healthCheck.error}`);
    console.error('   Ensure Grafana is running and accessible at the specified URL.');
    process.exit(ExitCode.GRAFANA_UNREACHABLE);
  }

  console.log('   ✓ Grafana is reachable');

  // 2. Manifest pre-flight — version and plugin checks (local package dir only)
  if (packageDir) {
    if (packageManifest) {
      console.log('   → Running manifest pre-flight checks...');
      const outcome = await runManifestPreflight(packageManifest, {
        grafanaUrl: options.grafanaUrl,
        currentTier: options.tier,
        grafanaVersion: healthCheck.version,
      });

      printPreflightOutcome(outcome, options.verbose);

      if (outcome.skipped) {
        // Defensive: tier skip was already handled above; shouldn't reach here
        const tierMsg = packageManifest.testEnvironment?.tier ?? 'unknown';
        console.log(`\n⊘ Guide skipped: requires tier "${tierMsg}" but current environment is "${options.tier}".`);
        console.log(`   Use --tier ${tierMsg} to run this guide against a matching environment.`);
        process.exit(ExitCode.SUCCESS);
      }

      if (!outcome.canRun) {
        console.error('\n❌ Manifest pre-flight failed — guide cannot run in this environment:');
        for (const result of outcome.results) {
          if (result.status === 'fail') {
            console.error(`   • ${result.check}: ${result.message}`);
          }
        }
        process.exit(ExitCode.CONFIGURATION_ERROR);
      }

      console.log('   ✓ Manifest pre-flight passed');
    } else {
      if (options.verbose) {
        console.log('   ⊘ No manifest.json found — skipping manifest pre-flight');
      }
      console.log('   → Auth and plugin checks will run in Playwright context');
    }
  } else {
    console.log('   → Auth and plugin checks will run in Playwright context');
  }
}

/**
 * Merge package metadata into a guide's report data (no-op for local guides,
 * which have no package metadata).
 */
function applyPackageMeta(data: TestResultsData | undefined, meta: PackageMeta | undefined): void {
  if (!data || !meta) {
    return;
  }
  data.guide = {
    ...data.guide,
    packageId: meta.packageId,
    tier: meta.tier,
    instance: meta.instance,
    targetUrl: meta.targetUrl,
    sourceUrl: meta.sourceUrl,
  };
}

/**
 * Execute the planned chains guide-by-guide. Under --clean the environment is
 * reset between chains (not between guides in a chain). Guides whose prerequisite
 * failed within a chain are skipped. Returns per-guide results plus whether
 * everything passed and whether a session expired.
 */
async function runChains(
  plan: ExecutionPlan,
  options: E2ECommandOptions,
  cleanEnv: CleanEnvironment,
  packageMetaById: Map<string, PackageMeta> = new Map()
): Promise<ChainRunOutcome> {
  console.log('\n🎭 Running Playwright tests...\n');

  let allPassed = true;
  let hasAuthExpiry = false;
  const results: GuideRunResult[] = [];

  for (const [chainIndex, chain] of plan.chains.entries()) {
    if (options.clean && chainIndex > 0) {
      console.log(`\n🧹 Resetting docker compose between chains...`);
      try {
        await cleanEnv.reset(options.grafanaUrl, options.cleanReadyTimeoutMs);
      } catch (err) {
        console.error(
          `\n❌ Failed to reset docker compose between chains: ${err instanceof Error ? err.message : 'Unknown error'}`
        );
        allPassed = false;
        break;
      }
    }

    // IDs in this chain that failed or were skipped; their dependents skip.
    const blocked = new Set<string>();

    for (const planned of chain) {
      const blockingDep = planned.dependencies.find((dep) => blocked.has(dep));
      if (blockingDep) {
        blocked.add(planned.id);
        console.log(`\n📚 ${planned.guide.path}`);
        console.log(`   ⊘ Skipped: prerequisite "${blockingDep}" did not pass`);
        const prereqResultsData: TestResultsData = {
          guide: { id: planned.id, title: planned.id, path: planned.guide.path },
          grafanaUrl: options.grafanaUrl,
          timestamp: new Date().toISOString(),
          results: [],
          aborted: true,
          abortReason: 'SKIPPED_PREREQ',
          abortMessage: `Prerequisite "${blockingDep}" did not pass`,
        };
        applyPackageMeta(prereqResultsData, packageMetaById.get(planned.id));
        results.push({
          guide: planned.guide.path,
          id: planned.id,
          status: 'skipped_prereq',
          exitCode: ExitCode.SUCCESS,
          autoIncluded: planned.autoIncluded,
          failedPrerequisite: blockingDep,
          // Include a result so the skipped guide is represented in the JSON report
          resultsData: prereqResultsData,
        });
        continue;
      }

      const suffix = planned.autoIncluded ? ' (auto-included prerequisite)' : '';
      console.log(`\n📚 Testing: ${planned.guide.path}${suffix}`);

      const result = await runPlaywrightTests(planned.guide, options);
      applyPackageMeta(result.resultsData, packageMetaById.get(planned.id));
      const status: GuideStatus = result.success
        ? 'passed'
        : result.abortReason === 'AUTH_EXPIRED'
          ? 'auth_expired'
          : 'failed';

      results.push({
        guide: planned.guide.path,
        id: planned.id,
        status,
        exitCode: result.exitCode,
        traceFile: result.traceFile,
        abortReason: result.abortReason,
        abortMessage: result.abortMessage,
        resultsData: result.resultsData,
        autoIncluded: planned.autoIncluded,
      });

      if (!result.success) {
        allPassed = false;
        blocked.add(planned.id);

        if (result.abortReason === 'AUTH_EXPIRED') {
          hasAuthExpiry = true;
          console.log(`   ❌ Session expired: ${result.abortMessage}`);
        } else {
          console.log(`   ❌ Test failed (exit code: ${result.exitCode})`);
        }
      } else {
        console.log(`   ✅ Test passed`);
      }

      if (result.traceFile && options.trace) {
        console.log(`   📊 Trace file: ${result.traceFile}`);
      }
    }
  }

  return { results, allPassed, hasAuthExpiry };
}

/**
 * Count guides by terminal status. Computed once and shared by both summary
 * presentations.
 */
function countGuideStatuses(results: GuideRunResult[]): Record<GuideStatus, number> {
  const counts = Object.fromEntries(GUIDE_STATUS_LABELS.map(([status]) => [status, 0])) as Record<GuideStatus, number>;
  for (const result of results) {
    counts[result.status] += 1;
  }
  return counts;
}

/** Short parenthetical reason for a guide's per-line listing, if any. */
function guideResultReason(result: GuideRunResult): string {
  if (result.status === 'skipped_prereq' && result.failedPrerequisite) {
    return ` (prerequisite "${result.failedPrerequisite}" failed)`;
  }
  if (result.status === 'auth_expired') {
    return ' (auth expired)';
  }
  if (result.abortMessage && result.status !== 'passed' && result.status !== 'failed') {
    return ` (${result.abortMessage})`;
  }
  return '';
}

/**
 * Print the run summary: aggregate guide/step counts for multi-guide runs, or a
 * compact pass/fail breakdown for a single guide.
 */
function printSummary(results: GuideRunResult[]): void {
  const resultsWithData = results.filter((r) => r.resultsData).map((r) => r.resultsData!);
  const isMultiGuide = results.length > 1;
  const counts = countGuideStatuses(results);

  console.log('\n' + '─'.repeat(68));
  console.log('📊 Summary');
  console.log('─'.repeat(68));

  if (isMultiGuide) {
    // Multi-guide summary: passed headline + one line per non-zero status.
    console.log(`\n   Guides: ${counts.passed}/${results.length} passed`);
    for (const [status, label] of GUIDE_STATUS_LABELS) {
      if (status !== 'passed' && counts[status] > 0) {
        console.log(`   ├─ ${label}: ${counts[status]}`);
      }
    }

    // Aggregate step statistics across all guides
    if (resultsWithData.length > 0) {
      const totalSteps = resultsWithData.reduce((sum, r) => sum + r.results.length, 0);
      const passedSteps = resultsWithData.reduce(
        (sum, r) => sum + r.results.filter((s) => s.status === 'passed').length,
        0
      );
      const failedSteps = resultsWithData.reduce(
        (sum, r) => sum + r.results.filter((s) => s.status === 'failed').length,
        0
      );
      const skippedSteps = resultsWithData.reduce(
        (sum, r) => sum + r.results.filter((s) => s.status === 'skipped').length,
        0
      );
      const notReachedSteps = resultsWithData.reduce(
        (sum, r) => sum + r.results.filter((s) => s.status === 'not_reached').length,
        0
      );

      console.log(`\n   Steps: ${totalSteps} total`);
      console.log(`   ├─ ✅ Passed: ${passedSteps}`);
      if (failedSteps > 0) {
        console.log(`   ├─ ❌ Failed: ${failedSteps}`);
      }
      if (skippedSteps > 0) {
        console.log(`   ├─ ⊘ Skipped: ${skippedSteps}`);
      }
      if (notReachedSteps > 0) {
        console.log(`   └─ ○ Not reached: ${notReachedSteps}`);
      }
    }

    // List individual guide results
    console.log(`\n   Guide results:`);
    for (const result of results) {
      const icon = GUIDE_STATUS_ICONS[result.status];
      const suffix = result.autoIncluded ? ' (auto-included)' : '';
      console.log(`   ${icon} ${result.id}${suffix}${guideResultReason(result)}`);
    }
  } else {
    // Single guide summary: one line per non-zero status.
    for (const [status, label] of GUIDE_STATUS_LABELS) {
      if (counts[status] > 0) {
        console.log(`   ${label}: ${counts[status]}`);
      }
    }
  }

  console.log('\n' + '─'.repeat(68));
}

/** Extract pre-run skip outcomes (remote modes) for inclusion in the JSON report. */
function preRunSkipsFromResults(results: GuideRunResult[]): PreRunSkip[] {
  return results
    .filter((r) => PRE_RUN_SKIP_STATUSES.has(r.status))
    .map((r) => ({ id: r.id, reason: r.status, message: r.abortMessage ?? '', tier: r.tier, sourceUrl: r.guide }));
}

/**
 * Write the JSON report when --output is set: an aggregated multi-guide report
 * or a single detailed report. A failure to write is a warning, not an error.
 */
function writeJsonReport(results: GuideRunResult[], options: E2ECommandOptions): void {
  if (!options.output) {
    return;
  }

  const resultsWithData = results.filter((r) => r.resultsData).map((r) => r.resultsData!);
  const isMultiGuide = results.length > 1;
  const preRunSkipped = preRunSkipsFromResults(results);

  if (resultsWithData.length === 0) {
    console.warn(`   ⚠ No test results available for JSON report`);
  } else if (isMultiGuide) {
    try {
      const report = generateMultiGuideReport(resultsWithData, options.grafanaUrl);
      if (preRunSkipped.length > 0) {
        report.preRunSkipped = preRunSkipped;
      }
      writeMultiGuideReport(report, options.output);
      console.log(`\n📄 Multi-guide JSON report written to: ${options.output}`);
      console.log(`   ${formatMultiGuideSummary(report)}`);
    } catch (err) {
      console.warn(`   ⚠ Failed to write JSON report: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  } else {
    try {
      const report = generateReport(resultsWithData[0]!);
      if (preRunSkipped.length > 0) {
        report.preRunSkipped = preRunSkipped;
      }
      writeReport(report, options.output);
      console.log(`\n📄 JSON report written to: ${options.output}`);
    } catch (err) {
      console.warn(`   ⚠ Failed to write JSON report: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }
}

/**
 * Exit with the code implied by the final results: auth failure takes precedence
 * over a generic/validation test failure; a fully passing run returns to the caller.
 */
function exitFromResults(results: GuideRunResult[]): void {
  if (results.some((r) => r.status === 'auth_expired')) {
    process.exit(ExitCode.AUTH_FAILURE);
  }
  if (results.some((r) => FAILURE_STATUSES.has(r.status))) {
    process.exit(ExitCode.TEST_FAILURE);
  }
}

/**
 * Finalize a run: print the summary, write the JSON report (when requested), and
 * exit per the results' statuses. Shared by the normal path and the
 * nothing-to-run path so both report identically.
 */
function reportResults(results: GuideRunResult[], options: E2ECommandOptions): void {
  printSummary(results);
  writeJsonReport(results, options);
  exitFromResults(results);
}

/** True when the value points at an existing local directory (vs. a bare package ID). */
function isExistingDir(value: string): boolean {
  try {
    return existsSync(value) && statSync(value).isDirectory();
  } catch {
    return false;
  }
}

/** Determine how guide inputs should be resolved for this run. */
function resolveRunMode(options: E2ECommandOptions): RunMode {
  if (options.remote) {
    return 'remote-repository';
  }
  if (options.package && !isExistingDir(options.package)) {
    return 'remote-package';
  }
  return 'local';
}

/** Convert a pre-run skipped package into a guide run result. */
function skipToResult(skip: SkippedPackage): GuideRunResult {
  return {
    guide: skip.sourceUrl ?? skip.id,
    id: skip.id,
    status: skip.reason,
    exitCode: skip.reason === 'validation_failed' ? ExitCode.TEST_FAILURE : ExitCode.SUCCESS,
    autoIncluded: false,
    abortMessage: skip.message,
    tier: skip.tier,
  };
}

/** Index resolved remote guides by ID for report enrichment. */
function buildPackageMetaMap(runnable: ResolvedRemoteGuide[]): Map<string, PackageMeta> {
  return new Map(
    runnable.map((g) => [
      g.id,
      { packageId: g.id, tier: g.tier, instance: g.instance, targetUrl: g.targetUrl, sourceUrl: g.sourceUrl },
    ])
  );
}

/**
 * Build a synchronous `loadGuideById` backed by already-fetched remote guides.
 * Used for dependency chaining; prerequisites outside the fetched set (e.g. a
 * different tier) resolve to null.
 */
function remoteLoadGuideById(
  runnable: ResolvedRemoteGuide[]
): (id: string, entry: RepositoryEntry) => LoadedGuide | null {
  const byId = new Map(runnable.map((g) => [g.id, g.guide]));
  return (id: string) => byId.get(id) ?? null;
}

/** Print a one-line (or verbose) summary of what remote resolution produced. */
function printRemoteResolution(resolution: RemoteResolution, mode: RunMode, options: E2ECommandOptions): void {
  const source = mode === 'remote-package' ? `package "${options.package}"` : 'repository index';
  console.log(`\n📦 Resolved ${source}: ${resolution.runnable.length} runnable, ${resolution.skipped.length} skipped`);
  if (options.verbose) {
    for (const g of resolution.runnable) {
      console.log(`   ✓ ${g.id} (${g.tier}) → ${g.sourceUrl}`);
    }
    for (const s of resolution.skipped) {
      console.log(`   ⊘ ${s.id}: ${s.reason} — ${s.message}`);
    }
  }
}

/**
 * Resolve CLI inputs into a uniform, runnable set, hiding whether guides come
 * from local files/bundled content, a remote package ID, or the remote
 * repository index. Prints remote-resolution feedback and exits on fatal remote
 * resolution errors; local validation failures exit inside `resolveValidGuides`.
 */
async function resolveRunInputs(files: string[], options: E2ECommandOptions): Promise<RunInputs> {
  const mode = resolveRunMode(options);

  if (mode === 'local') {
    return {
      mode,
      guides: resolveValidGuides(files, options),
      preRunSkipped: [],
      packageMetaById: new Map(),
      localPackageDir: options.package,
    };
  }

  const remoteOptions = {
    grafanaUrl: options.grafanaUrl,
    currentTier: options.tier,
    resolverUrl: options.resolverUrl,
    repoUrl: options.repoUrl,
  };
  const resolution =
    mode === 'remote-package'
      ? await resolveRemotePackage(options.package!, remoteOptions)
      : await resolveRemoteRepository(remoteOptions);

  if (resolution.error) {
    console.error(`\n❌ ${resolution.error}`);
    process.exit(ExitCode.CONFIGURATION_ERROR);
  }

  printRemoteResolution(resolution, mode, options);

  // Only `runnable` guides are selected to run; `prerequisites` are made
  // available to the planner (loader + metadata) so it auto-includes them the
  // same way a local selection pulls in its dependencies.
  const loadable = [...resolution.runnable, ...resolution.prerequisites];
  return {
    mode,
    guides: resolution.runnable.map((g) => g.guide),
    repoSource: {
      repository: resolution.repository,
      loadGuideById: remoteLoadGuideById(loadable),
    },
    preRunSkipped: resolution.skipped.map(skipToResult),
    packageMetaById: buildPackageMetaMap(loadable),
  };
}

// Generate unique run ID for default artifacts path
const defaultArtifactsDir = `/tmp/pathfinder-e2e-${randomUUID().slice(0, 8)}`;

export const e2eCommand = new Command('e2e')
  .description('Run E2E tests on JSON guide files')
  .arguments('[files...]')
  .option(
    '--grafana-url <url>',
    `Grafana instance URL (default ${DEFAULT_GRAFANA_URL}; ${CLEAN_GRAFANA_URL} when --clean is set and this flag is not passed)`,
    DEFAULT_GRAFANA_URL
  )
  .option('--output <path>', 'Path for JSON report output')
  .option('--artifacts <dir>', 'Directory for artifacts', defaultArtifactsDir)
  .option('--verbose', 'Enable verbose logging', false)
  .option('--bundled', 'Test all bundled guides')
  .option(
    '--package <dirOrId>',
    'Test a package: a local directory (content.json + manifest.json), or — when not an existing directory — a bare package ID resolved via the recommender'
  )
  .addOption(new Option('--tier <tier>', 'Current test environment tier').choices(['local', 'cloud']).default('local'))
  .option('--trace', 'Generate Playwright trace file', false)
  .option('--headed', 'Run browser in headed mode (visible)', false)
  .option('--always-screenshot', 'Capture screenshots on success and failure', false)
  .option(
    '--clean',
    `Run tests against an isolated docker-compose stack (project "${CLEAN_COMPOSE_PROJECT}", Grafana on ${CLEAN_GRAFANA_URL}). Resets between dependency chains (not between guides in the same chain) and tears down at the end.`,
    false
  )
  .option(
    '--clean-ready-timeout-ms <ms>',
    'How long to wait for the isolated Grafana to become healthy after a --clean reset',
    (v) => parseInt(v, 10),
    120000
  )
  .option(
    '--repository <path>',
    'Path to a repository.json used for dependency-aware ordering (default: the bundled index when present)'
  )
  .option('--remote', 'Resolve and test every package from the CDN repository index', false)
  .option('--repo-url <url>', 'CDN base URL for --remote (default: the public Pathfinder package repository)')
  .option('--resolver-url <url>', 'Recommender base URL for --package <id> resolution', DEFAULT_RESOLVER_URL)
  .action(async (files: string[], options: E2ECommandOptions) => {
    const cleanEnv = new CleanEnvironment(options.verbose);
    if (options.clean) {
      installCleanTeardownHandlers(cleanEnv);

      if (options.grafanaUrl === DEFAULT_GRAFANA_URL) {
        options.grafanaUrl = CLEAN_GRAFANA_URL;
      }
    }

    try {
      const inputs = await resolveRunInputs(files, options);

      // Remote runs can resolve to nothing runnable (e.g. all cloud-tier guides):
      // report the skips and exit without booting Grafana or Playwright.
      if (inputs.guides.length === 0) {
        reportResults(inputs.preRunSkipped, options);
        return;
      }

      printRunConfiguration(inputs.guides, options, inputs.mode);

      const plan = buildExecutionPlan(inputs.guides, options, inputs.repoSource);

      await maybeCleanStart(cleanEnv, options);

      await runPreflightChecks(options, inputs.localPackageDir);

      const outcome = await runChains(plan, options, cleanEnv, inputs.packageMetaById);

      reportResults([...inputs.preRunSkipped, ...outcome.results], options);
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(ExitCode.CONFIGURATION_ERROR);
    }
  });
