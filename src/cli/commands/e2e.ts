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
import { planGuideExecution } from '../utils/guide-chains';
import {
  generateReport,
  writeReport,
  generateMultiGuideReport,
  writeMultiGuideReport,
  formatMultiGuideSummary,
  type TestResultsData,
} from '../utils/e2e-reporter';
import {
  checkTier,
  loadManifestFromDir,
  runManifestPreflight,
  type PreflightOutcome,
  type CurrentTier,
} from '../utils/manifest-preflight';
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
}

const DEFAULT_GRAFANA_URL = 'http://localhost:3000';

type GuideStatus = 'passed' | 'failed' | 'auth_expired' | 'skipped_prereq';

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
function printRunConfiguration(valid: LoadedGuide[], options: E2ECommandOptions): void {
  console.log(`\n✅ Guide validation passed for ${valid.length} guide(s).`);
  console.log('\n📋 E2E test configuration:');
  console.log(`   Grafana URL: ${options.grafanaUrl}`);
  console.log(`   Tier:        ${options.tier}`);
  console.log(`   Artifacts:   ${options.artifacts}`);
  if (options.package) {
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
function buildExecutionPlan(valid: LoadedGuide[], options: E2ECommandOptions): ExecutionPlan {
  const repositoryPath = options.repository
    ? isAbsolute(options.repository)
      ? options.repository
      : resolve(process.cwd(), options.repository)
    : bundledRepositoryPath();

  if (options.repository && !existsSync(repositoryPath)) {
    console.error(`\n❌ Repository index not found: ${repositoryPath}`);
    process.exit(ExitCode.CONFIGURATION_ERROR);
  }

  let repository: RepositoryJson = {};
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
  const loadGuideById = (id: string, entry: RepositoryEntry): LoadedGuide | null => {
    const rel = entry.path || `${id}/`;
    const contentPath = rel.endsWith('.json') ? join(repoBaseDir, rel) : join(repoBaseDir, rel, 'content.json');
    return loadGuideFiles([contentPath])[0] ?? null;
  };

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
async function runPreflightChecks(options: E2ECommandOptions): Promise<void> {
  console.log('\n🔍 Running pre-flight checks...');

  // Load manifest early so the tier check can run before any network I/O.
  // A tier mismatch (e.g. cloud guide on a local env) means the guide should be
  // skipped — we want that message even when Grafana is not reachable.
  let packageManifest: ManifestJson | null = null;
  if (options.package) {
    try {
      packageManifest = loadManifestFromDir(options.package);
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

  // 2. Manifest pre-flight — version and plugin checks (when --package is used)
  if (options.package) {
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
 * Execute the planned chains guide-by-guide. Under --clean the environment is
 * reset between chains (not between guides in a chain). Guides whose prerequisite
 * failed within a chain are skipped. Returns per-guide results plus whether
 * everything passed and whether a session expired.
 */
async function runChains(
  plan: ExecutionPlan,
  options: E2ECommandOptions,
  cleanEnv: CleanEnvironment
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
        results.push({
          guide: planned.guide.path,
          id: planned.id,
          status: 'skipped_prereq',
          exitCode: ExitCode.SUCCESS,
          autoIncluded: planned.autoIncluded,
          failedPrerequisite: blockingDep,
          // Include a result so the skipped guide is represented in the JSON report
          resultsData: {
            guide: { id: planned.id, title: planned.id, path: planned.guide.path },
            grafanaUrl: options.grafanaUrl,
            timestamp: new Date().toISOString(),
            results: [],
            aborted: true,
            abortReason: 'SKIPPED_PREREQ',
            abortMessage: `Prerequisite "${blockingDep}" did not pass`,
          },
        });
        continue;
      }

      const suffix = planned.autoIncluded ? ' (auto-included prerequisite)' : '';
      console.log(`\n📚 Testing: ${planned.guide.path}${suffix}`);

      const result = await runPlaywrightTests(planned.guide, options);
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

        // L3-3D: Check for auth expiry
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

interface GuideStatusCounts {
  passed: number;
  failed: number;
  authExpired: number;
  skippedPrereq: number;
}

/**
 * Count guides by terminal status. Computed once and shared by both summary
 * presentations.
 */
function countGuideStatuses(results: GuideRunResult[]): GuideStatusCounts {
  return {
    passed: results.filter((r) => r.status === 'passed').length,
    failed: results.filter((r) => r.status === 'failed').length,
    authExpired: results.filter((r) => r.status === 'auth_expired').length,
    skippedPrereq: results.filter((r) => r.status === 'skipped_prereq').length,
  };
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
    // Multi-guide summary (L3-7B)
    console.log(`\n   Guides: ${counts.passed}/${results.length} passed`);
    if (counts.failed > 0) {
      console.log(`   ├─ ❌ Failed: ${counts.failed}`);
    }
    if (counts.authExpired > 0) {
      console.log(`   ├─ 🔐 Auth expired: ${counts.authExpired}`);
    }
    if (counts.skippedPrereq > 0) {
      console.log(`   └─ ⊘ Skipped (prerequisite failed): ${counts.skippedPrereq}`);
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
      const icon =
        result.status === 'passed'
          ? '✅'
          : result.status === 'auth_expired'
            ? '🔐'
            : result.status === 'skipped_prereq'
              ? '⊘'
              : '❌';
      const guideName = result.id;
      const suffix = result.autoIncluded ? ' (auto-included)' : '';
      const reason =
        result.status === 'auth_expired'
          ? ' (auth expired)'
          : result.status === 'skipped_prereq'
            ? ` (prerequisite "${result.failedPrerequisite}" failed)`
            : '';
      console.log(`   ${icon} ${guideName}${suffix}${reason}`);
    }
  } else {
    // Single guide summary
    if (counts.passed > 0) {
      console.log(`   ✅ Passed: ${counts.passed}`);
    }
    if (counts.failed > 0) {
      console.log(`   ❌ Failed: ${counts.failed}`);
    }
    if (counts.authExpired > 0) {
      console.log(`   🔐 Auth expired: ${counts.authExpired}`);
    }
    if (counts.skippedPrereq > 0) {
      console.log(`   ⊘ Skipped (prerequisite failed): ${counts.skippedPrereq}`);
    }
  }

  console.log('\n' + '─'.repeat(68));
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

  if (resultsWithData.length === 0) {
    console.warn(`   ⚠ No test results available for JSON report`);
  } else if (isMultiGuide) {
    try {
      const report = generateMultiGuideReport(resultsWithData, options.grafanaUrl);
      writeMultiGuideReport(report, options.output);
      console.log(`\n📄 Multi-guide JSON report written to: ${options.output}`);
      console.log(`   ${formatMultiGuideSummary(report)}`);
    } catch (err) {
      console.warn(`   ⚠ Failed to write JSON report: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  } else {
    try {
      const report = generateReport(resultsWithData[0]!);
      writeReport(report, options.output);
      console.log(`\n📄 JSON report written to: ${options.output}`);
    } catch (err) {
      console.warn(`   ⚠ Failed to write JSON report: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }
}

/**
 * Exit with the code implied by the run outcome: auth failure takes precedence
 * over a generic test failure; a fully passing run returns to the caller.
 */
function exitFromOutcome(outcome: ChainRunOutcome): void {
  if (!outcome.allPassed) {
    // L3-3D: Use exit code 4 for auth expiry
    if (outcome.hasAuthExpiry) {
      process.exit(ExitCode.AUTH_FAILURE);
    }
    process.exit(ExitCode.TEST_FAILURE);
  }
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
  .option('--package <dir>', 'Load content.json from a package directory; reads manifest.json for pre-flight checks')
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
  .action(async (files: string[], options: E2ECommandOptions) => {
    const cleanEnv = new CleanEnvironment(options.verbose);
    if (options.clean) {
      installCleanTeardownHandlers(cleanEnv);

      if (options.grafanaUrl === DEFAULT_GRAFANA_URL) {
        options.grafanaUrl = CLEAN_GRAFANA_URL;
      }
    }

    try {
      const valid = resolveValidGuides(files, options);

      printRunConfiguration(valid, options);

      const plan = buildExecutionPlan(valid, options);

      await maybeCleanStart(cleanEnv, options);

      await runPreflightChecks(options);

      const outcome = await runChains(plan, options, cleanEnv);

      printSummary(outcome.results);

      writeJsonReport(outcome.results, options);

      exitFromOutcome(outcome);
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(ExitCode.CONFIGURATION_ERROR);
    }
  });
