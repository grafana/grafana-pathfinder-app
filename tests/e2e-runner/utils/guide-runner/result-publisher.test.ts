import { EventEmitter } from 'events';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { E2E_ENV } from '../../../../src/cli/e2e/e2e-runner-contract';
import { publishGuideResult } from './result-publisher';
import { arbitrateGuideWork, createGuideTerminationController } from './termination';

function createPage() {
  const browser = new EventEmitter();
  const context = new EventEmitter() as EventEmitter & { browser(): EventEmitter };
  context.browser = () => browser;
  const frame = { url: () => 'http://localhost:3000/' };
  const page = new EventEmitter() as EventEmitter & {
    close(): Promise<void>;
    context(): typeof context;
    mainFrame(): typeof frame;
    url(): string;
  };
  page.close = async () => undefined;
  page.context = () => context;
  page.mainFrame = () => frame;
  page.url = frame.url;
  return page;
}

describe('post-arbitration result publisher', () => {
  let tempDir: string;
  let previousResultsPath: string | undefined;
  let previousAbortPath: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'guide-result-publisher-'));
    previousResultsPath = process.env[E2E_ENV.RESULTS_FILE_PATH];
    previousAbortPath = process.env[E2E_ENV.ABORT_FILE_PATH];
    process.env[E2E_ENV.RESULTS_FILE_PATH] = join(tempDir, 'results.json');
    process.env[E2E_ENV.ABORT_FILE_PATH] = join(tempDir, 'abort.json');
  });

  afterEach(() => {
    if (previousResultsPath === undefined) {
      delete process.env[E2E_ENV.RESULTS_FILE_PATH];
    } else {
      process.env[E2E_ENV.RESULTS_FILE_PATH] = previousResultsPath;
    }
    if (previousAbortPath === undefined) {
      delete process.env[E2E_ENV.ABORT_FILE_PATH];
    } else {
      process.env[E2E_ENV.ABORT_FILE_PATH] = previousAbortPath;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('keeps terminal output after late normal work completes', async () => {
    const page = createPage();
    const controller = createGuideTerminationController(page as never);
    let finishWork!: (value: string) => void;
    const work = new Promise<string>((resolve) => {
      finishWork = resolve;
    });

    page.emit('crash');
    const arbitration = await arbitrateGuideWork(work, controller, () => page.close(), 1);
    expect(arbitration).toMatchObject({ kind: 'terminated', drained: false });
    if (arbitration.kind !== 'terminated') {
      throw new Error('Expected terminal arbitration');
    }
    publishGuideResult({
      results: [],
      guide: { id: 'guide', title: 'Guide', path: 'guide.json' },
      targetUrl: 'http://localhost:3000',
      startingLocation: '/',
      timestamp: '2026-01-01T00:00:00.000Z',
      allStepsResult: {
        results: [],
        aborted: true,
        outcome: arbitration.termination.outcome,
        errorCode: arbitration.termination.code,
        abortMessage: arbitration.termination.message,
      },
      guideContent: '{}',
      outcome: arbitration.termination.outcome,
    });
    const published = readFileSync(process.env[E2E_ENV.RESULTS_FILE_PATH]!, 'utf8');

    finishWork('passed');
    await work;

    expect(readFileSync(process.env[E2E_ENV.RESULTS_FILE_PATH]!, 'utf8')).toBe(published);
    expect(JSON.parse(published)).toMatchObject({
      outcome: 'infrastructure_error',
      errorCode: 'BROWSER_CRASHED',
    });
    controller.dispose();
  });
});
