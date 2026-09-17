/**
 * Browser coverage for completion tracking: the percentage a reader earns, the
 * mean a path rolls it up into, and the identity the resulting completion fact
 * is keyed on.
 *
 * Every assertion is written against `docs/design/COMPLETION-MODEL.md` —
 * decisions 1 (progress is evidenced position over block count), 2 (every guide
 * ends in Mark complete), 3 (an all-prose guide is 0 or 100), 4 (a path is the
 * mean of its milestones) and 6 (navigation earns nothing).
 *
 * The server half is out of scope here. The write route, the forwarded-identity
 * check and the durable record kind are unchanged and already released; what
 * these cases prove is the client chain up to the network boundary. The write
 * route is stubbed as absent so the facts stay in the queue where they can be
 * read — see `stubCompletionWriteRoute`.
 */

import { test, expect } from './fixtures';
import { testIds } from '../src/constants/testIds';
import { TIMEOUTS } from './constants';
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

// Each case walks several guide loads and, for a path, several milestones, so
// the default per-test budget is a single interaction's worth. Sized against
// the longest case rather than guessed: the reload case can spend two
// `TIMEOUTS.UI_READY` panel waits plus a `waitForWriteAttemptAfter` that
// budgets past the drain lease's TTL, which alone sums close to two minutes.
test.describe.configure({ timeout: 180_000 });

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

    await expect(page.getByTestId(testIds.learningPaths.tableOfContents)).toBeVisible({ timeout: TIMEOUTS.UI_READY });
    // Every read below goes through a helper that waits for the surface to have
    // read its stored progress first. Both surfaces report 0 before that, for
    // every guide and every path, so an assertion made inside that window
    // cannot fail — which would make this case prove nothing at all.
    await expect
      .poll(() => pathPercentage(page), { message: 'path percentage on the cover', timeout: TIMEOUTS.UI_READY })
      .toBe(0);

    for (let milestone = 1; milestone <= PATH_MILESTONE_COUNT; milestone++) {
      await page.getByTestId(testIds.docsPanel.nextMilestoneButton).click();
      await expect(page.getByTestId(testIds.markComplete.footer).first()).toBeVisible({ timeout: TIMEOUTS.UI_READY });
      await expect
        .poll(() => footerPercentage(page), { message: `milestone ${milestone} forward`, timeout: TIMEOUTS.UI_READY })
        .toBe(0);
    }

    // The last milestone is the end of the path: there is nowhere further to
    // page to, which is what makes this a walk of the WHOLE path.
    await expect(page.getByTestId(testIds.docsPanel.nextMilestoneButton)).toBeDisabled({
      timeout: TIMEOUTS.UI_READY,
    });

    for (let milestone = PATH_MILESTONE_COUNT - 1; milestone >= 1; milestone--) {
      await page.getByTestId(testIds.docsPanel.previousMilestoneButton).click();
      await expect(page.getByTestId(testIds.markComplete.footer).first()).toBeVisible({ timeout: TIMEOUTS.UI_READY });
      await expect
        .poll(() => footerPercentage(page), { message: `milestone ${milestone} back`, timeout: TIMEOUTS.UI_READY })
        .toBe(0);
    }

    await page.getByTestId(testIds.docsPanel.previousMilestoneButton).click();
    await expect(page.getByTestId(testIds.learningPaths.tableOfContents)).toBeVisible({ timeout: TIMEOUTS.UI_READY });
    await expect
      .poll(() => pathPercentage(page), { message: 'path percentage after the walk', timeout: TIMEOUTS.UI_READY })
      .toBe(0);

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

    await expect(page.getByTestId(testIds.markComplete.footer).first()).toBeVisible({ timeout: TIMEOUTS.UI_READY });
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
      .poll(() => footerPercentage(page), {
        message: 'footer percentage after one completed step',
        timeout: TIMEOUTS.UI_READY,
      })
      .toBe(expectedPercent);
  });

  /**
   * Decision 4: a path's percentage is the arithmetic mean of its milestones'
   * percentages, equally weighted.
   *
   * The mean is taken over one FINISHED and one PARTLY finished milestone, and
   * the second one is the point. One finished milestone of four reads 25% — but
   * so does a count of completed milestones, which is the model decision 6
   * replaced, so an assertion at 25% cannot tell the two apart. A partly
   * finished second milestone can: the mean moves, while any count of completed
   * milestones stays where it was.
   */
  test('a path reads the mean of its milestones, including a partly finished one', async ({ page }) => {
    await primeCompletionSession(page);
    await launchDoc(page, fixtureContentUrl(PATH_FIXTURE), { asPath: true });

    await expect(page.getByTestId(testIds.learningPaths.tableOfContents)).toBeVisible({ timeout: TIMEOUTS.UI_READY });
    expect(await pathPercentage(page)).toBe(0);

    // Milestone 1 all the way, which continues to milestone 2.
    await page.getByTestId(testIds.docsPanel.nextMilestoneButton).click();
    await expect(page.getByTestId(testIds.markComplete.footer).first()).toBeVisible({ timeout: TIMEOUTS.UI_READY });
    await markMilestoneCompleteAndContinue(page);

    // Milestone 2 one step's worth, derived from its own counted blocks.
    const partialMilestone = PATH_MILESTONES[1]!;
    const partialPercent = expectedPercentAtPosition(partialMilestone, fixtureCompletablePosition(partialMilestone, 1));
    await completeInteractiveStep(page, 0);
    await expect
      .poll(() => footerPercentage(page), { message: 'partly finished milestone', timeout: TIMEOUTS.UI_READY })
      .toBe(partialPercent);

    // Back to the cover, one milestone at a time. Milestone 1 is marked, so its
    // completed indicator is a condition milestone 2's footer cannot satisfy —
    // which is what makes this a wait rather than a second click into the same
    // surface.
    await page.getByTestId(testIds.docsPanel.previousMilestoneButton).click();
    await expect(page.getByTestId(testIds.markComplete.completed).first()).toBeVisible({
      timeout: TIMEOUTS.UI_READY,
    });
    await page.getByTestId(testIds.docsPanel.previousMilestoneButton).click();
    await expect(page.getByTestId(testIds.learningPaths.tableOfContents)).toBeVisible({ timeout: TIMEOUTS.UI_READY });

    const expectedMean = Math.floor((100 + partialPercent) / PATH_MILESTONE_COUNT);
    // The whole point of the partial milestone: guard that this case is asking
    // a question a completed-milestone count answers differently.
    expect(expectedMean).not.toBe(Math.floor(100 / PATH_MILESTONE_COUNT));
    await expect
      .poll(() => pathPercentage(page), { message: 'path percentage', timeout: TIMEOUTS.UI_READY })
      .toBe(expectedMean);
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
     * `bundled:<id>` and `bundled:<id>/content.json` are both live launch shapes
     * for the SAME bundled guide (`src/global-state/path-member-join.ts`
     * documents both), so both must record one identity. The writer and the
     * reset path now derive that id through the single shared `normalizeGuideId`,
     * so a package-path launch records the bare `<id>` like the bare launch does.
     */
    test('the same bundled guide launched by package path', async ({ page }) => {
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

      await expect(page.getByTestId(testIds.learningPaths.tableOfContents)).toBeVisible({ timeout: TIMEOUTS.UI_READY });
      await page.getByTestId(testIds.docsPanel.nextMilestoneButton).click();
      await expect(page.getByTestId(testIds.markComplete.footer).first()).toBeVisible({ timeout: TIMEOUTS.UI_READY });

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

      await expect(page.getByTestId(testIds.learningPaths.tableOfContents)).toBeVisible({ timeout: TIMEOUTS.UI_READY });
      await page.getByTestId(testIds.docsPanel.nextMilestoneButton).click();

      const milestoneIds = NO_REPOSITORY_PATH.milestones!;
      for (let index = 0; index < milestoneIds.length; index++) {
        await expect(page.getByTestId(testIds.markComplete.footer).first()).toBeVisible({ timeout: TIMEOUTS.UI_READY });
        await markComplete(page);
        await expect
          .poll(async () => (await readQueuedFacts(page)).length, {
            message: 'facts after each milestone',
            timeout: TIMEOUTS.UI_READY,
          })
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
   * No producer on the load path mints a second fact for a guide that is
   * already recorded: the guide reopens marked, its 100% signal is re-derived,
   * and the queue still holds one fact for it.
   *
   * Stated narrowly on purpose. The durable half of the exactly-once guard is
   * what would catch a load-path producer that DID re-dispatch, and that half
   * is guarded by `completion-recorder.test.ts` — nothing on the load path
   * re-dispatches today, so this case cannot see it break on its own. What it
   * does guard is the appearance of such a producer.
   */
  test('reloading after a completion does not queue a second fact', async ({ page }) => {
    const recorder = await primeCompletionSession(page);
    await launchDoc(page, fixtureContentUrl(STANDALONE_GUIDE));

    await markComplete(page);
    const before = await waitForQueuedFacts(page, 1);
    expect(before).toHaveLength(1);
    await waitForWriteAttemptAfter(recorder, 0);

    // The queued event's own id is the idempotency key on the wire — that is
    // what makes a replayed POST dedupe to one durable record. Pinned here
    // because the route absent regime keeps the item, so both halves are
    // readable at once.
    expect(recorder.requests[0]).toMatchObject({ idempotencyKey: before[0]!.id });

    const attemptsBeforeReload = recorder.requests.length;

    await page.reload();
    // A full reload has to boot the plugin, restore the tab and re-read the
    // stored mark, so these wait as long as the first launch does rather than
    // on the default expect budget.
    await expect(page.getByTestId(testIds.docsPanel.container)).toBeVisible({ timeout: TIMEOUTS.UI_READY });
    // The guide reopens already marked, and the reloaded session drains the
    // persisted queue: both halves of the load that could mint a second fact
    // have run by the time these two conditions hold.
    await expect(page.getByTestId(testIds.markComplete.completed).first()).toBeVisible({
      timeout: TIMEOUTS.UI_READY,
    });
    await waitForWriteAttemptAfter(recorder, attemptsBeforeReload);

    const after = await readQueuedFacts(page);
    expect(factsFor(after, FIXTURE_REPOSITORY, STANDALONE_GUIDE.id)).toHaveLength(1);
    expect(after).toHaveLength(1);
  });

  /**
   * The success path, which no other case here can see.
   *
   * Every other case runs with the write route absent, where a fact is supposed
   * to STAY queued — so the half where a record actually lands, and the queue
   * is supposed to let go of it, is invisible from all of them. Two regressions
   * live only on this side: a sent item that is never removed and re-POSTs the
   * same record forever, and a 2xx misclassified as retryable.
   */
  test('a successful write empties the queue', async ({ page }) => {
    const recorder = await primeCompletionSession(page, { writeStatus: 201 });
    await launchDoc(page, fixtureContentUrl(STANDALONE_GUIDE));

    await markComplete(page);
    await waitForWriteAttemptAfter(recorder, 0);

    await expect
      .poll(async () => (await readQueuedFacts(page)).length, {
        message: 'queued facts after a successful write',
        timeout: TIMEOUTS.UI_READY,
      })
      .toBe(0);

    // One completion, one POST. Asserted after the queue has drained, so a
    // sent-but-not-removed item shows up here as a re-POST rather than passing.
    expect(recorder.requests).toHaveLength(1);
    expect(recorder.requests[0]).toMatchObject({
      guideSource: FIXTURE_REPOSITORY,
      guideId: STANDALONE_GUIDE.id,
      completionPercent: 100,
    });
    expect(recorder.requests[0]!.idempotencyKey).toEqual(expect.any(String));
    expect(recorder.requests[0]!.idempotencyKey).not.toBe('');
  });
});
