/** @jest-environment node */

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

import { ExitCode } from './exit-codes';
import { findRunnerRoot, processPlaywrightResults, runPlaywrightTests } from './playwright-runner';

jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

const spawnMock = spawn as jest.MockedFunction<typeof spawn>;

describe('findRunnerRoot', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'pathfinder-runner-root-'));
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('finds the runner root from the compiled CLI layout', () => {
    const compiledModuleDir = join(tempRoot, 'dist', 'cli', 'cli', 'e2e');
    const runnerTestDir = join(tempRoot, 'tests', 'e2e-runner');
    mkdirSync(compiledModuleDir, { recursive: true });
    mkdirSync(runnerTestDir, { recursive: true });
    writeFileSync(join(tempRoot, 'package.json'), '{}');
    writeFileSync(join(runnerTestDir, 'playwright.config.ts'), '');
    writeFileSync(join(runnerTestDir, 'guide-runner.spec.ts'), '');

    expect(findRunnerRoot(compiledModuleDir)).toBe(tempRoot);
  });
});

describe('processPlaywrightResults', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'pathfinder-results-'));
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  function filePaths() {
    return {
      abortFilePath: join(tempRoot, 'abort.json'),
      resultsFilePath: join(tempRoot, 'results.json'),
      traceOutputFilePath: join(tempRoot, 'trace-path.txt'),
    };
  }

  it('maps an AUTH_EXPIRED abort to the authentication failure exit code', () => {
    const paths = filePaths();
    writeFileSync(paths.abortFilePath, JSON.stringify({ abortReason: 'AUTH_EXPIRED', message: 'Session expired' }));

    expect(processPlaywrightResults(1, { trace: false }, paths)).toMatchObject({
      success: false,
      exitCode: ExitCode.AUTH_FAILURE,
      abortReason: 'AUTH_EXPIRED',
      abortMessage: 'Session expired',
      errorCode: 'AUTH_EXPIRED',
    });
  });

  it('maps other valid abort reasons to the test failure exit code', () => {
    const paths = filePaths();
    writeFileSync(paths.abortFilePath, JSON.stringify({ abortReason: 'MANDATORY_FAILURE', message: 'Step failed' }));

    expect(processPlaywrightResults(1, { trace: false }, paths)).toMatchObject({
      success: false,
      exitCode: ExitCode.TEST_FAILURE,
      abortReason: 'MANDATORY_FAILURE',
      abortMessage: 'Step failed',
      errorCode: 'MANDATORY_FAILURE',
    });
  });

  it('reports a missing results file without throwing', () => {
    const paths = filePaths();

    expect(processPlaywrightResults(1, { trace: false }, paths)).toMatchObject({
      success: false,
      exitCode: ExitCode.TEST_FAILURE,
      errorCode: 'REPORT_MISSING',
    });
  });
  it('ignores structurally invalid abort metadata', () => {
    const paths = filePaths();
    writeFileSync(paths.abortFilePath, JSON.stringify({ abortReason: 'NOT_A_REAL_REASON' }));

    expect(processPlaywrightResults(1, { trace: false }, paths)).toMatchObject({
      success: false,
      exitCode: ExitCode.TEST_FAILURE,
      errorCode: 'REPORT_MISSING',
    });
  });

  it('ignores malformed abort metadata and falls back to the process result', () => {
    const paths = filePaths();
    writeFileSync(paths.abortFilePath, '{not-json');

    expect(processPlaywrightResults(1, { trace: false }, paths)).toMatchObject({
      success: false,
      exitCode: ExitCode.TEST_FAILURE,
      errorCode: 'REPORT_MISSING',
    });
  });

  it('returns the trace path only when trace collection is enabled', () => {
    const paths = filePaths();
    writeFileSync(paths.traceOutputFilePath, 'artifacts/trace.zip\n');

    expect(processPlaywrightResults(0, { trace: true }, paths).traceFile).toBe('artifacts/trace.zip');
    expect(processPlaywrightResults(0, { trace: false }, paths).traceFile).toBeUndefined();
  });
});

describe('runPlaywrightTests', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('runs Playwright from the installed runner root', async () => {
    const child = new EventEmitter();
    const runnerRoot = resolve(__dirname, '../../..');
    spawnMock.mockImplementation(() => child as never);

    const resultPromise = runPlaywrightTests(
      { path: 'fixture.json', content: '{}' },
      {
        targetUrl: 'http://localhost:3000',
        verbose: false,
        trace: false,
        headed: false,
        artifacts: 'artifacts',
        alwaysScreenshot: false,
      }
    );
    child.emit('close', 1);
    await resultPromise;

    expect(spawnMock).toHaveBeenCalledWith(
      'npx',
      [
        'playwright',
        'test',
        join(runnerRoot, 'tests/e2e-runner/guide-runner.spec.ts'),
        `--config=${join(runnerRoot, 'tests/e2e-runner/playwright.config.ts')}`,
        '--project=chromium',
      ],
      expect.objectContaining({
        cwd: runnerRoot,
      })
    );
  });
});
