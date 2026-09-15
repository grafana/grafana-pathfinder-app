/**
 * Browser coverage for completion tracking: the percentage a reader earns, the
 * mean a path rolls it up into, and the identity the resulting completion fact
 * is keyed on.
 *
 * Every assertion is written against `docs/design/COMPLETION-MODEL.md` —
 * decisions 1 (progress is evidenced position over block count), 2 (every guide
 * ends in Mark complete), 3 (an all-prose guide is 0 or 100), 4 (a path is the
 * mean of its milestones) and 6 (navigation earns nothing) — not against what
 * the code currently produces. Where the two disagree the case is marked
 * `test.fail()` with the divergence named, and the assertion is left alone.
 *
 * The server half is out of scope here. The write route, the forwarded-identity
 * check and the durable record kind are unchanged and already released; what
 * these cases prove is the client chain up to the network boundary. The write
 * route is stubbed as absent so the facts stay in the queue where they can be
 * read — see `stubCompletionWriteRoute`.
 */

import { test, expect } from './fixtures';
import { testIds } from '../src/constants/testIds';
import {
  APP_PLATFORM_GUIDE,
  APP_PLATFORM_REPOSITORY,
  BUNDLED_GUIDE_ID,
  BUNDLED_GUIDE_TITLE,
  BUNDLED_REPOSITORY,
  FIXTURE_REPOSITORY,
  NO_REPOSITORY_PATH,
  PATH_FIXTURE,
  PATH_MILESTONES,
  PATH_MILESTONE_COUNT,
  STANDALONE_GUIDE,
  expectedPercentAtPosition,
  fixtureBlockCount,
  fixtureCompletablePosition,
  fixtureContentUrl,
} from './helpers/completion.fixtures';
import {
  completeInteractiveStep,
  factsFor,
  footerPercentage,
  launchDoc,
  markComplete,
  markMilestoneCompleteAndContinue,
  openDocsPanel,
  pathPercentage,
  primeCompletionSession,
  readQueuedFacts,
  readStoredProgress,
  seedRestoredTab,
  stubAppPlatformGuide,
  waitForQueuedFacts,
  waitForWriteAttemptAfter,
} from './helpers/completion.helpers';

/**
 * The schema default `repository`, applied to any manifest that declares none.
 * The value a completion must be keyed on when nothing truer resolves.
 */
const DEFAULT_GUIDE_SOURCE = 'interactive-tutorials';

/** What a guide launch is allowed to take, matching `launchDoc` and `openDocsPanel`. */
const PANEL_READY_TIMEOUT_MS = 30_000;

// Each case walks several guide loads and, for a path, several milestones. The
// default per-test budget is a single interaction's worth.
test.describe.configure({ timeout: 120_000 });

test.describe('completion tracking', () => {
  /**
   * Decision 6: back and next navigation is not evidence. A reader who pages
   * through a whole path has demonstrated nothing about any of its milestones,
   * so every milestone stays at 0%, the path stays at 0%, and no completion
   * fact exists to be written. This is the behaviour whose regression would
   * flatter every number above it.
   */
  test('walking a whole path with next and back earns no credit', async ({ page }) => {
    await primeCompletionSession(page);
    await launchDoc(page, fixtureContentUrl(PATH_FIXTURE), { asPath: true });

    await expect(page.getByTestId(testIds.learningPaths.tableOfContents)).toBeVisible();
    // Every read below goes through a helper that waits for the surface to have
    // read its stored progress first. Both surfaces report 0 before that, for
    // every guide and every path, so an assertion made inside that window
    // cannot fail — which would make this case prove nothing at all.
    await expect.poll(() => pathPercentage(page), { message: 'path percentage on the cover' }).toBe(0);

    for (let milestone = 1; milestone <= PATH_MILESTONE_COUNT; milestone++) {
      await page.getByTestId(testIds.docsPanel.nextMilestoneButton).click();
      await expect(page.getByTestId(testIds.markComplete.footer).first()).toBeVisible();
      await expect.poll(() => footerPercentage(page), { message: `milestone ${milestone} forward` }).toBe(0);
    }

    // The last milestone is the end of the path: there is nowhere further to
    // page to, which is what makes this a walk of the WHOLE path.
    await expect(page.getByTestId(testIds.docsPanel.nextMilestoneButton)).toBeDisabled();

    for (let milestone = PATH_MILESTONE_COUNT - 1; milestone >= 1; milestone--) {
      await page.getByTestId(testIds.docsPanel.previousMilestoneButton).click();
      await expect(page.getByTestId(testIds.markComplete.footer).first()).toBeVisible();
      await expect.poll(() => footerPercentage(page), { message: `milestone ${milestone} back` }).toBe(0);
    }

    await page.getByTestId(testIds.docsPanel.previousMilestoneButton).click();
    await expect(page.getByTestId(testIds.learningPaths.tableOfContents)).toBeVisible();
    await expect.poll(() => pathPercentage(page), { message: 'path percentage after the walk' }).toBe(0);

    expect(await readQueuedFacts(page)).toEqual([]);

    // The layer beneath the two percentages: nothing was persisted for any
    // milestone either. A rendered 0 can mean "not read yet"; a stored record
    // cannot, so this is what makes the case fail if navigation ever starts
    // crediting again.
    const stored = await readStoredProgress(page);
    for (const milestone of PATH_MILESTONES) {
      expect(Object.keys(stored.interactiveCompletion)).not.toContain(fixtureContentUrl(milestone));
    }
    expect(Object.values(stored.milestoneCompletion).flat()).toEqual([]);
  });

  /**
   * Decision 1: progress is the furthest evidenced position over the guide's
   * total block count. The expected share is derived from the fixture's own
   * counted blocks with the canonical counter, so it cannot drift from the
   * guide it describes.
   */
  test('completing one interactive step earns exactly its share of the block count', async ({ page }) => {
    await primeCompletionSession(page);
    await launchDoc(page, fixtureContentUrl(STANDALONE_GUIDE));

    await expect(page.getByTestId(testIds.markComplete.footer).first()).toBeVisible();
    expect(await footerPercentage(page)).toBe(0);

    const position = fixtureCompletablePosition(STANDALONE_GUIDE, 1);
    const expectedPercent = expectedPercentAtPosition(STANDALONE_GUIDE, position);
    // Guard the fixture itself: a share of 0 or 100 would make the assertion
    // below pass without measuring anything.
    expect(expectedPercent).toBeGreaterThan(0);
    expect(expectedPercent).toBeLessThan(100);
    expect(position).toBeLessThan(fixtureBlockCount(STANDALONE_GUIDE));

    await completeInteractiveStep(page, 0);

    await expect
      .poll(() => footerPercentage(page), { message: 'footer percentage after one completed step' })
      .toBe(expectedPercent);
  });

  /**
   * Decision 4: a path's percentage is the arithmetic mean of its milestones'
   * percentages, equally weighted. One finished milestone of four is 25% —
   * which is a different number from anything a count of visited milestones
   * would produce.
   */
  test('a path reads the mean of its milestones after one of four is finished', async ({ page }) => {
    await primeCompletionSession(page);
    await launchDoc(page, fixtureContentUrl(PATH_FIXTURE), { asPath: true });

    await expect(page.getByTestId(testIds.learningPaths.tableOfContents)).toBeVisible();
    expect(await pathPercentage(page)).toBe(0);

    await page.getByTestId(testIds.docsPanel.nextMilestoneButton).click();
    await expect(page.getByTestId(testIds.markComplete.footer).first()).toBeVisible();
    // Marking a milestone complete continues to milestone 2, so the walk back
    // to the cover is two steps.
    await markMilestoneCompleteAndContinue(page);
    await page.getByTestId(testIds.docsPanel.previousMilestoneButton).click();
    await page.getByTestId(testIds.docsPanel.previousMilestoneButton).click();

    await expect(page.getByTestId(testIds.learningPaths.tableOfContents)).toBeVisible();
    const expectedMean = Math.floor(100 / PATH_MILESTONE_COUNT);
    await expect.poll(() => pathPercentage(page), { message: 'path percentage' }).toBe(expectedMean);
  });

  /**
   * One completion produces one fact, keyed on the guide's identity rather than
   * on whatever URL it happened to be launched from. Each launch shape below is
   * a live one, and the pair asserted for each is the one the completion model
   * says identifies that guide.
   */
  test.describe('one completion queues one fact under the guide identity', () => {
    test('a bundled guide launched by id', async ({ page }) => {
      await primeCompletionSession(page);
      await launchDoc(page, `bundled:${BUNDLED_GUIDE_ID}`);

      await markComplete(page);

      const facts = await waitForQueuedFacts(page, 1);
      expect(facts).toHaveLength(1);
      expect(facts[0]!.body).toMatchObject({
        guideSource: BUNDLED_REPOSITORY,
        guideId: BUNDLED_GUIDE_ID,
        completionPercent: 100,
      });
    });

    /**
     * EXPECTED FAILURE — completion-identity divergence, guideId axis.
     *
     * `bundled:<id>` and `bundled:<id>/content.json` are both live launch
     * shapes for the SAME bundled guide (`src/global-state/path-member-join.ts`
     * documents both), so both must record one identity. They do not:
     *
     *   - the writer, `persistJourneyCompletionPercentage` in
     *     `src/docs-retrieval/learning-journey-helpers.ts`, derives `guideId`
     *     with `journeyBaseUrl.replace('bundled:', '')` and no further
     *     stripping, so the package-path launch records `<id>/content.json`;
     *   - `fallbackGuideIdFromContentKey` in
     *     `src/components/docs-panel/hooks/resetGuideProgress.ts` strips a
     *     trailing `/content.json`, so the reset path lifts the exactly-once
     *     guard under `<id>`.
     *
     * The two therefore disagree for this guide, and the warehouse holds it
     * under two keys. Left red deliberately: the fix is an identity decision,
     * and guessing at an identity is what produced the earlier instances of
     * this class.
     */
    test.fail('the same bundled guide launched by package path', async ({ page }) => {
      await primeCompletionSession(page);
      await page.goto('/');
      await seedRestoredTab(page, {
        id: 'restored-bundled-package-path',
        title: BUNDLED_GUIDE_TITLE,
        baseUrl: `bundled:${BUNDLED_GUIDE_ID}/content.json`,
        type: 'interactive',
      });
      await page.reload();
      await openDocsPanel(page);

      await markComplete(page);

      const facts = await waitForQueuedFacts(page, 1);
      expect(facts).toHaveLength(1);
      expect(facts[0]!.body).toMatchObject({
        guideSource: BUNDLED_REPOSITORY,
        guideId: BUNDLED_GUIDE_ID,
        completionPercent: 100,
      });
    });

    test('a share link to an App Platform guide', async ({ page }) => {
      await primeCompletionSession(page);
      await stubAppPlatformGuide(page, APP_PLATFORM_GUIDE);
      await launchDoc(page, `api:${APP_PLATFORM_GUIDE.id}`);

      await markComplete(page);

      const facts = await waitForQueuedFacts(page, 1);
      expect(facts).toHaveLength(1);
      expect(facts[0]!.body).toMatchObject({
        guideSource: APP_PLATFORM_REPOSITORY,
        guideId: APP_PLATFORM_GUIDE.id,
        completionPercent: 100,
      });
    });

    test('a milestone completed as a member of a path', async ({ page }) => {
      await primeCompletionSession(page);
      await launchDoc(page, fixtureContentUrl(PATH_FIXTURE), { asPath: true });

      await expect(page.getByTestId(testIds.learningPaths.tableOfContents)).toBeVisible();
      await page.getByTestId(testIds.docsPanel.nextMilestoneButton).click();
      await expect(page.getByTestId(testIds.markComplete.footer).first()).toBeVisible();

      await markComplete(page);

      const facts = await waitForQueuedFacts(page, 1);
      expect(facts).toHaveLength(1);
      // A milestone is keyed on its own slug, never on the owning path's
      // manifest id — the path's record is a separate, journey-kind fact.
      expect(facts[0]!.body).toMatchObject({
        guideSource: FIXTURE_REPOSITORY,
        guideId: PATH_MILESTONES[0]!.id,
        guideCategory: 'learning-journey',
        completionPercent: 100,
      });
    });

    /**
     * The whole-path record, for a path whose manifest declares an id and no
     * repository. The model says such a manifest is keyed on the schema
     * default, exactly as an identically shaped guide manifest would be
     * (`resolveStandaloneGuideCompletionIdentity` takes no fallback source so
     * that both sides of the reset seam get the same value).
     *
     * This is a tripwire, not a reproduction. The whole-journey branch of
     * `markMilestoneDone` in `src/docs-retrieval/learning-journey-helpers.ts`
     * still calls `resolveCompletionIdentity` with `fallbackSource: 'bundled'`
     * of its own, which would key this path under `bundled`. It does not bite
     * today only because every launch that reaches the branch also resolves a
     * `repository` that pre-empts the fallback — for a CDN package, the
     * manifest schema's own default. Should that stop being true, the hard
     * coded fallback becomes the answer and this case turns red.
     *
     * The guard for the branch itself is a unit expected-failure, in
     * `src/docs-retrieval/learning-journey-helpers.completion-boundary.test.ts`,
     * because no DOM-reachable launch gets there.
     */
    test('the whole-path record for a path whose manifest declares no repository', async ({ page }) => {
      await primeCompletionSession(page);
      await launchDoc(page, fixtureContentUrl(NO_REPOSITORY_PATH), { asPath: true });

      await expect(page.getByTestId(testIds.learningPaths.tableOfContents)).toBeVisible();
      await page.getByTestId(testIds.docsPanel.nextMilestoneButton).click();

      const milestoneIds = NO_REPOSITORY_PATH.milestones!;
      for (let index = 0; index < milestoneIds.length; index++) {
        await expect(page.getByTestId(testIds.markComplete.footer).first()).toBeVisible();
        await markComplete(page);
        await expect
          .poll(async () => (await readQueuedFacts(page)).length, { message: 'facts after each milestone' })
          .toBeGreaterThan(index);
      }

      // One fact per milestone, plus the whole-path record, and nothing else.
      const facts = await waitForQueuedFacts(page, milestoneIds.length + 1);
      expect(facts).toHaveLength(milestoneIds.length + 1);
      expect(factsFor(facts, DEFAULT_GUIDE_SOURCE, NO_REPOSITORY_PATH.id)).toHaveLength(1);
      for (const milestoneId of milestoneIds) {
        expect(factsFor(facts, DEFAULT_GUIDE_SOURCE, milestoneId)).toHaveLength(1);
      }
    });
  });

  /**
   * The write-side guarantee is exactly-once per identity, and it is durable:
   * a guide already recorded before a reload must not re-dispatch its 100%
   * signal into a second fact on the next load.
   */
  test('reloading after a completion does not queue a second fact', async ({ page }) => {
    const recorder = await primeCompletionSession(page);
    await launchDoc(page, fixtureContentUrl(STANDALONE_GUIDE));

    await markComplete(page);
    const before = await waitForQueuedFacts(page, 1);
    expect(before).toHaveLength(1);
    await waitForWriteAttemptAfter(recorder, 0);
    const attemptsBeforeReload = recorder.requests.length;

    await page.reload();
    // A full reload has to boot the plugin, restore the tab and re-read the
    // stored mark, so these wait as long as the first launch does rather than
    // on the default expect budget.
    await expect(page.getByTestId(testIds.docsPanel.container)).toBeVisible({ timeout: PANEL_READY_TIMEOUT_MS });
    // The guide reopens already marked, and the reloaded session drains the
    // persisted queue: both halves of the load that could mint a second fact
    // have run by the time these two conditions hold.
    await expect(page.getByTestId(testIds.markComplete.completed).first()).toBeVisible({
      timeout: PANEL_READY_TIMEOUT_MS,
    });
    await waitForWriteAttemptAfter(recorder, attemptsBeforeReload);

    const after = await readQueuedFacts(page);
    expect(factsFor(after, FIXTURE_REPOSITORY, STANDALONE_GUIDE.id)).toHaveLength(1);
    expect(after).toHaveLength(1);
  });
});
