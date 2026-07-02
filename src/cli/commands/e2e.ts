/**
 * E2E Test Command
 *
 * Run E2E tests on JSON guide files. Spawns Playwright to inject guides
 * into localStorage and verify they load correctly in the docs panel.
 */

import { existsSync } from 'fs';
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
import { planGuideExecution, type ExecutionPlan } from '../e2e/guide-chains';
import type { TestResultsData } from '../e2e/e2e-reporter';
import { checkTier, loadManifestFromDir, runManifestPreflight, type CurrentTier } from '../e2e/manifest-preflight';
import {
  resolveRemotePackage,
  resolveRemoteRepository,
  type RemoteResolveOptions,
  type ResolvedRemoteGuide,
} from '../e2e/e2e-package';
import { checkGrafanaHealth } from '../e2e/grafana-health';
import { CleanEnvironment, CLEAN_COMPOSE_PROJECT, CLEAN_GRAFANA_URL } from '../e2e/clean-environment';
import { ExitCode } from '../e2e/exit-codes';
import { runPlaywrightTests, type RunGuideOptions } from '../e2e/playwright-runner';
import {
  applyPackageMeta,
  buildPackageMetaMap,
  exitCodeFromResults,
  provisioningFailureResults,
  resolveRunMode,
  skipToResult,
  type GuideRunResult,
  type GuideStatus,
  type PackageMeta,
  type RunMode,
} from '../e2e/e2e-results';
import {
  printPreflightOutcome,
  printRemoteResolution,
  printRunConfiguration,
  printSummary,
  writeJsonReport,
} from '../e2e/e2e-console-reporter';
import type { ManifestJson, RepositoryEntry, RepositoryJson } from '../../types/package.types';

import { randomUUID } from 'crypto';
import { createCloudAuthPolicy, type CloudAuthPolicy } from '../e2e/cloud-auth';
import { cloudTargetsInChain, provisionCloudTargetsForChain, sweepCloudTargets } from '../e2e/cloud-provisioning';
import { unsafeCloudGuidesInChain, unsafeSharedStackMessage, unsafeSharedStackSkipResults } from '../e2e/cloud-routing';
import {
  ColdCloudStackCleanupRegistry,
  createColdCloudStackProvisioningConfig,
  type ColdCloudStackProvisioningConfig,
} from '../e2e/cold-cloud-stack-environment';
import { preflightTargetUrlsForPlan } from '../e2e/preflight-targets';

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
  /** Host-to-env-var mappings for cloud instance admin tokens. */
  cloudInstanceAdminToken: string[];
  /** Default cloud instance URL for cloud-tier guides without an `instance`. */
  cloudUrl: string;
  /** Env var containing a Grafana Cloud Access Policy token for cold stack provisioning. */
  cloudStackAccessPolicyToken?: string;
  /** Grafana Cloud region slug for cold stack provisioning. */
  cloudStackRegion?: string;
  /** Slug prefix for cold-provisioned Grafana Cloud stacks. */
  cloudStackSlugPrefix?: string;
  /** Pathfinder plugin version to install on cold-provisioned stacks. */
  cloudStackPluginVersion?: string;
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

const DEFAULT_GRAFANA_URL = 'http://localhost:3000';
const DEFAULT_RESOLVER_URL = 'https://recommender.grafana.com';
const DEFAULT_CLOUD_URL = 'https://learn.grafana.net/';

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
  /** Cloud credential policy for target resolution and runner auth (remote modes). */
  cloudAuth?: CloudAuthPolicy;
  /** Cold isolated-stack provisioning config for unsafe cloud chains. */
  cloudStack?: ColdCloudStackProvisioningConfig;
  /** Local package directory for manifest pre-flight, when applicable. */
  localPackageDir?: string;
}

type GuideValidationError = { file: string; errors: string[] };

/** Format guide validation errors as an indented, file-grouped report. */
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

  const exactMatch = allBundled.find((g) => {
    const filename = g.path.split('/').pop()?.replace('.json', '') ?? '';
    return filename === guideName;
  });

  if (exactMatch) {
    return exactMatch;
  }

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

  if (options.package) {
    const guide = loadGuideFromPackageDir(options.package);
    if (guide) {
      guides.push(guide);
    }
    return guides;
  }

  if (options.bundled) {
    return loadBundledGuides();
  }

  for (const file of files) {
    if (file.startsWith('bundled:')) {
      const guide = loadBundledGuide(file);
      if (guide) {
        guides.push(guide);
      } else {
        console.warn(`Bundled guide not found: ${file}`);
      }
    } else {
      const loaded = loadGuideFiles([file]);
      guides.push(...loaded);
    }
  }

  return guides;
}

/** Outcome of running every planned chain: per-guide results plus exit signals. */
interface ChainRunOutcome {
  results: GuideRunResult[];
  allPassed: boolean;
  hasAuthExpiry: boolean;
  cleanupWarnings: string[];
}

const REPEATED_SIGNAL_FORCE_EXIT_GRACE_MS = 30_000;

/**
 * Install exit/signal handlers that tear down owned isolated environments.
 * On SIGINT/SIGTERM, re-raise with the conventional 128+signal code.
 */
function installTeardownHandlers(cleanEnv: CleanEnvironment, cloudStackCleanup: ColdCloudStackCleanupRegistry): void {
  let cleanupStartedAtMs: number | undefined;
  const exitHandler = () => cleanEnv.teardownIfOwned();
  const exitCodeForSignal = (signal: NodeJS.Signals) => (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
  const signalHandler = async (signal: NodeJS.Signals) => {
    const code = exitCodeForSignal(signal);
    if (cleanupStartedAtMs !== undefined) {
      const elapsedMs = Date.now() - cleanupStartedAtMs;
      if (elapsedMs >= REPEATED_SIGNAL_FORCE_EXIT_GRACE_MS) {
        console.warn('\n⚠ Force exiting before cleanup completed; Cloud stacks may require manual teardown.');
        process.exit(code);
        return;
      }
      const remainingSeconds = Math.ceil((REPEATED_SIGNAL_FORCE_EXIT_GRACE_MS - elapsedMs) / 1000);
      console.warn(
        `\n⚠ Cleanup is still running; ignoring repeated ${signal}. Press again in ${remainingSeconds}s to force exit, which may leave Cloud stacks running.`
      );
      return;
    }
    cleanupStartedAtMs = Date.now();
    try {
      const warnings = await cloudStackCleanup.teardownAll();
      for (const warning of warnings) {
        console.warn(`   ⚠ ${warning}`);
      }
    } catch (err) {
      console.warn(
        `   ⚠ Failed to tear down active Cloud stacks: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    } finally {
      cleanEnv.teardownIfOwned();
      process.exit(code);
    }
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
 * apply the tier check, verify each target's Grafana health, then run manifest
 * version/plugin checks. Exits with the appropriate code on any failure or tier
 * skip.
 */
async function runPreflightChecks(
  options: E2ECommandOptions,
  targetUrls: string[],
  packageDir?: string
): Promise<void> {
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

  // 1. Check each distinct target's Grafana health (public endpoint, no auth).
  const healthByUrl = new Map<string, Awaited<ReturnType<typeof checkGrafanaHealth>>>();
  for (const targetUrl of targetUrls) {
    const healthCheck = await checkGrafanaHealth(targetUrl);
    healthByUrl.set(targetUrl, healthCheck);

    if (options.verbose) {
      const status = healthCheck.passed ? '✓' : '✗';
      console.log(`   ${status} grafana-reachable (${targetUrl}) [${healthCheck.durationMs}ms]`);
      if (!healthCheck.passed && healthCheck.error) {
        console.log(`     Error: ${healthCheck.error}`);
      }
    }

    if (!healthCheck.passed) {
      console.error(`\n❌ Pre-flight check failed for ${targetUrl}: ${healthCheck.error}`);
      console.error('   Ensure Grafana is running and accessible at the target URL.');
      process.exit(ExitCode.GRAFANA_UNREACHABLE);
    }
  }

  if (targetUrls.length > 0) {
    console.log(`   ✓ Grafana is reachable (${targetUrls.length} target(s))`);
  } else if (options.verbose) {
    console.log('   ⊘ No runnable targets require Grafana reachability checks');
  }

  // 2. Manifest pre-flight — version and plugin checks (local package dir only).
  //    A local package dir is always a single local target (options.grafanaUrl).
  if (packageDir) {
    if (packageManifest) {
      console.log('   → Running manifest pre-flight checks...');
      const outcome = await runManifestPreflight(packageManifest, {
        grafanaUrl: options.grafanaUrl,
        currentTier: options.tier,
        grafanaVersion: healthByUrl.get(options.grafanaUrl)?.version,
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
 * Execute the planned chains guide-by-guide. Under --clean the environment is
 * reset between chains (not between guides in a chain). Guides whose prerequisite
 * failed within a chain are skipped. Returns per-guide results plus whether
 * everything passed and whether a session expired.
 */
async function runChains(
  plan: ExecutionPlan,
  options: E2ECommandOptions,
  cleanEnv: CleanEnvironment,
  packageMetaById: Map<string, PackageMeta> = new Map(),
  cloudAuth?: CloudAuthPolicy,
  cloudStack?: ColdCloudStackProvisioningConfig,
  cloudStackCleanup?: ColdCloudStackCleanupRegistry
): Promise<ChainRunOutcome> {
  console.log('\n🎭 Running Playwright tests...\n');

  let allPassed = true;
  let hasAuthExpiry = false;
  const cleanupWarnings: string[] = [];
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

    const unsafeCloudGuides = unsafeCloudGuidesInChain(chain, packageMetaById);
    if (unsafeCloudGuides.length > 0 && !cloudStack) {
      const message = unsafeSharedStackMessage(unsafeCloudGuides.map((planned) => planned.id));
      console.log(`\n⊘ Skipping cloud chain: ${message}`);
      results.push(...unsafeSharedStackSkipResults(chain, packageMetaById, message));
      continue;
    }
    let provisionedTargets: Awaited<ReturnType<typeof provisionCloudTargetsForChain>>;
    try {
      provisionedTargets = await provisionCloudTargetsForChain({
        targetUrls: cloudTargetsInChain(chain, packageMetaById, cloudAuth),
        cloudAuth,
        chain,
        packageMetaById,
        cloudStack,
        cloudStackCleanup,
        verbose: options.verbose,
      });
    } catch (err) {
      const message = `Cloud target provisioning failed: ${err instanceof Error ? err.message : 'Unknown error'}`;
      console.error(`\n❌ ${message}`);
      results.push(...provisioningFailureResults(chain, packageMetaById, options.grafanaUrl, message));
      allPassed = false;
      continue;
    }
    try {
      // IDs in this chain that failed or were skipped; their dependents skip.
      const blocked = new Set<string>();

      for (const planned of chain) {
        const blockingDep = planned.dependencies.find((dep) => blocked.has(dep));
        if (blockingDep) {
          blocked.add(planned.id);
          console.log(`
📚 ${planned.guide.path}`);
          console.log(`   ⊘ Skipped: prerequisite "${blockingDep}" did not pass`);
          const skippedMeta = packageMetaById.get(planned.id);
          const skippedTargetUrl = provisionedTargets.targetUrlForGuide(
            planned.id,
            skippedMeta?.targetUrl ?? options.grafanaUrl
          );
          const prereqResultsData: TestResultsData = {
            guide: {
              id: planned.id,
              title: planned.id,
              path: planned.guide.path,
              targetUrl: skippedTargetUrl,
            },
            timestamp: new Date().toISOString(),
            results: [],
            aborted: true,
            abortReason: 'SKIPPED_PREREQ',
            abortMessage: `Prerequisite "${blockingDep}" did not pass`,
          };
          applyPackageMeta(prereqResultsData, skippedMeta);
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
        console.log(`
📚 Testing: ${planned.guide.path}${suffix}`);

        const meta = packageMetaById.get(planned.id);
        const isCloudTarget = meta?.tier === 'cloud';
        const targetUrl = provisionedTargets.targetUrlForGuide(planned.id, meta?.targetUrl ?? options.grafanaUrl);
        const runGuideOptions: RunGuideOptions = {
          targetUrl,
          verbose: options.verbose,
          trace: options.trace,
          headed: options.headed,
          artifacts: options.artifacts,
          alwaysScreenshot: options.alwaysScreenshot,
          token: isCloudTarget ? provisionedTargets.tokenForGuide(planned.id, meta?.targetUrl) : undefined,
        };

        const result = await runPlaywrightTests(planned.guide, runGuideOptions);
        applyPackageMeta(result.resultsData, meta);
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
    } finally {
      cleanupWarnings.push(...(await provisionedTargets.teardownAll()));
    }
  }

  return { results, allPassed, hasAuthExpiry, cleanupWarnings };
}

/**
 * Exit with the code implied by the final results. A fully passing run returns
 * to the caller without exiting; any other outcome exits the process.
 */
function exitFromResults(results: GuideRunResult[]): void {
  const code = exitCodeFromResults(results);
  if (code !== ExitCode.SUCCESS) {
    process.exit(code);
  }
}

/**
 * Finalize a run: print the summary, write the JSON report (when requested), and
 * exit per the results' statuses. Shared by the normal path and the
 * nothing-to-run path so both report identically.
 */
function reportResults(results: GuideRunResult[], options: E2ECommandOptions, cleanupWarnings: string[] = []): void {
  printSummary(results, cleanupWarnings);
  writeJsonReport(results, options.output, cleanupWarnings);
  exitFromResults(results);
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

  const cloudAuth = createCloudAuthPolicy({
    cloudInstanceAdminTokenSpecs: options.cloudInstanceAdminToken,
  });
  const cloudStack = createColdCloudStackProvisioningConfig({
    accessPolicyTokenEnvVar: options.cloudStackAccessPolicyToken,
    region: options.cloudStackRegion,
    slugPrefix: options.cloudStackSlugPrefix,
    pluginVersion: options.cloudStackPluginVersion,
  });
  const remoteOptions: RemoteResolveOptions = {
    grafanaUrl: options.grafanaUrl,
    currentTier: options.tier,
    resolverUrl: options.resolverUrl,
    repoUrl: options.repoUrl,
    cloudUrl: options.cloudUrl,
    cloudTargetCapabilities: { ...cloudAuth.targets, isolatedStack: Boolean(cloudStack) },
  };
  const resolution =
    mode === 'remote-package'
      ? await resolveRemotePackage(options.package!, remoteOptions)
      : await resolveRemoteRepository(remoteOptions);

  if (resolution.error) {
    console.error(`\n❌ ${resolution.error}`);
    process.exit(ExitCode.CONFIGURATION_ERROR);
  }

  printRemoteResolution(resolution, mode, options.package, options.verbose);

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
    cloudAuth,
    cloudStack,
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
  .option(
    '--cloud-instance-admin-token <host=envVar>',
    'Admin service-account token env var for a cloud target; repeat for multiple cloud instances',
    collectOption,
    []
  )
  .option(
    '--cloud-url <url>',
    `Default cloud instance URL for cloud-tier guides without an instance (default ${DEFAULT_CLOUD_URL})`,
    DEFAULT_CLOUD_URL
  )
  .option(
    '--cloud-stack-access-policy-token <envVar>',
    'Cloud Access Policy token env var for cold isolated Grafana Cloud stack provisioning'
  )
  .option('--cloud-stack-region <region>', 'Grafana Cloud region slug for cold isolated stack provisioning')
  .option('--cloud-stack-slug-prefix <prefix>', 'Slug prefix for cold-provisioned Grafana Cloud stacks')
  .option('--cloud-stack-plugin-version <version>', 'Pathfinder plugin version to install on cold-provisioned stacks')
  .action(async (files: string[], options: E2ECommandOptions) => {
    const cleanEnv = new CleanEnvironment(options.verbose);
    const cloudStackCleanup = new ColdCloudStackCleanupRegistry();

    installTeardownHandlers(cleanEnv, cloudStackCleanup);
    if (options.clean && options.grafanaUrl === DEFAULT_GRAFANA_URL) {
      options.grafanaUrl = CLEAN_GRAFANA_URL;
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

      await sweepCloudTargets({
        targetUrls: inputs.cloudAuth?.targets.sharedStackUrls ?? [],
        cloudAuth: inputs.cloudAuth,
        verbose: options.verbose,
      });
      await runPreflightChecks(
        options,
        preflightTargetUrlsForPlan({
          plan,
          packageMetaById: inputs.packageMetaById,
          cloudAuth: inputs.cloudAuth,
          cloudStack: inputs.cloudStack,
          globalUrl: options.grafanaUrl,
        }),
        inputs.localPackageDir
      );

      const outcome = await runChains(
        plan,
        options,
        cleanEnv,
        inputs.packageMetaById,
        inputs.cloudAuth,
        inputs.cloudStack,
        cloudStackCleanup
      );

      reportResults([...inputs.preRunSkipped, ...outcome.results], options, outcome.cleanupWarnings);
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(ExitCode.CONFIGURATION_ERROR);
    }
  });
