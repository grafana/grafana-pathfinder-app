/** @jest-environment node */

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

import { findRunnerRoot, runPlaywrightTests } from './playwright-runner';

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
