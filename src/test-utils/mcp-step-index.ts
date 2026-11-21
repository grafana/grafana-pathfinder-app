import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { mockStepIndexFetch } from './step-index-fixtures';
import { __resetRepositoryClientForTests } from '../cli/utils/repository-client';
import { __resetStepIndexForTests, getStepIndex } from '../cli/utils/step-index/cache';

/** A selector in the step-index fixture, so a test can rely on it being verified. */
export const VERIFIED_SELECTOR = '[data-testid="install-quickpizza"], [data-testid="view-quickpizza"]';

/**
 * Serves the step index from the fixture for every test in the calling suite and holds it before the test body
 * runs, so the real `getVerifiedSelectors` answers from it and nothing reaches the network.
 */
export function useStepIndexFixture(): void {
  const originalFetch = global.fetch;
  const originalCache = process.env.XDG_CACHE_HOME;
  let cacheRoot: string;

  beforeEach(async () => {
    cacheRoot = mkdtempSync(join(tmpdir(), 'mcp-step-index-'));
    process.env.XDG_CACHE_HOME = cacheRoot;
    global.fetch = mockStepIndexFetch() as unknown as typeof fetch;
    __resetRepositoryClientForTests();
    __resetStepIndexForTests();
    await getStepIndex();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalCache === undefined) {
      delete process.env.XDG_CACHE_HOME;
    } else {
      process.env.XDG_CACHE_HOME = originalCache;
    }
    __resetRepositoryClientForTests();
    __resetStepIndexForTests();
    rmSync(cacheRoot, { recursive: true, force: true });
  });
}
