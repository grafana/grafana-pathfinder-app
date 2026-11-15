/**
 * Bounded Bombadil pilot harness (issue #2420). Not a regression test: it is
 * run by hand, see docs/developer/BOMBADIL_PILOT.md.
 *
 * Playwright owns the browser so the existing completion stubs (`page.route`)
 * and the admin session apply, then Bombadil attaches to that same page over
 * CDP (`test-external`) and explores through the spec's custom actions only.
 */

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import { StorageKeys } from '../../src/lib/storage-keys';
import { testIds } from '../../src/constants/testIds';
import { ALL_FIXTURES, STANDALONE_GUIDE, fixtureContentUrl, type PackageFixture } from '../helpers/completion.fixtures';
import { startFixtureServers } from './fixture-servers';
import { faultInitScript, isFault } from './faults';

/** Async on purpose: the fixture servers and Playwright's own CDP pipe live in this process. */
function runBombadil(binary: string, args: string[]): Promise<{ status: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(binary, args);
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    const guard = setTimeout(() => child.kill('SIGTERM'), 10 * 60_000);
    child.on('close', (status) => {
      clearTimeout(guard);
      resolve({ status, output });
    });
  });
}

const ROOT = resolve(__dirname, '../..');
const GRAFANA_URL = process.env.GRAFANA_URL || 'http://localhost:3010';
const PROXY_PORT = Number(process.env.BOMBADIL_PROXY_PORT || '3011');
const CDN_PORT = Number(process.env.BOMBADIL_CDN_PORT || '3443');
const CDP_PORT = process.env.BOMBADIL_CDP_PORT || '9333';
const TIME_LIMIT = process.env.BOMBADIL_TIME_LIMIT || '90s';
const OUT = resolve(process.env.BOMBADIL_OUT || join(__dirname, 'out', `run-${Date.now()}`));
const REPLAY = process.env.BOMBADIL_REPLAY === '1';
const FAULT = process.env.BOMBADIL_FAULT;

const GUIDE_A: PackageFixture = { ...STANDALONE_GUIDE, id: 'bombadil-lifecycle-guide-a', title: 'Lifecycle guide A' };
const GUIDE_B: PackageFixture = { ...STANDALONE_GUIDE, id: 'bombadil-lifecycle-guide-b', title: 'Lifecycle guide B' };
const PREVIEW: PackageFixture = { ...STANDALONE_GUIDE, id: 'bombadil-lifecycle-preview', title: 'Lifecycle preview' };

/** The spec repeats these storage literals because its actions run inside the page. */
const SPEC_LITERALS: Array<[string, string]> = [
  ['grafana-pathfinder-app-active-tab', StorageKeys.ACTIVE_TAB],
  ['grafana-pathfinder-app-tabs', StorageKeys.TABS],
  ['grafana-pathfinder-app-completion-write-queue-v2:', StorageKeys.COMPLETION_WRITE_QUEUE_PREFIX],
  ['grafana-pathfinder-app-guide-attempt-', StorageKeys.GUIDE_ATTEMPT_PREFIX],
  ['grafana-pathfinder-app-interactive-completion', StorageKeys.INTERACTIVE_COMPLETION],
  ['mark-complete-button', testIds.markComplete.button],
  ['docs-panel-reset-guide-button', testIds.docsPanel.resetGuideButton],
  ['docs-panel-close-button', testIds.docsPanel.closeButton],
  ['docs-panel-container', testIds.docsPanel.container],
];

test('spec literals match the product constants', () => {
  const spec = readFileSync(join(ROOT, 'bombadil/spec/guide-lifecycle.ts'), 'utf8');
  for (const [literal, actual] of SPEC_LITERALS) {
    expect(actual).toBe(literal);
    expect(spec).toContain(literal);
  }
});

test('bounded guide-lifecycle exploration', async ({ page }) => {
  if (FAULT !== undefined && !isFault(FAULT)) {
    throw new Error(`Unknown BOMBADIL_FAULT ${FAULT}`);
  }
  mkdirSync(OUT, { recursive: true });

  const servers = await startFixtureServers({
    grafanaUrl: GRAFANA_URL,
    proxyPort: PROXY_PORT,
    cdnPort: CDN_PORT,
    workDir: OUT,
    fixtures: [...ALL_FIXTURES, GUIDE_A, GUIDE_B, PREVIEW],
  });
  const BASE_URL = servers.proxyUrl;
  await page.request.post(`${BASE_URL}/login`, { data: { user: 'admin', password: 'admin' } });
  await page.addInitScript(() => {
    // Once per tab: Bombadil's reloads and navigations must keep what they build.
    if (sessionStorage.getItem('bombadil-storage-reset') === 'done') {
      return;
    }
    sessionStorage.setItem('bombadil-storage-reset', 'done');
    Object.keys(localStorage)
      .filter((key) => key.startsWith('grafana-pathfinder'))
      .forEach((key) => localStorage.removeItem(key));
  });
  if (isFault(FAULT)) {
    await page.addInitScript(faultInitScript(FAULT, { guideB: GUIDE_B.id, preview: PREVIEW.id }));
  }

  const start = `/?doc=${encodeURIComponent(fixtureContentUrl(GUIDE_A))}`;
  await page.goto(start);
  await expect(page.getByTestId(testIds.docsPanel.container)).toBeVisible({ timeout: 30_000 });

  const consoleLines: string[] = [];
  page.on(
    'console',
    (message) => message.type() === 'error' && consoleLines.push(`${message.type()}: ${message.text()}`)
  );
  page.on('requestfailed', (request) =>
    consoleLines.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`)
  );
  page.on('pageerror', (error) => consoleLines.push(`pageerror: ${error.message}`));

  const grafanaVersion = await page.evaluate(
    () =>
      (window as unknown as { grafanaBootData?: { settings?: { buildInfo?: { version?: string } } } }).grafanaBootData
        ?.settings?.buildInfo?.version ?? 'unknown'
  );
  const bombadil = join(ROOT, 'bombadil/node_modules/.bin/bombadil');
  const common = [
    'browser',
    'test-external',
    '--remote-debugger',
    `http://localhost:${CDP_PORT}`,
    '--allow-url',
    `${new URL(BASE_URL).protocol}//${new URL(BASE_URL).host}/*`,
    // Coverage instrumentation of Grafana's bundles keeps the app from finishing boot inside the budget.
    '--instrument-javascript=',
    '--width',
    '1440',
    '--height',
    '900',
  ];
  const output = (name: string) => ['--output-path', join(OUT, name), '--output-path-overwrite'];
  const origin = `${BASE_URL}${start}`;
  const spec = join(ROOT, 'bombadil/spec/guide-lifecycle.ts');

  const started = Date.now();
  const run = await runBombadil(bombadil, [...common, ...output('trace'), '--time-limit', TIME_LIMIT, origin, spec]);
  const elapsedMs = Date.now() - started;
  writeFileSync(join(OUT, 'bombadil.log'), run.output);

  const meta: Record<string, unknown> = {
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    dirty: execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim() !== '',
    bombadil: '0.7.10',
    grafanaVersion,
    grafanaUrl: GRAFANA_URL,
    node: process.version,
    baseUrl: BASE_URL,
    fault: FAULT ?? null,
    completionWritePosts: servers.writeRequests(),
    timeLimit: TIME_LIMIT,
    elapsedMs,
    exitCode: run.status,
    expectedExit: FAULT ? 2 : 0,
  };

  if (REPLAY && run.status === 2) {
    await page.goto(start);
    const replay = await runBombadil(bombadil, [
      ...common,
      ...output('replay'),
      '--reproduce',
      join(OUT, 'trace'),
      origin,
      spec,
    ]);
    writeFileSync(join(OUT, 'replay.log'), replay.output);
    meta.replayExitCode = replay.status;
  }

  await page.screenshot({ path: join(OUT, 'final.png') }).catch(() => undefined);
  writeFileSync(join(OUT, 'console.log'), consoleLines.join('\n'));
  await servers.close();
  writeFileSync(join(OUT, 'meta.json'), JSON.stringify(meta, null, 2));
  console.log(`bombadil pilot: ${JSON.stringify(meta)} -> ${OUT}`);
  expect(run.status, `see ${join(OUT, 'bombadil.log')}`).toBe(FAULT ? 2 : 0);
});
