/**
 * Observation and driving helpers for the completion-tracking suite.
 *
 * Two observation techniques, both needed. `readQueuedFacts` reads the
 * completion fact straight out of the bounded localStorage queue, which is
 * where a fact lands whether or not the write route is served — see the
 * route-missing contract in `src/completion-records/completion-write-client.ts`.
 * `stubCompletionWriteRoute` intercepts the outgoing POST, for the cases that
 * need the request body or the number of requests rather than the queue.
 *
 * The storage key prefix is read from `src/lib/storage-keys.ts`, which exists
 * precisely so a Playwright test can import it instead of guessing the string.
 */

import { expect, type Page, type Route } from '@playwright/test';

import pluginJson from '../../src/plugin.json';
import { StorageKeys } from '../../src/lib/storage-keys';
import { LEASE_TTL_MS } from '../../src/completion-records/completion-write-timing';
import { testIds } from '../../src/constants/testIds';
import {
  ALL_FIXTURES,
  CDN_BASE_URL,
  fixtureCatalogue,
  fixtureContent,
  fixtureManifest,
  type PackageFixture,
} from './completion.fixtures';

const RESOURCES_URL = `/api/plugins/${pluginJson.id}/resources`;

/** The write route `postCompletionRecord` POSTs to. */
const COMPLETION_WRITE_URL = `${RESOURCES_URL}/completion-records`;

/** The catalogue route the online CDN package resolver reads. */
const PACKAGE_RECOMMENDATIONS_URL = `${RESOURCES_URL}/package-recommendations`;

/** The App Platform resource a `?doc=api:<id>` share link resolves to. */
const APP_PLATFORM_GUIDES_GLOB = '**/apis/pathfinderbackend.ext.grafana.app/**/interactiveguides/**';

/** One completion fact as the queue persisted it. */
export interface QueuedFact {
  id: string;
  attempts: number;
  createdAt: number;
  body: {
    guideSource: string;
    guideId: string;
    guideTitle: string;
    guideCategory: string;
    pathId?: string;
    completionPercent: number;
    source: string;
    completedAt: string;
    platform: string;
  };
}

/** Collected POSTs to the write route, in arrival order. */
export interface WriteRouteRecorder {
  requests: Array<Record<string, unknown>>;
}

/**
 * Serve the write route with `status` and record every POST.
 *
 * Two regimes matter, and a case picks one:
 *
 *   - **404, the default** — the reserved structural "route not served here"
 *     signal. The client's documented response is to stand the network drain
 *     down for the session while STILL persisting later facts to localStorage,
 *     which is what makes the chain up to the network boundary observable from
 *     a local stack: the fact is computed, built and queued with its identity,
 *     and nothing removes it afterwards the way a success would.
 *   - **201** — the success path, where the queue is supposed to drop the sent
 *     item. That is the half a 404 regime can never see, so it needs a case of
 *     its own; see `writeStatus` on `primeCompletionSession`.
 *
 * The 201 body mirrors the real route's (`{"name": "<derived record name>"}`),
 * which the backend derives from the idempotency key.
 */
export async function stubCompletionWriteRoute(page: Page, status = 404): Promise<WriteRouteRecorder> {
  const recorder: WriteRouteRecorder = { requests: [] };

  await page.route(`**${COMPLETION_WRITE_URL}`, async (route: Route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    const payload = route.request().postDataJSON();
    if (payload && typeof payload === 'object') {
      recorder.requests.push(payload as Record<string, unknown>);
    }
    const created = status >= 200 && status < 300;
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(created ? { name: `completion-${recorder.requests.length}` } : { error: 'not-found' }),
    });
  });

  return recorder;
}

/**
 * Serve the fixture catalogue and its package files, so no case depends on the
 * live CDN index or on network egress from the test host.
 */
export async function stubPackageCatalogue(page: Page, fixtures: PackageFixture[] = ALL_FIXTURES): Promise<void> {
  await page.route(`**${PACKAGE_RECOMMENDATIONS_URL}`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fixtureCatalogue(fixtures)),
    });
  });

  const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]));

  await page.route(`${CDN_BASE_URL}*/*`, async (route: Route) => {
    const segments = new URL(route.request().url()).pathname.split('/').filter(Boolean);
    const file = segments.at(-1);
    const id = segments.at(-2);
    const fixture = id ? byId.get(id) : undefined;
    if (!fixture) {
      await route.fulfill({ status: 404, body: 'not a fixture' });
      return;
    }
    const body =
      file === 'manifest.json'
        ? fixtureManifest(fixture)
        : file === 'content.json'
          ? fixtureContent(fixture)
          : undefined;
    if (!body) {
      await route.fulfill({ status: 404, body: 'not a fixture file' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      // The page fetches these cross-origin with a plain GET, so the fulfilled
      // response needs the permissive header or the browser drops it before
      // the content fetcher sees a body.
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body),
    });
  });
}

/**
 * Serve one App Platform `InteractiveGuide` resource, as the backend-guide
 * loader behind a `?doc=api:<id>` share link reads it.
 */
export async function stubAppPlatformGuide(page: Page, fixture: PackageFixture): Promise<void> {
  await page.route(APP_PLATFORM_GUIDES_GLOB, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        metadata: { name: fixture.id },
        spec: {
          id: fixture.id,
          title: fixture.title,
          schemaVersion: '1.0.0',
          blocks: fixture.blocks,
          manifest: fixtureManifest(fixture),
        },
      }),
    });
  });
}

/** Every completion fact currently persisted in this profile's write queue. */
export async function readQueuedFacts(page: Page): Promise<QueuedFact[]> {
  const raw = await page.evaluate((prefix) => {
    const out: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key || !key.startsWith(prefix) || !key.includes(':item:')) {
        continue;
      }
      const value = localStorage.getItem(key);
      if (value) {
        out.push(value);
      }
    }
    return out;
  }, StorageKeys.COMPLETION_WRITE_QUEUE_PREFIX);

  return raw
    .map((value) => JSON.parse(value) as QueuedFact)
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
}

/**
 * The progress this profile has persisted, read straight out of the two
 * namespaces every surface derives a percentage from.
 *
 * The displayed percentage is one layer; this is the layer beneath it. A case
 * asserting that something earned nothing wants both, because a rendered 0
 * can also mean "not read yet" while a stored record cannot.
 */
export async function readStoredProgress(page: Page): Promise<{
  /** Percentage per guide content key. */
  interactiveCompletion: Record<string, number>;
  /** Completed milestone slugs per journey base URL. */
  milestoneCompletion: Record<string, string[]>;
}> {
  return page.evaluate(
    ({ interactiveKey, milestoneKey }) => {
      const parse = <T>(key: string, fallback: T): T => {
        try {
          const raw = localStorage.getItem(key);
          return raw ? (JSON.parse(raw) as T) : fallback;
        } catch {
          return fallback;
        }
      };
      return {
        interactiveCompletion: parse<Record<string, number>>(interactiveKey, {}),
        milestoneCompletion: parse<Record<string, string[]>>(milestoneKey, {}),
      };
    },
    { interactiveKey: StorageKeys.INTERACTIVE_COMPLETION, milestoneKey: StorageKeys.MILESTONE_COMPLETION }
  );
}

/** The queued facts for one guide identity. */
export function factsFor(facts: QueuedFact[], guideSource: string, guideId: string): QueuedFact[] {
  return facts.filter((fact) => fact.body.guideSource === guideSource && fact.body.guideId === guideId);
}

/**
 * Arm a one-shot clear of every Pathfinder key, applied before the first page
 * of this context runs any script.
 *
 * A case has to start from a reader who has completed nothing: the suite runs
 * as one admin login, and both the write queue and the recorder's durable
 * exactly-once guard outlive a reload by design. One-shot rather than
 * per-load, because surviving a reload is exactly what one of these cases
 * asserts — the `sessionStorage` marker is per tab, so it fires on the first
 * document and never again.
 *
 * Armed as an init script rather than run after a navigation, so priming costs
 * no page load of its own. A load whose only purpose is to clear storage also
 * starts the write queue's drain, and navigating away mid-drain strands the
 * drain lease in storage for its full TTL — which the next page then has to
 * wait out before it can send anything.
 */
async function armPathfinderStorageReset(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      if (sessionStorage.getItem('pathfinder-e2e-storage-reset') === 'done') {
        return;
      }
      sessionStorage.setItem('pathfinder-e2e-storage-reset', 'done');
      const doomed: string[] = [];
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (key && key.startsWith('grafana-pathfinder')) {
          doomed.push(key);
        }
      }
      doomed.forEach((key) => localStorage.removeItem(key));
    } catch {
      // A context without storage access has nothing stale to clear.
    }
  });
}

/**
 * Persist a single tab and make it active, so the next load restores it.
 *
 * Tab restore is a live launch shape, and the shape that matters here is a
 * persisted tab carrying no `packageInfo`: the content then loads through the
 * plain fetch path with no resolved manifest, which is how a bundled guide
 * comes to be identified by its content key alone.
 */
export async function seedRestoredTab(
  page: Page,
  tab: { id: string; title: string; baseUrl: string; currentUrl?: string; type: string }
): Promise<void> {
  await page.evaluate(
    ({ tabsKey, activeKey, persisted }) => {
      localStorage.setItem(tabsKey, JSON.stringify([persisted]));
      localStorage.setItem(activeKey, JSON.stringify(persisted.id));
    },
    {
      tabsKey: StorageKeys.TABS,
      activeKey: StorageKeys.ACTIVE_TAB,
      persisted: { ...tab, currentUrl: tab.currentUrl ?? tab.baseUrl },
    }
  );
}

/**
 * Open the docs panel through Grafana's extension sidebar trigger.
 *
 * The trigger is Grafana's own, and it only opens the panel once Grafana has
 * registered the plugin's sidebar component — a click before that is a no-op
 * rather than an error, so this re-clicks while the panel is still closed. It
 * never clicks a panel that is already open, which would toggle it shut.
 */
export async function openDocsPanel(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  const help = page.locator('button[aria-label="Help"]');
  await help.waitFor({ state: 'visible', timeout: 30_000 });
  const container = page.getByTestId(testIds.docsPanel.container);

  for (let attempt = 0; attempt < 6; attempt++) {
    if (await container.isVisible()) {
      return;
    }
    await help.click();
    await container.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
  }
  await container.waitFor({ state: 'visible', timeout: 15_000 });
}

/**
 * Arm every stub and the one-shot storage reset, ready for the case's own
 * first navigation. Navigates nothing itself.
 *
 * `writeStatus` chooses the write route's regime — 404 (route absent) by
 * default, so facts stay in the queue where they can be read; pass 201 for a
 * case that needs the success path.
 */
export async function primeCompletionSession(
  page: Page,
  options: { writeStatus?: number } = {}
): Promise<WriteRouteRecorder> {
  await armPathfinderStorageReset(page);
  const recorder = await stubCompletionWriteRoute(page, options.writeStatus);
  await stubPackageCatalogue(page);
  return recorder;
}

/**
 * Launch a guide or path through the `?doc=` deep link and wait for the
 * footer the completion model puts at the foot of every one of them.
 *
 * `type=learning-journey` is how a package URL is classified as a path rather
 * than a single doc — the deep-link handler's own note: package URLs
 * misclassify as `interactive` without it.
 */
export async function launchDoc(page: Page, docParam: string, options?: { asPath?: boolean }): Promise<void> {
  const params = new URLSearchParams({ doc: docParam });
  if (options?.asPath) {
    params.set('type', 'learning-journey');
  }
  await page.goto(`/?${params.toString()}`);
  await page.getByTestId(testIds.docsPanel.container).waitFor({ state: 'visible', timeout: 30_000 });
}

/**
 * The path's rolled-up percentage, from the declarative attribute on the path
 * table of contents. Read from the attribute rather than the ring, which the
 * cover page hides at 0%, and that is the value a case most needs to assert.
 *
 * Waits for the attribute to exist. It is absent until the path's stored
 * progress has been read, and during that window the cover page's own
 * completed-milestone set is empty — so every path reads 0% whatever the reader
 * has actually earned. Reading through that window would make "earned nothing"
 * indistinguishable from "has not looked yet", which is exactly the confusion
 * the navigation case has to be able to tell apart.
 */
export async function pathPercentage(page: Page): Promise<number> {
  const toc = page.locator(`[data-testid="${testIds.learningPaths.tableOfContents}"][data-test-path-percent]`).first();
  await toc.waitFor({ state: 'attached', timeout: 30_000 });
  const raw = await toc.getAttribute('data-test-path-percent');
  if (raw === null) {
    throw new Error('Path table of contents exposes no data-test-path-percent');
  }
  return Number(raw);
}

/**
 * The percentage the Mark complete footer reports, as an integer.
 *
 * Waits for the footer to report its progress as `ready` first. Until the
 * stored mark has been read the footer resolves no content key, so its
 * percentage is a hard-coded 0 rather than the guide's — and an assertion made
 * inside that window cannot fail.
 */
export async function footerPercentage(page: Page): Promise<number> {
  await waitForFooterHydrated(page);
  const text = await page.getByTestId(testIds.markComplete.percentage).first().innerText();
  const match = /(\d+)%/.exec(text);
  if (!match) {
    throw new Error(`Mark complete footer reported no percentage: ${JSON.stringify(text)}`);
  }
  return Number(match[1]);
}

/** Wait for the footer to have read the stored mark, so its percentage means something. */
export async function waitForFooterHydrated(page: Page): Promise<void> {
  await page
    .locator(`[data-testid="${testIds.markComplete.footer}"][data-test-progress-state="ready"]`)
    .first()
    .waitFor({ state: 'attached', timeout: 30_000 });
}

/**
 * Complete one interactive step by clicking its "Do it" button and waiting
 * for the step's own completed state — never a fixed sleep.
 */
export async function completeInteractiveStep(page: Page, stepIndex = 0): Promise<void> {
  const step = page.locator('[data-test-step-kind]').nth(stepIndex);
  await step.waitFor({ state: 'visible', timeout: 30_000 });
  const stepId = await step.getAttribute('data-test-step-id');
  if (!stepId) {
    throw new Error(`Interactive step ${stepIndex} exposes no data-test-step-id`);
  }

  const doIt = page.getByTestId(testIds.interactive.doItButton(stepId));
  await doIt.waitFor({ state: 'visible', timeout: 30_000 });
  await doIt.click();

  await page
    .locator(`[data-test-step-id="${stepId}"][data-test-step-state="completed"]`)
    .waitFor({ state: 'attached', timeout: 30_000 });
}

/**
 * Click "Mark complete and continue" on a milestone and wait for the NEXT
 * milestone to render unmarked.
 *
 * The control dwells on a short celebration before continuing, so the real
 * condition for "the reader has moved on" is an unmarked footer again — never
 * a fixed wait on the animation's duration.
 */
export async function markMilestoneCompleteAndContinue(page: Page): Promise<void> {
  await markComplete(page);
  await page.getByTestId(testIds.markComplete.button).first().waitFor({ state: 'visible', timeout: 30_000 });
}

/** Click Mark complete and wait for the footer to settle on its completed state. */
export async function markComplete(page: Page): Promise<void> {
  const button = page.getByTestId(testIds.markComplete.button).first();
  await button.waitFor({ state: 'visible', timeout: 30_000 });
  // A click before the stored mark has been read is silently dropped — the
  // handler has no content key to write under. The footer's own progress state
  // is the signal; the control's disabled state is not, because Grafana's
  // Button expresses it with `aria-disabled`, which this contract does not
  // select on.
  await waitForFooterHydrated(page);
  await button.click();
  await page.getByTestId(testIds.markComplete.completed).first().waitFor({ state: 'visible', timeout: 30_000 });
}

/**
 * Wait until the queue has attempted at least one more send than `baseline`.
 *
 * The real condition that says this load's write pipeline has run: the
 * controller arms on load, drains the persisted queue, and POSTs. Waiting on
 * it is what lets a case assert what the queue holds AFTER a reload without
 * guessing at a duration.
 */
export async function waitForWriteAttemptAfter(recorder: WriteRouteRecorder, baseline: number): Promise<void> {
  // Budgeted past the drain lease's own TTL: only one tab drains at a time, and
  // a lease stranded by a navigation is recovered by expiry rather than by
  // release, so a send can legitimately be a whole TTL away.
  await expect
    .poll(() => recorder.requests.length, { message: 'completion write attempts', timeout: LEASE_TTL_MS + 20_000 })
    .toBeGreaterThan(baseline);
}

/**
 * Wait until the write queue holds at least `count` facts. The completion
 * path is deliberately asynchronous — the fact is emitted off the click
 * handler — so this waits on the queue itself rather than on a duration.
 */
export async function waitForQueuedFacts(page: Page, count: number): Promise<QueuedFact[]> {
  await page.waitForFunction(
    ({ prefix, expected }) => {
      let seen = 0;
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (key && key.startsWith(prefix) && key.includes(':item:')) {
          seen++;
        }
      }
      return seen >= expected;
    },
    { prefix: StorageKeys.COMPLETION_WRITE_QUEUE_PREFIX, expected: count },
    { timeout: 30_000 }
  );
  return readQueuedFacts(page);
}
