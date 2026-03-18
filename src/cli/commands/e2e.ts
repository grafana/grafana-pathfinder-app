/**
 * E2E Test Command
 *
 * Run E2E tests on JSON guide files. Spawns Playwright to inject guides
 * into localStorage and verify they load correctly in the docs panel.
 */

import { spawn } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { Command, Option } from 'commander';

import { validateGuideFromString, toLegacyResult } from '../../validation';
import { loadGuideFiles, loadBundledGuides, type LoadedGuide } from '../utils/file-loader';
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
import type { ManifestJson } from '../../types/package.types';

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
}

/**
 * Exit codes per design spec
 */
export const ExitCode = {
  SUCCESS: 0,
  TEST_FAILURE: 1,
  CONFIGURATION_ERROR: 2,
  GRAFANA_UNREACHABLE: 3,
  AUTH_FAILURE: 4,
} as const;

/**
 * Result of CLI-level pre-flight check (Grafana health)
 */
interface CliPreflightResult {
  passed: boolean;
  error?: string;
  durationMs: number;
  /** Grafana version from /api/health — passed to manifest pre-flight to avoid a duplicate fetch. */
  version?: string;
}

/**
 * Check if Grafana is reachable and healthy.
 *
 * This is a public endpoint that doesn't require authentication,
 * so it can be called from the CLI before spawning Playwright.
 */
async function checkGrafanaHealth(grafanaUrl: string): Promise<CliPreflightResult> {
  const startTime = Date.now();

  try {
    const healthUrl = new URL('/api/health', grafanaUrl).toString();
    const response = await fetch(healthUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      // Short timeout for health check
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return {
        passed: false,
        error: `Grafana health check failed: HTTP ${response.status} ${response.statusText}`,
        durationMs: Date.now() - startTime,
      };
    }

    const data = (await response.json()) as { database?: string; version?: string };

    // Verify database is healthy
    if (data.database !== 'ok') {
      return {
        passed: false,
        error: `Grafana database not healthy: ${data.database ?? 'unknown'}`,
        durationMs: Date.now() - startTime,
      };
    }

    return {
      passed: true,
      durationMs: Date.now() - startTime,
      version: data.version,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.name === 'TimeoutError'
          ? `Connection timeout after 10s`
          : error.message
        : 'Unknown error';

    return {
      passed: false,
      error: `Grafana not reachable at ${grafanaUrl}: ${errorMessage}`,
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Abort reason from test execution (L3-3D).
 * Written to abort file by test, read by CLI to determine exit code.
 */
type AbortReason = 'AUTH_EXPIRED' | 'MANDATORY_FAILURE';

/**
 * Abort file content structure (L3-3D).
 */
interface AbortFileContent {
  abortReason: AbortReason;
  message: string;
}

/**
 * Result of running Playwright tests on a guide
 */
interface PlaywrightResult {
  success: boolean;
  exitCode: number;
  traceFile?: string;
  /** Abort reason if test was aborted (L3-3D) */
  abortReason?: AbortReason;
  /** Abort message if test was aborted (L3-3D) */
  abortMessage?: string;
  /** Test results data for JSON report generation (L3-5B) */
  resultsData?: TestResultsData;
}

/**
 * Read abort file content if it exists (L3-3D).
 * Returns undefined if file doesn't exist or is invalid.
 */
function readAbortFile(abortFilePath: string): AbortFileContent | undefined {
  try {
    if (!existsSync(abortFilePath)) {
      return undefined;
    }
    const content = readFileSync(abortFilePath, 'utf-8');
    return JSON.parse(content) as AbortFileContent;
  } catch {
    return undefined;
  }
}

/**
 * Read test results file if it exists (L3-5B).
 * Returns undefined if file doesn't exist or is invalid.
 */
function readResultsFile(resultsFilePath: string): TestResultsData | undefined {
  try {
    if (!existsSync(resultsFilePath)) {
      return undefined;
    }
    const content = readFileSync(resultsFilePath, 'utf-8');
    return JSON.parse(content) as TestResultsData;
  } catch {
    return undefined;
  }
}

/**
 * Process Playwright test results from temp files.
 * Reads abort file and results file to determine final outcome.
 *
 * @param exitCode - The Playwright process exit code
 * @param options - Options object with trace flag
 * @param filePaths - Paths to abort and results files
 * @returns PlaywrightResult with success status, exit code, and optional data
 */
function processPlaywrightResults(
  exitCode: number,
  options: { trace: boolean },
  filePaths: { abortFilePath: string; resultsFilePath: string }
): PlaywrightResult {
  const playwrightExitCode = exitCode;
  const success = playwrightExitCode === 0;

  // Build trace file path if tracing enabled
  let traceFile: string | undefined;
  if (options.trace) {
    // Playwright stores traces in test-results/ directory
    traceFile = 'test-results/guide-runner-loads-and-displays-guide-from-JSON-chromium/trace.zip';
  }

  // L3-5B: Read results file for JSON reporting
  const resultsData = readResultsFile(filePaths.resultsFilePath);

  // L3-3D: Check abort file for session expiry
  const abortContent = readAbortFile(filePaths.abortFilePath);
  if (abortContent) {
    // Determine exit code based on abort reason
    const abortExitCode = abortContent.abortReason === 'AUTH_EXPIRED' ? ExitCode.AUTH_FAILURE : ExitCode.TEST_FAILURE;

    return {
      success: false,
      exitCode: abortExitCode,
      traceFile,
      abortReason: abortContent.abortReason,
      abortMessage: abortContent.message,
      resultsData,
    };
  }

  return {
    success,
    exitCode: success ? ExitCode.SUCCESS : ExitCode.TEST_FAILURE,
    traceFile,
    resultsData,
  };
}

/**
 * Spawn Playwright to test a guide.
 * Writes guide JSON to temp file, spawns Playwright with environment variables,
 * and cleans up temp file after completion.
 *
 * Session validation (L3-3D):
 * - Creates abort file path for test to write abort reason
 * - Reads abort file after test completes to determine exit code
 * - Returns AUTH_EXPIRED abort reason if session expired
 *
 * JSON reporting (L3-5B):
 * - Creates results file path for test to write step results
 * - Reads results file after test completes
 * - Returns results data for JSON report generation
 */
async function runPlaywrightTests(guide: LoadedGuide, options: E2ECommandOptions): Promise<PlaywrightResult> {
  // Write guide to temp file
  const tempDir = mkdtempSync(join(tmpdir(), 'pathfinder-e2e-'));
  const guidePath = join(tempDir, 'guide.json');
  // L3-3D: Create abort file path for session validation
  const abortFilePath = join(tempDir, 'abort.json');
  // L3-5B: Create results file path for JSON reporting
  const resultsFilePath = join(tempDir, 'results.json');

  try {
    writeFileSync(guidePath, guide.content);

    if (options.verbose) {
      console.log(`   📄 Temp guide file: ${guidePath}`);
    }

    // Build Playwright arguments
    // Use the dedicated e2e-runner config (main config has testIgnore for e2e-runner)
    const playwrightArgs = [
      'playwright',
      'test',
      'tests/e2e-runner/guide-runner.spec.ts',
      '--config=tests/e2e-runner/playwright.config.ts',
      '--project=chromium',
    ];

    if (options.trace) {
      playwrightArgs.push('--trace', 'on');
    }

    if (options.headed) {
      playwrightArgs.push('--headed');
    }

    // Spawn Playwright with environment variables
    // Note: shell: false for security (avoids argument escaping issues)
    const result = await new Promise<PlaywrightResult>((resolve) => {
      const proc = spawn('npx', playwrightArgs, {
        env: {
          ...process.env,
          GUIDE_JSON_PATH: guidePath,
          GRAFANA_URL: options.grafanaUrl,
          E2E_TRACE: options.trace ? 'true' : 'false',
          E2E_VERBOSE: options.verbose ? 'true' : 'false',
          // L3-3D: Pass abort file path for session validation
          ABORT_FILE_PATH: abortFilePath,
          // L3-5B: Pass results file path for JSON reporting
          RESULTS_FILE_PATH: resultsFilePath,
          // L3-5D: Pass artifacts directory for artifact collection
          ARTIFACTS_DIR: options.artifacts,
          // Capture screenshots on success and failure
          ALWAYS_SCREENSHOT: options.alwaysScreenshot ? 'true' : 'false',
          // Prevent Playwright from auto-opening HTML report server in CLI mode
          PLAYWRIGHT_HTML_OPEN: 'never',
        },
        stdio: 'inherit',
      });

      proc.on('close', (code) => {
        const result = processPlaywrightResults(
          code ?? 1,
          { trace: options.trace },
          { abortFilePath, resultsFilePath }
        );
        resolve(result);
      });

      proc.on('error', (err) => {
        console.error(`Failed to spawn Playwright: ${err.message}`);
        resolve({ success: false, exitCode: ExitCode.CONFIGURATION_ERROR });
      });
    });

    return result;
  } finally {
    // Clean up temp directory
    try {
      rmSync(tempDir, { recursive: true, force: true });
      if (options.verbose) {
        console.log(`   🗑️  Cleaned up temp directory: ${tempDir}`);
      }
    } catch (cleanupError) {
      console.warn(`Warning: Failed to clean up temp directory: ${tempDir}`);
    }
  }
}

/**
 * Validate all loaded guides and return any validation errors.
 */
function validateAllGuides(
  guides: LoadedGuide[],
  options: E2ECommandOptions
): { valid: LoadedGuide[]; errors: Array<{ file: string; errors: string[] }> } {
  const valid: LoadedGuide[] = [];
  const errors: Array<{ file: string; errors: string[] }> = [];

  for (const guide of guides) {
    const result = validateGuideFromString(guide.content);
    const legacy = toLegacyResult(result);

    if (result.isValid) {
      valid.push(guide);
      if (options.verbose && result.warnings.length > 0) {
        console.log(`⚠️  ${guide.path}: ${result.warnings.length} warning(s)`);
      }
    } else {
      errors.push({ file: guide.path, errors: legacy.errors });
    }
  }

  return { valid, errors };
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

// Generate unique run ID for default artifacts path
const defaultArtifactsDir = `/tmp/pathfinder-e2e-${randomUUID().slice(0, 8)}`;

export const e2eCommand = new Command('e2e')
  .description('Run E2E tests on JSON guide files')
  .arguments('[files...]')
  .option('--grafana-url <url>', 'Grafana instance URL', 'http://localhost:3000')
  .option('--output <path>', 'Path for JSON report output')
  .option('--artifacts <dir>', 'Directory for artifacts', defaultArtifactsDir)
  .option('--verbose', 'Enable verbose logging', false)
  .option('--bundled', 'Test all bundled guides')
  .option('--package <dir>', 'Load content.json from a package directory; reads manifest.json for pre-flight checks')
  .addOption(new Option('--tier <tier>', 'Current test environment tier').choices(['local', 'cloud']).default('local'))
  .option('--trace', 'Generate Playwright trace file', false)
  .option('--headed', 'Run browser in headed mode (visible)', false)
  .option('--always-screenshot', 'Capture screenshots on success and failure', false)
  .action(async (files: string[], options: E2ECommandOptions) => {
    try {
      // Resolve guides from inputs
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

      // Validate all guides
      const { valid, errors } = validateAllGuides(guides, options);

      // Report validation errors
      if (errors.length > 0) {
        console.error('\n❌ Guide validation failed:\n');
        for (const { file, errors: fileErrors } of errors) {
          console.error(`  ${file}:`);
          for (const error of fileErrors) {
            console.error(`    - ${error}`);
          }
          console.error();
        }
        process.exit(ExitCode.CONFIGURATION_ERROR);
      }

      // All guides valid - print success and configuration
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

      // Run CLI-level pre-flight checks
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

      // Run Playwright tests for each guide
      console.log('\n🎭 Running Playwright tests...\n');

      let allPassed = true;
      let hasAuthExpiry = false;
      const results: Array<{
        guide: string;
        success: boolean;
        exitCode: number;
        traceFile?: string;
        abortReason?: AbortReason;
        abortMessage?: string;
        resultsData?: TestResultsData;
      }> = [];

      for (const guide of valid) {
        console.log(`\n📚 Testing: ${guide.path}`);

        const result = await runPlaywrightTests(guide, options);
        results.push({
          guide: guide.path,
          success: result.success,
          exitCode: result.exitCode,
          traceFile: result.traceFile,
          abortReason: result.abortReason,
          abortMessage: result.abortMessage,
          resultsData: result.resultsData,
        });

        if (!result.success) {
          allPassed = false;

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

      // Collect results data for reporting
      const resultsWithData = results.filter((r) => r.resultsData).map((r) => r.resultsData!);
      const isMultiGuide = valid.length > 1;

      // Print summary
      console.log('\n' + '─'.repeat(68));
      console.log('📊 Summary');
      console.log('─'.repeat(68));

      if (isMultiGuide) {
        // Multi-guide summary (L3-7B)
        const passedGuides = results.filter((r) => r.success).length;
        const failedGuides = results.filter((r) => !r.success && r.abortReason !== 'AUTH_EXPIRED').length;
        const authExpired = results.filter((r) => r.abortReason === 'AUTH_EXPIRED').length;

        console.log(`\n   Guides: ${passedGuides}/${valid.length} passed`);
        if (failedGuides > 0) {
          console.log(`   ├─ ❌ Failed: ${failedGuides}`);
        }
        if (authExpired > 0) {
          console.log(`   └─ 🔐 Auth expired: ${authExpired}`);
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
          const status = result.success ? '✅' : result.abortReason === 'AUTH_EXPIRED' ? '🔐' : '❌';
          const guideName = result.guide.split('/').pop()?.replace('.json', '') ?? result.guide;
          const reason = result.abortReason === 'AUTH_EXPIRED' ? ' (auth expired)' : '';
          console.log(`   ${status} ${guideName}${reason}`);
        }
      } else {
        // Single guide summary
        const passed = results.filter((r) => r.success).length;
        const failed = results.filter((r) => !r.success).length;
        const authExpired = results.filter((r) => r.abortReason === 'AUTH_EXPIRED').length;

        if (passed > 0) {
          console.log(`   ✅ Passed: ${passed}`);
        }
        if (failed > 0) {
          console.log(`   ❌ Failed: ${failed}`);
        }
        if (authExpired > 0) {
          console.log(`   🔐 Auth expired: ${authExpired}`);
        }
      }

      console.log('\n' + '─'.repeat(68));

      // L3-5B/L3-7B: Generate JSON report if --output was specified
      if (options.output) {
        if (resultsWithData.length === 0) {
          console.warn(`   ⚠ No test results available for JSON report`);
        } else if (isMultiGuide) {
          // L3-7B: Generate multi-guide aggregated report
          try {
            const report = generateMultiGuideReport(resultsWithData, options.grafanaUrl);
            writeMultiGuideReport(report, options.output);
            console.log(`\n📄 Multi-guide JSON report written to: ${options.output}`);
            console.log(`   ${formatMultiGuideSummary(report)}`);
          } catch (err) {
            console.warn(`   ⚠ Failed to write JSON report: ${err instanceof Error ? err.message : 'Unknown error'}`);
          }
        } else {
          // Single guide: write detailed report
          try {
            const report = generateReport(resultsWithData[0]!);
            writeReport(report, options.output);
            console.log(`\n📄 JSON report written to: ${options.output}`);
          } catch (err) {
            console.warn(`   ⚠ Failed to write JSON report: ${err instanceof Error ? err.message : 'Unknown error'}`);
          }
        }
      }

      if (!allPassed) {
        // L3-3D: Use exit code 4 for auth expiry
        if (hasAuthExpiry) {
          process.exit(ExitCode.AUTH_FAILURE);
        }
        process.exit(ExitCode.TEST_FAILURE);
      }
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(ExitCode.CONFIGURATION_ERROR);
    }
  });
