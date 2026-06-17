/**
 * Spawns the Playwright guide runner for a single guide and parses the temp
 * files it writes back (abort reason, step results) into a PlaywrightResult.
 */

import { spawn } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { ExitCode } from './exit-codes';
import type { LoadedGuide } from './file-loader';
import type { TestResultsData } from './e2e-reporter';

/**
 * Abort reason from test execution (L3-3D).
 * Written to abort file by test, read by CLI to determine exit code.
 */
export type AbortReason = 'AUTH_EXPIRED' | 'MANDATORY_FAILURE';

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
export interface PlaywrightResult {
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
 * Options the guide runner needs from the CLI. A narrow subset of the e2e
 * command options so the runner does not depend on the whole command surface.
 */
export interface RunGuideOptions {
  grafanaUrl: string;
  verbose: boolean;
  trace: boolean;
  headed: boolean;
  artifacts: string;
  alwaysScreenshot: boolean;
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
export async function runPlaywrightTests(guide: LoadedGuide, options: RunGuideOptions): Promise<PlaywrightResult> {
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
