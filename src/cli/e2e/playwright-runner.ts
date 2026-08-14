/**
 * Spawns the Playwright guide runner for a single guide and parses the temp
 * files it writes back (abort reason, step results) into a PlaywrightResult.
 */

import { spawn } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { tmpdir } from 'os';

import { ExitCode } from './exit-codes';
import { E2E_ENV, encodeEnvFlag } from './e2e-runner-contract';
import type { LoadedGuide } from '../utils/file-loader';
import { E2EErrorCodeSchema, type E2EErrorCode } from './schemas/e2e-report.schema';
import { contentDigest, createMinimalResultsData, type TestResultsData } from './e2e-reporter';
import { resolveStartingPath } from './starting-location';
import { createProcessWatchdog } from './process-watchdog';

export { resolveStartingUrl } from './starting-location';

const PLAYWRIGHT_CONFIG_PATH = join('tests', 'e2e-runner', 'playwright.config.ts');
const GUIDE_RUNNER_SPEC_PATH = join('tests', 'e2e-runner', 'guide-runner.spec.ts');

function tryFindRunnerRoot(startDir: string): string | undefined {
  let candidate = resolve(startDir);

  while (true) {
    if (
      existsSync(join(candidate, PLAYWRIGHT_CONFIG_PATH)) &&
      existsSync(join(candidate, GUIDE_RUNNER_SPEC_PATH)) &&
      existsSync(join(candidate, 'package.json'))
    ) {
      return candidate;
    }

    const parent = dirname(candidate);
    if (parent === candidate) {
      return undefined;
    }
    candidate = parent;
  }
}

export function findRunnerRoot(startDir: string): string {
  const fromStart = tryFindRunnerRoot(startDir);
  if (fromStart !== undefined) {
    return fromStart;
  }

  const cwd = process.cwd();
  const fromCwd = tryFindRunnerRoot(cwd);
  if (fromCwd !== undefined) {
    return fromCwd;
  }

  throw new Error(
    `Could not locate the E2E runner root. Searched from '${startDir}' and cwd '${cwd}'. ` +
      `Ensure the directory containing '${PLAYWRIGHT_CONFIG_PATH}' and '${GUIDE_RUNNER_SPEC_PATH}' is reachable.`
  );
}

/**
 * Abort reason from test execution.
 * Written to abort file by test, read by CLI to determine exit code.
 */
export type AbortReason = 'AUTH_EXPIRED' | 'MANDATORY_FAILURE';

/**
 * Abort file content structure.
 */
interface GuideAbortFileContent {
  abortReason: AbortReason;
  message: string;
}

interface TerminalFileContent {
  errorCode: E2EErrorCode;
  message: string;
}

type AbortFileContent = GuideAbortFileContent | TerminalFileContent;

function isAbortFileContent(value: unknown): value is AbortFileContent {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.message !== 'string') {
    return false;
  }
  if (candidate.abortReason === 'AUTH_EXPIRED' || candidate.abortReason === 'MANDATORY_FAILURE') {
    return true;
  }
  return E2EErrorCodeSchema.safeParse(candidate.errorCode).success;
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
  errorCode?: E2EErrorCode;
  /** Test results data for JSON report generation */
  resultsData?: TestResultsData;
}

/**
 * Options the guide runner needs from the CLI. A narrow subset of the e2e
 * command options so the runner does not depend on the whole command surface.
 */
export interface RunGuideOptions {
  /** Resolved Grafana base URL this guide is tested against. */
  targetUrl: string;
  startingLocation: string;
  verbose: boolean;
  trace: boolean;
  headed: boolean;
  artifacts: string;
  alwaysScreenshot: boolean;
  /** Minted short-lived token for a provisioned cloud target. Absent for form-login runs. */
  token?: string;
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
export function processPlaywrightResults(
  exitCode: number,
  options: { trace: boolean },
  filePaths: { abortFilePath: string; resultsFilePath: string; traceOutputFilePath: string }
): PlaywrightResult {
  const playwrightExitCode = exitCode;

  // Trace location is reported by the runner (see e2e-runner-contract) so the
  // CLI never hardcodes Playwright's per-test output-dir naming.
  const traceFile = options.trace ? readFileIfExists(filePaths.traceOutputFilePath)?.trim() || undefined : undefined;

  const resultsData = readJsonIfExists<TestResultsData>(filePaths.resultsFilePath);
  const success = playwrightExitCode === 0 && (!resultsData?.outcome || resultsData.outcome === 'passed');

  // An abort file means the runner stopped early (e.g. session expiry).
  const abortValue = readJsonIfExists<unknown>(filePaths.abortFilePath);
  const abortContent = isAbortFileContent(abortValue) ? abortValue : undefined;
  if (abortContent) {
    if ('errorCode' in abortContent) {
      return {
        success: false,
        exitCode: ExitCode.TEST_FAILURE,
        traceFile,
        abortMessage: abortContent.message,
        errorCode: abortContent.errorCode,
        resultsData,
      };
    }
    const abortExitCode = abortContent.abortReason === 'AUTH_EXPIRED' ? ExitCode.AUTH_FAILURE : ExitCode.TEST_FAILURE;

    return {
      success: false,
      exitCode: abortExitCode,
      traceFile,
      abortReason: abortContent.abortReason,
      abortMessage: abortContent.message,
      errorCode: abortContent.abortReason,
      resultsData,
    };
  }

  if (!resultsData) {
    return {
      success: false,
      exitCode: ExitCode.TEST_FAILURE,
      traceFile,
      errorCode: 'REPORT_MISSING' as const,
    };
  }

  return {
    success,
    exitCode: success ? ExitCode.SUCCESS : ExitCode.TEST_FAILURE,
    traceFile,
    errorCode: resultsData.errorCode,
    resultsData,
  };
}

export async function runPlaywrightTests(guide: LoadedGuide, options: RunGuideOptions): Promise<PlaywrightResult> {
  const runnerRoot = findRunnerRoot(__dirname);
  const artifactsDir = resolve(process.cwd(), options.artifacts);
  const tempDir = mkdtempSync(join(tmpdir(), 'pathfinder-e2e-'));
  const guidePath = join(tempDir, 'guide.json');
  const abortFilePath = join(tempDir, 'abort.json');
  const resultsFilePath = join(tempDir, 'results.json');
  const authStateFile = join(tempDir, 'auth.json');
  const traceOutputFilePath = join(tempDir, 'trace-path.txt');
  const deadlineFilePath = join(tempDir, 'deadline.json');
  const playwrightOutputDir = join(artifactsDir, `playwright-${basename(tempDir)}`);
  const traceEnabled = options.trace && !options.token;
  let preserveDiagnostics = false;

  try {
    const startingPath = resolveStartingPath(options.targetUrl, options.startingLocation);
    writeFileSync(guidePath, guide.content);

    if (options.verbose) {
      console.log(`   📄 Temp guide file: ${guidePath}`);
    }

    const playwrightArgs = [
      'playwright',
      'test',
      join(runnerRoot, GUIDE_RUNNER_SPEC_PATH),
      `--config=${join(runnerRoot, PLAYWRIGHT_CONFIG_PATH)}`,
      '--project=chromium',
      `--output=${playwrightOutputDir}`,
    ];

    if (options.trace && options.token) {
      console.warn('   ⚠ Trace disabled for bearer-token authentication because traces can contain credentials');
    }
    if (traceEnabled) {
      playwrightArgs.push('--trace', 'on');
    }

    if (options.headed) {
      playwrightArgs.push('--headed');
    }

    const result = await new Promise<PlaywrightResult>((resolve) => {
      let settled = false;
      let watchdogExpired = false;
      let watchdog: ReturnType<typeof createProcessWatchdog> | undefined;
      const settle = (value: PlaywrightResult) => {
        if (settled) {
          return;
        }
        settled = true;
        watchdog?.stop();
        resolve(value);
      };
      const runnerTimeout = (): PlaywrightResult => ({
        success: false,
        exitCode: ExitCode.TEST_FAILURE,
        traceFile: traceEnabled ? readFileIfExists(traceOutputFilePath)?.trim() || undefined : undefined,
        errorCode: 'RUNNER_TIMEOUT',
        abortMessage: 'The Playwright child exceeded its runner deadline.',
      });
      const containmentFailure = (message: string): PlaywrightResult => ({
        success: false,
        exitCode: ExitCode.TEST_FAILURE,
        traceFile: traceEnabled ? readFileIfExists(traceOutputFilePath)?.trim() || undefined : undefined,
        errorCode: 'RUNNER_CONTAINMENT_FAILED',
        abortMessage: message,
      });
      const proc = spawn('npx', playwrightArgs, {
        cwd: runnerRoot,
        detached: process.platform !== 'win32',
        env: {
          ...process.env,
          [E2E_ENV.GUIDE_JSON_PATH]: guidePath,
          [E2E_ENV.GRAFANA_URL]: options.targetUrl,
          [E2E_ENV.STARTING_LOCATION]: startingPath,
          [E2E_ENV.AUTH_STATE_FILE]: authStateFile,
          ...(options.token ? { [E2E_ENV.GRAFANA_TOKEN]: options.token } : {}),
          [E2E_ENV.TRACE]: encodeEnvFlag(traceEnabled),
          [E2E_ENV.VERBOSE]: encodeEnvFlag(options.verbose),
          [E2E_ENV.ABORT_FILE_PATH]: abortFilePath,
          [E2E_ENV.RESULTS_FILE_PATH]: resultsFilePath,
          [E2E_ENV.ARTIFACTS_DIR]: artifactsDir,
          [E2E_ENV.ALWAYS_SCREENSHOT]: encodeEnvFlag(options.alwaysScreenshot),
          [E2E_ENV.TRACE_OUTPUT_FILE]: traceOutputFilePath,
          [E2E_ENV.DEADLINE_FILE_PATH]: deadlineFilePath,
          PLAYWRIGHT_HTML_OPEN: 'never',
        },
        stdio: 'inherit',
      });
      watchdog = createProcessWatchdog(proc, {
        deadlineFilePath,
        onExpire: () => {
          watchdogExpired = true;
          console.error('Playwright runner deadline expired; requesting child termination.');
        },
        onContained: () => settle(runnerTimeout()),
        onContainmentFailure: (message) => {
          preserveDiagnostics = true;
          settle(containmentFailure(message));
        },
      });

      proc.on('close', (code) => {
        if (watchdogExpired) {
          return;
        }
        const result = processPlaywrightResults(
          code ?? 1,
          { trace: traceEnabled },
          {
            abortFilePath,
            resultsFilePath,
            traceOutputFilePath,
          }
        );
        settle(result);
      });

      proc.on('error', (err) => {
        if (watchdogExpired) {
          return;
        }
        console.error(`Failed to spawn Playwright: ${err.message}`);
        settle({
          success: false,
          exitCode: ExitCode.CONFIGURATION_ERROR,
          errorCode: 'PLAYWRIGHT_SPAWN_FAILED',
          abortMessage: `Failed to spawn Playwright: ${err.message}`,
        });
      });
    });

    if (!result.resultsData) {
      let guideId =
        guide.path
          .split('/')
          .pop()
          ?.replace(/\.json$/, '') ?? 'unknown';
      let guideTitle = guideId;
      try {
        const parsed = JSON.parse(guide.content) as { id?: unknown; title?: unknown };
        if (typeof parsed.id === 'string' && parsed.id) {
          guideId = parsed.id;
        }
        if (typeof parsed.title === 'string' && parsed.title) {
          guideTitle = parsed.title;
        }
      } catch {
        // Malformed guide content; path-derived id remains valid.
      }
      const outcome =
        result.abortReason === 'AUTH_EXPIRED'
          ? 'aborted'
          : result.abortReason === 'MANDATORY_FAILURE'
            ? 'failed'
            : result.errorCode === 'STEP_TIMEOUT'
              ? 'failed'
              : 'infrastructure_error';
      result.resultsData = createMinimalResultsData({
        guide: {
          id: guideId,
          title: guideTitle,
          path: guide.path,
          targetUrl: options.targetUrl,
          contentDigest: contentDigest(guide.content),
        },
        outcome,
        errorCode: result.errorCode ?? 'REPORT_MISSING',
        errorMessage: result.abortMessage ?? 'Playwright did not produce a result report.',
        abortReason: result.abortReason,
      });
    }
    return result;
  } finally {
    if (!traceEnabled && !preserveDiagnostics) {
      try {
        rmSync(playwrightOutputDir, { recursive: true, force: true });
      } catch {
        console.warn(`Warning: Failed to clean up Playwright output directory: ${playwrightOutputDir}`);
      }
    }
    if (preserveDiagnostics) {
      console.warn(`Preserved runner diagnostics after containment failure: ${tempDir}`);
      console.warn(`Preserved Playwright output after containment failure: ${playwrightOutputDir}`);
    } else {
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
}
