/**
 * Spawns the Playwright guide runner for a single guide and parses the temp
 * files it writes back (abort reason, step results) into a PlaywrightResult.
 */

import { spawn } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { ExitCode } from './exit-codes';
import { E2E_ENV, encodeEnvFlag } from './e2e-runner-contract';
import type { LoadedGuide } from './file-loader';
import type { TestResultsData } from './e2e-reporter';

/**
 * Abort reason from test execution.
 * Written to abort file by test, read by CLI to determine exit code.
 */
export type AbortReason = 'AUTH_EXPIRED' | 'MANDATORY_FAILURE';

/**
 * Abort file content structure.
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
  /** Abort reason if test was aborted */
  abortReason?: AbortReason;
  /** Abort message if test was aborted */
  abortMessage?: string;
  /** Test results data for JSON report generation */
  resultsData?: TestResultsData;
}

/**
 * Options the guide runner needs from the CLI. A narrow subset of the e2e
 * command options so the runner does not depend on the whole command surface.
 */
export interface RunGuideOptions {
  /** Resolved base URL this guide is tested against. */
  targetUrl: string;
  verbose: boolean;
  trace: boolean;
  headed: boolean;
  artifacts: string;
  alwaysScreenshot: boolean;
}

/**
 * Read a file's text if it exists and is readable; undefined otherwise.
 */
function readFileIfExists(filePath: string): string | undefined {
  try {
    if (!existsSync(filePath)) {
      return undefined;
    }
    return readFileSync(filePath, 'utf-8');
  } catch {
    return undefined;
  }
}

/**
 * Parse a JSON file's contents if it exists and is valid JSON; undefined otherwise.
 */
function readJsonIfExists<T>(filePath: string): T | undefined {
  const content = readFileIfExists(filePath);
  if (content === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(content) as T;
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
  filePaths: { abortFilePath: string; resultsFilePath: string; traceOutputFilePath: string }
): PlaywrightResult {
  const playwrightExitCode = exitCode;
  const success = playwrightExitCode === 0;

  // Trace location is reported by the runner (see e2e-runner-contract) so the
  // CLI never hardcodes Playwright's per-test output-dir naming.
  const traceFile = options.trace ? readFileIfExists(filePaths.traceOutputFilePath)?.trim() || undefined : undefined;

  const resultsData = readJsonIfExists<TestResultsData>(filePaths.resultsFilePath);

  // An abort file means the runner stopped early (e.g. session expiry).
  const abortContent = readJsonIfExists<AbortFileContent>(filePaths.abortFilePath);
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
 * Session validation:
 * - Creates abort file path for test to write abort reason
 * - Reads abort file after test completes to determine exit code
 * - Returns AUTH_EXPIRED abort reason if session expired
 *
 * JSON reporting:
 * - Creates results file path for test to write step results
 * - Reads results file after test completes
 * - Returns results data for JSON report generation
 */
export async function runPlaywrightTests(guide: LoadedGuide, options: RunGuideOptions): Promise<PlaywrightResult> {
  // Write guide to temp file
  const tempDir = mkdtempSync(join(tmpdir(), 'pathfinder-e2e-'));
  const guidePath = join(tempDir, 'guide.json');
  // Abort file path for session validation
  const abortFilePath = join(tempDir, 'abort.json');
  // Results file path for JSON reporting
  const resultsFilePath = join(tempDir, 'results.json');
  // Path the runner records the produced trace location to (see e2e-runner-contract).
  const traceOutputFilePath = join(tempDir, 'trace-path.txt');

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
          [E2E_ENV.GUIDE_JSON_PATH]: guidePath,
          [E2E_ENV.GRAFANA_URL]: options.targetUrl,
          [E2E_ENV.TRACE]: encodeEnvFlag(options.trace),
          [E2E_ENV.VERBOSE]: encodeEnvFlag(options.verbose),
          [E2E_ENV.ABORT_FILE_PATH]: abortFilePath,
          [E2E_ENV.RESULTS_FILE_PATH]: resultsFilePath,
          [E2E_ENV.ARTIFACTS_DIR]: options.artifacts,
          [E2E_ENV.ALWAYS_SCREENSHOT]: encodeEnvFlag(options.alwaysScreenshot),
          [E2E_ENV.TRACE_OUTPUT_FILE]: traceOutputFilePath,
          // Prevent Playwright from auto-opening HTML report server in CLI mode
          PLAYWRIGHT_HTML_OPEN: 'never',
        },
        stdio: 'inherit',
      });

      proc.on('close', (code) => {
        const result = processPlaywrightResults(
          code ?? 1,
          { trace: options.trace },
          {
            abortFilePath,
            resultsFilePath,
            traceOutputFilePath,
          }
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
