// Learning Journey Helper Functions
// Extracted from docs-fetcher.ts but focused on metadata operations only
// No DOM processing - just data manipulation and navigation logic

import {
  RawContent,
  ContentMetadata,
  Milestone,
  LearningJourneyMetadata,
  SideJourneys,
  RelatedJourneys,
  ConclusionImage,
} from '../types/content.types';
import {
  journeyCompletionStorage,
  milestoneCompletionStorage,
  learningProgressStorage,
  interactiveCompletionStorage,
} from '../lib/user-storage';
import { sanitizeContentKey } from '../global-state/content-key';
import { resolvePathMemberPercentages, type PathMember } from '../global-state/path-member-join';
import { dispatchProgress } from '../global-state/progress-events';
import { meanOfMemberPercentages } from '../lib/guide-stats';
import { markGuideCompleted, findPathByUrl } from '../lib/guide-completion-bridge';
import {
  recordGuideCompletion,
  recordJourneyCompletion,
  resolveMilestoneCompletionIdentity,
  resolveBundledGuideCompletionIdentity,
  resolveStandaloneGuideCompletionIdentity,
  resolveJourneyCompletionIdentity,
  manifestGuideId,
  normalizeGuideId,
} from '../completion-records';
import { escapeHtml, sanitizeHtmlUrl } from '../security/html-sanitizer';

import { getMilestoneSlug } from '../lib/learning-journey-url';
export { getMilestoneSlug };

/**
 * Optional manifest/display context threaded from the completion call sites so
 * the recorder can key on `(guideSource, guideId) = (repository, manifest.id)`
 * — never on a loader URL. `repository` is the recommendation-level field: real
 * V1 shapes carry it as a sibling of `manifest`, not inside it (V1PackageManifest
 * has no repository field), so it must be threaded separately. Absent for plain
 * bundled guides, which fall back to `guideSource: 'bundled'` + the slug.
 */
export interface CompletionContext {
  packageManifest?: Record<string, unknown>;
  /** Recommendation-level repository (sibling of manifest in the V1 wire shape). */
  repository?: string;
  guideTitle?: string;
  pathId?: string;
}

const GRAFANA_BASE = new URL('https://grafana.com');

function toAbsoluteGrafanaUrl(url: string): string {
  if (!url) {
    return url;
  }
  try {
    return new URL(url, GRAFANA_BASE).href;
  } catch {
    return url;
  }
}

/**
 * Navigation helpers - these work with metadata, not DOM
 */
export function getNextMilestoneUrl(content: RawContent): string | null {
  if (content.type !== 'learning-journey' || !content.metadata.learningJourney) {
    return null;
  }

  const { currentMilestone, milestones } = content.metadata.learningJourney;

  // Milestones are sequentially numbered from 1. Locked (unresolved) entries
  // aren't navigable, so skip forward past any run of them to the next
  // resolved milestone — a path whose next member hasn't published yet
  // shouldn't dead-end the toolbar (RFC CUSTOM-GUIDE-PACKAGES.md §6.5).
  const nextMilestone = milestones.find((m) => m.number > currentMilestone && !m.isLocked);
  return nextMilestone ? nextMilestone.url : null;
}

export function getPreviousMilestoneUrl(content: RawContent): string | null {
  if (content.type !== 'learning-journey' || !content.metadata.learningJourney) {
    return null;
  }

  const { currentMilestone, milestones, baseUrl } = content.metadata.learningJourney;

  if (currentMilestone < 1) {
    return null;
  }

  // Skip backward past any locked entries to the nearest resolved milestone.
  const candidates = milestones.filter((m) => m.number < currentMilestone && !m.isLocked);
  if (candidates.length > 0) {
    const prevMilestone = candidates.reduce((latest, m) => (m.number > latest.number ? m : latest));
    return prevMilestone.url;
  }

  // Nothing resolved before this one — go back to the cover page (milestone 0).
  return baseUrl;
}

export function getCurrentMilestone(content: RawContent): Milestone | null {
  if (content.type !== 'learning-journey' || !content.metadata.learningJourney) {
    return null;
  }

  const { currentMilestone, milestones } = content.metadata.learningJourney;
  return milestones.find((m) => m.number === currentMilestone) || null;
}

export function getTotalMilestones(content: RawContent): number {
  if (content.type !== 'learning-journey' || !content.metadata.learningJourney) {
    return 0;
  }

  return content.metadata.learningJourney.totalMilestones;
}

/**
 * Progress tracking helpers
 */
/** One milestone's own percentage, as the journey mean's per-member input. */
export interface MilestonePercentage {
  milestone: Milestone;
  /** `undefined` when the member resolved to no key at all — excluded from the mean. */
  percent: number | undefined;
}

/**
 * Confirmed-persisted guard: a key lands here only after its
 * `interactiveCompletionStorage.set` call has resolved, so a burst of
 * renders backfilling the same milestone stops re-queuing it once the write
 * actually landed. Never cleared, since a successful backfill never needs to
 * run twice for a given session.
 */
const backfilledMilestoneKeys = new Set<string>();

/**
 * In-flight guard: a key lands here as soon as its write is queued, before
 * the write resolves, so a second render in the same tick doesn't queue a
 * duplicate write for a key that's already waiting its turn.
 */
const backfillQueuedKeys = new Set<string>();

/** Test-only reset, mirroring `resetContentKeyForTests` — clears both guards
 *  so each test starts from the same baseline instead of inheriting another
 *  test's backfilled or in-flight keys. */
export function resetMilestoneBackfillGuardForTests(): void {
  backfilledMilestoneKeys.clear();
  backfillQueuedKeys.clear();
}

/**
 * Belt-and-suspenders queue for every milestone-completion write THIS MODULE
 * makes (the legacy backfill and {@link markMilestoneDone}'s own write).
 * `interactiveCompletionStorage` (see bounded-record-storage.ts) already
 * serializes every write it receives regardless of caller, so this is no
 * longer required for correctness — but it keeps a fast, synchronous-looking
 * write ordering local to this module's own two writers without depending on
 * the storage layer's queue being awaited first, and keeps this module's
 * behavior identical if that guarantee ever moved back out of the storage
 * layer.
 */
let milestoneCompletionWriteQueue: Promise<unknown> = Promise.resolve();

function queueMilestoneCompletionWrite(contentKey: string, percentage: number): Promise<void> {
  const write = milestoneCompletionWriteQueue.then(() => interactiveCompletionStorage.set(contentKey, percentage));
  // Swallow so one failed write doesn't poison the queue for writes queued
  // after it; interactiveCompletionStorage.set already logs its own errors.
  milestoneCompletionWriteQueue = write.catch(() => undefined);
  return write;
}

/**
 * Migrates a legacy `milestoneCompletionStorage` completion into
 * `interactiveCompletionStorage`, once, so the two mechanisms this journey
 * predates converge onto the one the read side now relies on exclusively.
 *
 * Safe by construction: it only ever writes 100 (the maximum), only for a
 * milestone the legacy store already reports done, and only when the new
 * store doesn't already hold that value — so it can't lower or overwrite
 * real progress. The write is queued but not awaited by the caller (the
 * caller's own render already reflects the legacy completion this tick,
 * since it reads `milestoneCompletionStorage` directly too).
 * `backfilledMilestoneKeys` only gains the key once this write actually
 * resolves — so a render that fires before the first write lands re-queues
 * rather than silently no-ops on a write that never happened.
 */
function backfillLegacyMilestoneCompletion(contentKey: string, alreadyPersisted: number | undefined): void {
  if (alreadyPersisted === 100 || backfilledMilestoneKeys.has(contentKey) || backfillQueuedKeys.has(contentKey)) {
    return;
  }
  backfillQueuedKeys.add(contentKey);
  void queueMilestoneCompletionWrite(contentKey, 100).then(
    () => {
      backfillQueuedKeys.delete(contentKey);
      backfilledMilestoneKeys.add(contentKey);
      dispatchProgress({ kind: 'guide', contentKey, percentage: 100, hasProgress: true });
    },
    // interactiveCompletionStorage.set never rejects today (its own
    // setInternal swallows and logs), so this is a defensive backstop rather
    // than a reachable path: clear the in-flight guard instead of leaving the
    // key stuck queued forever if that ever changes.
    () => {
      backfillQueuedKeys.delete(contentKey);
    }
  );
}

/**
 * Each unlocked milestone's own percentage, in journey order — the per-member
 * half of {@link journeyProgressFromMilestones}, exposed so a surface that
 * paints one mark per milestone (the toolbar's segmented bar) reads the very
 * numbers the journey percentage is the mean of, rather than a second opinion
 * such as navigation position.
 *
 * Also the one place legacy `milestoneCompletionStorage` data (pre-dates the
 * guide-ID-keyed store) gets folded into `interactiveCompletionStorage`: both
 * the cover page and the toolbar call this, so a journey backfills the first
 * time either screen reads it.
 */
export function journeyMilestonePercentages(
  baseUrl: string,
  milestones: readonly Milestone[]
): readonly MilestonePercentage[] {
  const unlocked = milestones.filter((m) => !m.isLocked);
  if (unlocked.length === 0) {
    return [];
  }

  const members: PathMember[] = unlocked.map((m) => ({ id: getMilestoneSlug(m.url) ?? m.url, url: m.url }));
  // The milestone URLs resolve alias-keyed records the canonical base URL
  // alone would miss — the same argument the cover page's async read passes,
  // so both screens see one set of completed milestones.
  const legacyCompletedSlugs = milestoneCompletionStorage.getCompletedSync(
    baseUrl,
    milestones.map((m) => m.url)
  );
  const persistedPercentages = interactiveCompletionStorage.peekAll();
  const { members: resolved } = resolvePathMemberPercentages(members, {
    completedMemberIds: Array.from(legacyCompletedSlugs),
    // interactiveCompletionStorage, and only that — journeyCompletionStorage
    // holds no record under backend-guide: for a partially progressed
    // member, so joining against it would exclude every one of them.
    persistedPercentages,
  });

  for (const milestone of unlocked) {
    const slug = getMilestoneSlug(milestone.url);
    if (slug && legacyCompletedSlugs.has(slug)) {
      const contentKey = sanitizeContentKey(milestone.url);
      backfillLegacyMilestoneCompletion(contentKey, persistedPercentages[contentKey]);
    }
  }

  return unlocked.map((milestone, index) => ({ milestone, percent: resolved[index]?.percent }));
}

/**
 * The mean-of-members half of {@link journeyProgressFromMilestones}, taking
 * an already-resolved {@link journeyMilestonePercentages} result — so a
 * caller that needs both the per-milestone percentages and their mean (the
 * cover page) can call `journeyMilestonePercentages` once and derive both,
 * rather than computing it twice (once directly, once inside
 * `journeyProgressFromMilestones`).
 */
export function percentagesToProgress(percentages: readonly MilestonePercentage[]): number {
  const resolvedPercentages = percentages.flatMap(({ percent }) => (percent === undefined ? [] : [percent]));

  return meanOfMemberPercentages(resolvedPercentages).percent;
}

/**
 * The shared calculation behind {@link getJourneyProgress}, taking the
 * journey's own identity rather than a full `RawContent` — so the cover
 * page (`LearningPathTableOfContents`, which has `milestones` and `baseUrl`
 * but not a `RawContent`) computes the identical number rather than a
 * second, independent one. A reader must not see two different percentages
 * for the same journey on adjacent screens.
 */
export function journeyProgressFromMilestones(baseUrl: string, milestones: readonly Milestone[]): number {
  return percentagesToProgress(journeyMilestonePercentages(baseUrl, milestones));
}

/**
 * A journey's percentage: the mean of its unlocked milestones' own
 * percentages (docs/design/COMPLETION-MODEL.md, decision 4 applied to
 * milestones as path members). Not a navigation position — opening the
 * last milestone of a ten-milestone journey having completed nothing no
 * longer reports 100%.
 *
 * Each milestone is a member keyed by its own URL (decision 9's join), so
 * this reads the SAME per-milestone percentage the milestone reports for
 * itself as a guide. Locked milestones are excluded from both halves of the
 * mean — `totalMilestones` is the locked-inclusive display count, and using
 * it would make 100% unreachable on any partially published journey.
 */
export function getJourneyProgress(content: RawContent): number {
  if (content.type !== 'learning-journey' || !content.metadata.learningJourney) {
    return 0;
  }

  const lj = content.metadata.learningJourney;
  return journeyProgressFromMilestones(lj.baseUrl, lj.milestones);
}

export function isJourneyCoverPage(content: RawContent): boolean {
  if (content.type !== 'learning-journey' || !content.metadata.learningJourney) {
    return false;
  }

  return content.metadata.learningJourney.currentMilestone === 0;
}

export function isLastMilestone(content: RawContent): boolean {
  if (content.type !== 'learning-journey' || !content.metadata.learningJourney) {
    return false;
  }

  const { currentMilestone, milestones } = content.metadata.learningJourney;

  // "Last" = the highest-numbered UNLOCKED milestone. Locked (unpublished)
  // trailing members must not block a partially-published path from reaching its
  // final reachable step (which is what drives last-milestone auto-complete).
  const unlockedNumbers = milestones.filter((m) => !m.isLocked).map((m) => m.number);
  if (unlockedNumbers.length === 0) {
    return false;
  }
  return currentMilestone === Math.max(...unlockedNumbers);
}

/**
 * Number of navigable (unlocked) milestones. Locked members are placeholders for
 * unpublished content (RFC §6.5) and are unreachable; `totalMilestones` stays the
 * locked-inclusive display count.
 *
 * This is NOT the journey completion threshold. Completion is whole-set
 * membership of the current milestone URLs — see `markMilestoneDone` and
 * `journey-threshold-membership` — never a count, which stale URLs from a
 * renamed or reordered path can cross while current milestones are outstanding.
 */
export function countUnlockedMilestones(milestones: Milestone[]): number {
  return milestones.filter((m) => !m.isLocked).length;
}

export function isFirstMilestone(content: RawContent): boolean {
  if (content.type !== 'learning-journey' || !content.metadata.learningJourney) {
    return false;
  }

  const { currentMilestone } = content.metadata.learningJourney;

  // Since milestones are now sequentially numbered from 1, this is simple
  return currentMilestone === 1;
}

/**
 * Content enhancement helpers
 * These prepare content for rendering but don't manipulate DOM
 */
export function generateJourneyContentWithExtras(
  baseContent: string,
  metadata: LearningJourneyMetadata,
  skipReadyToBegin = false
): string {
  let enhancedContent = baseContent;

  // Add "Ready to Begin" button for cover pages (milestone 0), unless skipped
  if (!skipReadyToBegin && metadata.currentMilestone === 0 && metadata.totalMilestones > 0) {
    enhancedContent = addReadyToBeginButton(enhancedContent, metadata);
  }

  const currentMilestone = getCurrentMilestoneFromMetadata(metadata);

  // Add side journeys if present
  if (currentMilestone?.sideJourneys) {
    enhancedContent = appendSideJourneysToContent(enhancedContent, currentMilestone.sideJourneys);
  }

  // Add related journeys if present
  if (currentMilestone?.relatedJourneys) {
    enhancedContent = appendRelatedJourneysToContent(enhancedContent, currentMilestone.relatedJourneys);
  }

  // Add conclusion image if present
  if (currentMilestone?.conclusionImage) {
    enhancedContent = addConclusionImageToContent(enhancedContent, currentMilestone.conclusionImage);
  }

  // Add bottom navigation to all milestones including cover page (milestone 0)
  enhancedContent = appendBottomNavigationToContent(
    enhancedContent,
    metadata.currentMilestone,
    metadata.totalMilestones,
    metadata.milestones
  );

  return enhancedContent;
}

function getCurrentMilestoneFromMetadata(metadata: LearningJourneyMetadata): Milestone | null {
  return metadata.milestones.find((m) => m.number === metadata.currentMilestone) || null;
}

/**
 * Content appending functions
 * These generate HTML strings to append to content
 */
function addReadyToBeginButton(content: string, metadata: LearningJourneyMetadata): string {
  // The entry point is the first UNLOCKED milestone — a locked (unpublished)
  // milestone 1 has url:'' and would render the primary CTA as a dead button.
  // If nothing is published yet, emit no button.
  const firstMilestone = metadata.milestones.find((m) => !m.isLocked);

  if (!firstMilestone) {
    return content;
  }

  const readyToBeginHtml = `
    <div class="journey-ready-to-begin">
      <div class="journey-ready-container">
        <h3>Ready to begin?</h3>
        <button class="journey-ready-button" 
                data-journey-start="true" 
                data-milestone-url="${sanitizeHtmlUrl(firstMilestone.url)}">
          <span class="journey-ready-icon">▶</span>
          Ready to Begin
        </button>
        <p class="journey-ready-description">
          ${metadata.totalMilestones} milestone${metadata.totalMilestones !== 1 ? 's' : ''} • Interactive journey
        </p>
      </div>
    </div>
  `;

  return content + readyToBeginHtml;
}

function appendSideJourneysToContent(content: string, sideJourneys: SideJourneys): string {
  if (!sideJourneys.items || sideJourneys.items.length === 0) {
    return content;
  }

  const sideJourneysHtml = `
    <div class="journey-side-journeys">
      <h3 class="journey-side-journeys-title">${escapeHtml(sideJourneys.heading)}</h3>
      <ul class="journey-side-journeys-list">
        ${sideJourneys.items
          .map(
            (item) => `
          <li class="journey-side-journey-item">
            <a href="${sanitizeHtmlUrl(toAbsoluteGrafanaUrl(item.link))}" 
               target="_blank" 
               rel="noopener noreferrer"
               data-side-journey-link="true"
               class="journey-side-journey-link">
              ${escapeHtml(item.title)}
            </a>
          </li>
        `
          )
          .join('')}
      </ul>
    </div>
  `;

  return content + sideJourneysHtml;
}

function appendRelatedJourneysToContent(content: string, relatedJourneys: RelatedJourneys): string {
  if (!relatedJourneys.items || relatedJourneys.items.length === 0) {
    return content;
  }

  const relatedJourneysHtml = `
    <div class="journey-related-journeys">
      <h3 class="journey-related-journeys-title">${escapeHtml(relatedJourneys.heading)}</h3>
      <ul class="journey-related-journeys-list">
        ${relatedJourneys.items
          .map(
            (item) => `
          <li class="journey-related-journey-item">
            <a href="${sanitizeHtmlUrl(toAbsoluteGrafanaUrl(item.link))}"
               data-related-journey-link="true"
               class="journey-related-journey-link">
              ${escapeHtml(item.title)}
            </a>
          </li>
        `
          )
          .join('')}
      </ul>
    </div>
  `;

  return content + relatedJourneysHtml;
}

function addConclusionImageToContent(content: string, conclusionImage: ConclusionImage): string {
  const conclusionImageHtml = `
    <div class="journey-conclusion-image">
      <img src="${sanitizeHtmlUrl(conclusionImage.src)}" 
           alt="Journey conclusion" 
           width="${escapeHtml(String(conclusionImage.width))}" 
           height="${escapeHtml(String(conclusionImage.height))}"
           class="journey-conclusion-img" />
    </div>
  `;

  return content + conclusionImageHtml;
}

function appendBottomNavigationToContent(
  content: string,
  currentMilestone: number,
  totalMilestones: number,
  milestones: Milestone[]
): string {
  // "Last" for the Next control = no UNLOCKED milestone after the current one.
  // A locked trailing member isn't navigable, so rendering Next there would be a
  // dead control (the click handler's canNavigateNext already returns null).
  const isLastMilestone = !milestones.some((m) => m.number > currentMilestone && !m.isLocked);
  const isCoverPage = currentMilestone === 0;

  // Conditionally render Previous button (hide on cover page)
  const prevButton = isCoverPage
    ? ''
    : `
    <button class="btn btn--primary journey-nav-prev" 
            data-journey-nav="prev">
      ← Previous
    </button>
  `;

  // Conditionally render Next button (hide on last milestone)
  const nextButton = isLastMilestone
    ? ''
    : `
    <button class="btn btn--primary journey-nav-next" 
            data-journey-nav="next">
      Next →
    </button>
  `;

  // Show appropriate progress text
  const progressText = isCoverPage
    ? `Introduction (${totalMilestones} milestone${totalMilestones !== 1 ? 's' : ''})`
    : `Step ${currentMilestone} of ${totalMilestones}`;

  const navigationHtml = `
    <div class="journey-bottom-navigation">
      <div class="journey-bottom-nav-container">
        ${prevButton}
        <span class="journey-progress-text">${progressText}</span>
        ${nextButton}
      </div>
    </div>
  `;

  return content + navigationHtml;
}

/**
 * Journey completion percentage tracking
 *
 * These functions use the new user storage system which automatically:
 * - Uses Grafana's user storage API when available (11.5+)
 * - Falls back to localStorage for older versions
 * - Handles quota exhaustion with built-in cleanup
 * - Provides user-specific storage in Grafana database
 */

export async function getJourneyCompletionPercentageAsync(journeyBaseUrl: string): Promise<number> {
  return journeyCompletionStorage.get(journeyBaseUrl);
}

export function setJourneyCompletionPercentage(
  journeyBaseUrl: string,
  percentage: number,
  context?: CompletionContext
): void {
  const guideId = persistJourneyCompletionPercentage(journeyBaseUrl, percentage);
  if (guideId) {
    recordBundledGuideCompletion(guideId, context);
  }
}

export function setMilestoneCompletionPercentage(journeyBaseUrl: string, percentage: number): void {
  persistJourneyCompletionPercentage(journeyBaseUrl, percentage);
}

function isBackendGuideJourney(journeyBaseUrl: string): boolean {
  return journeyBaseUrl.startsWith('backend-guide:');
}

/**
 * Extract the guide id from a bundled journey base URL: strip the `bundled:`
 * prefix, then defer to the single shared `normalizeGuideId` for the
 * `/content.json` suffix so the writer records the SAME identity the reset path
 * derives. Do not inline the suffix strip here — that divergence is the bug.
 */
function guideIdFromBundledJourneyBase(journeyBaseUrl: string): string {
  return normalizeGuideId(journeyBaseUrl.replace('bundled:', ''));
}

function persistJourneyCompletionPercentage(journeyBaseUrl: string, percentage: number): string | undefined {
  if (isBackendGuideJourney(journeyBaseUrl)) {
    return undefined;
  }

  // Fire and forget - storage handles errors internally
  journeyCompletionStorage.set(journeyBaseUrl, percentage);

  // Update learning paths progress when a bundled guide reaches 100%
  if (percentage >= 100 && journeyBaseUrl.startsWith('bundled:')) {
    const guideId = guideIdFromBundledJourneyBase(journeyBaseUrl);
    markGuideCompleted(guideId);
    return guideId;
  }
  return undefined;
}

export async function setJourneyCompletionPercentageAsync(
  journeyBaseUrl: string,
  percentage: number,
  context?: CompletionContext
): Promise<void> {
  if (isBackendGuideJourney(journeyBaseUrl)) {
    return;
  }

  await journeyCompletionStorage.set(journeyBaseUrl, percentage);

  // Update learning paths progress when a bundled guide reaches 100%
  if (percentage >= 100 && journeyBaseUrl.startsWith('bundled:')) {
    const guideId = guideIdFromBundledJourneyBase(journeyBaseUrl);
    await markGuideCompleted(guideId);
    recordBundledGuideCompletion(guideId, context);
  }
}

function recordBundledGuideCompletion(guideId: string, context?: CompletionContext): void {
  const manifestType = context?.packageManifest?.type;
  if (manifestType === 'path' || manifestType === 'journey') {
    return;
  }
  const identity = resolveBundledGuideCompletionIdentity({
    packageManifest: context?.packageManifest,
    repository: context?.repository,
    guideId,
  });
  recordGuideCompletion({
    kind: 'guide',
    ...identity,
    guideTitle: context?.guideTitle ?? guideId,
    guideCategory: 'interactive',
    pathId: context?.pathId,
    completionPercent: 100,
    source: 'objectives',
    completedAt: new Date().toISOString(),
  });
}

export function recordStandaloneGuideCompletion(context: CompletionContext): void {
  // Journey-shaped packages complete via markMilestoneDone's journey trigger;
  // a guide-kind fact here would double-count them (same guard as the bundled path).
  const manifestType = context.packageManifest?.type;
  if (manifestType === 'path' || manifestType === 'journey') {
    return;
  }
  const guideId = manifestGuideId(context.packageManifest);
  if (!guideId) {
    return;
  }
  const identity = resolveStandaloneGuideCompletionIdentity({
    packageManifest: context.packageManifest,
    repository: context.repository,
    guideId,
  });
  recordGuideCompletion({
    kind: 'guide',
    ...identity,
    guideTitle: context.guideTitle ?? guideId,
    guideCategory: 'interactive',
    pathId: context.pathId,
    completionPercent: 100,
    source: 'objectives',
    completedAt: new Date().toISOString(),
  });
}

/**
 * Identity a surface hands the shared completion controller when its rendered
 * guide reaches 100%. Every field is view-level state the surface already owns;
 * the completion DECISION (bundled vs remote, milestone-as-guide vs standalone,
 * whole-journey membership) lives here so it is identical across the sidebar,
 * floating, full-screen, and guide-reader surfaces — a surface is only a view
 * affordance, so completing a guide in any of them records the same fact.
 */
export interface SurfaceCompletionInput {
  /**
   * activeTab.baseUrl — the SURFACE base, which is the milestone URL when a tab
   * was opened directly at a milestone. Drives bundled progress only; the
   * milestone storage key is `metadata.learningJourney.baseUrl` (the resolved
   * cover URL every other milestone writer keys on).
   */
  baseUrl?: string;
  /** content.url — fallback surface base for bundled detection when the tab has none. */
  contentUrl?: string;
  /** activeTab.currentUrl — the milestone URL used to derive the milestone slug. */
  currentUrl?: string;
  /** content.type — 'learning-journey' selects the milestone-as-guide path. */
  contentType?: string;
  /** content.metadata — carries packageManifest, repository, and learningJourney. */
  metadata?: ContentMetadata;
  /** activeTab.title. */
  guideTitle?: string;
}

/**
 * The milestone slug for the given content, iff it names a learning-journey
 * milestone under a resolvable journey base — otherwise `undefined`. This is
 * the ONE predicate for "is this a milestone, and under what slug", shared by
 * the writer ({@link recordGuideCompletionForSurface}, which calls
 * `markMilestoneDone` exactly when this resolves) and any reader that needs
 * to agree with it — the reset path in particular. A caller that re-derived
 * this check independently could disagree with the writer about which
 * content counts as a milestone, which is the same class of drift the
 * identity-derivation split above exists to prevent.
 *
 * Deliberately does NOT gate on `contentType === 'learning-journey'` — a
 * caller's own content-type classification is exactly the thing that can
 * disagree between the writer and a reset site (a path member opened
 * through a route that does not tag it that way still has a real
 * `learningJourney.baseUrl` once its content resolves). `journeyBaseUrl`
 * being resolvable is the one signal that is always true when this is
 * genuinely a milestone, regardless of how the caller classified the tab.
 */
export function resolveActiveMilestoneSlug(input: {
  currentUrl?: string;
  journeyBaseUrl?: string;
}): string | undefined {
  const slug = input.currentUrl ? getMilestoneSlug(input.currentUrl) : '';
  return slug && input.journeyBaseUrl ? slug : undefined;
}

/**
 * The single surface-neutral completion emitter. Wired by each content-owning
 * component (DocsPanelContentArea, FloatingPanelContent, GuideReaderOverlay) so
 * every surface routes terminal completion through the same decision, rather
 * than each surface re-deciding (or forgetting to emit).
 */
export function recordGuideCompletionForSurface(input: SurfaceCompletionInput): void {
  const { baseUrl, contentUrl, currentUrl, metadata, guideTitle } = input;
  // Two distinct keys: the surface base a tab happens to be pinned at, and the
  // journey's resolved cover URL that milestone progress is stored under.
  const surfaceBase = baseUrl || contentUrl;
  const journeyBase = metadata?.learningJourney?.baseUrl;
  const slug = resolveActiveMilestoneSlug({ currentUrl, journeyBaseUrl: journeyBase }) ?? '';
  const willMarkMilestone = Boolean(slug && journeyBase);
  const completionContext: CompletionContext = {
    packageManifest: metadata?.packageManifest,
    repository: metadata?.repository,
    guideTitle,
  };
  if (surfaceBase?.startsWith('bundled:')) {
    if (willMarkMilestone) {
      setMilestoneCompletionPercentage(surfaceBase, 100);
    } else {
      setJourneyCompletionPercentage(surfaceBase, 100, completionContext);
    }
  }
  if (willMarkMilestone && journeyBase) {
    void markMilestoneDone(
      journeyBase,
      slug,
      currentUrl!,
      metadata?.learningJourney?.milestones?.filter((m) => !m.isLocked).map((m) => m.url),
      completionContext
    );
    // The recommendation card reads journeyCompletionStorage directly
    // (context.service.ts), never the shared calculation, and the only other
    // writer is the content-load seam (docs-panel.tsx) — so without this, the
    // card's number trails by however much was earned since the journey was
    // last opened, for every journey shape except backend-guide (which gets
    // its own refresh on full completion). Refreshing here on every milestone
    // keeps it live for the rest too (journey-percentage-diverges-on
    // -recommendation-card). A no-op for a backend-guide base, which
    // persistJourneyCompletionPercentage already declines to write.
    if (metadata?.learningJourney) {
      const freshJourneyProgress = journeyProgressFromMilestones(journeyBase, metadata.learningJourney.milestones ?? []);
      setJourneyCompletionPercentage(journeyBase, freshJourneyProgress, completionContext);
    }
  } else if (!surfaceBase?.startsWith('bundled:')) {
    recordStandaloneGuideCompletion(completionContext);
  }
}

export function clearJourneyCompletion(journeyBaseUrl: string): void {
  // Fire and forget - storage handles errors internally
  journeyCompletionStorage.clear(journeyBaseUrl);
}

export async function clearJourneyCompletionAsync(journeyBaseUrl: string): Promise<void> {
  return journeyCompletionStorage.clear(journeyBaseUrl);
}

export function getAllJourneyCompletions(): Record<string, number> {
  // Note: This is now async but wrapped to maintain backward compatibility
  let result: Record<string, number> = {};
  journeyCompletionStorage.getAll().then((completions) => {
    result = completions;
  });
  return result;
}

export async function getAllJourneyCompletionsAsync(): Promise<Record<string, number>> {
  return journeyCompletionStorage.getAll();
}

// ============================================================================
// MILESTONE COMPLETION HELPERS
// ============================================================================

/**
 * Canonicalizes a milestone URL to the manifest's own spelling for that
 * milestone (matched by slug) before turning it into a content key, so a
 * completion is written and read under the SAME key regardless of which
 * launch URL variant reached this call. `currentUrl` can be
 * `.../m1/content.json` (the package-content-json launch) while the
 * manifest's own `milestone.url` for the same milestone is `.../m1/` —
 * different strings, so different sanitized content keys, so a completion
 * recorded under one variant would be invisible to the cover page, the
 * toolbar, and the whole-journey membership check below, all of which read
 * by the manifest's own URL. Falls back to the input URL's own key when no
 * canonical match is available (no expected list, or a slug the list
 * doesn't contain) — unchanged behavior for those callers.
 */
function resolveMilestoneContentKey(url: string, expectedMilestoneUrls?: readonly string[]): string {
  const slug = getMilestoneSlug(url);
  const canonicalUrl = slug
    ? expectedMilestoneUrls?.find((candidate) => getMilestoneSlug(candidate) === slug)
    : undefined;
  return sanitizeContentKey(canonicalUrl ?? url);
}

/**
 * Marks a learning journey milestone as completed.
 * - Persists the milestone's own percentage (100) in
 *   `interactiveCompletionStorage`, keyed by the canonical (manifest-spelling)
 *   content key {@link resolveMilestoneContentKey} resolves — the same key
 *   `journeyMilestonePercentages`/`resolvePathMemberPercentages` read back, so
 *   the toolbar segment and My Learning's rollup never disagree with what
 *   this just recorded, regardless of which launch URL variant got here.
 * - Calls markGuideCompleted (learning-paths/badge-coordinator) to bridge to the badge/progress system
 * - When `expectedMilestoneUrls` is provided and EVERY one is present in stored
 *   progress, awards the path badge and fires the whole-journey record. Membership
 *   (not a bare count) is required so stale/renamed/removed milestone URLs left
 *   over from an earlier journey revision cannot satisfy the threshold and write
 *   a false durable journey record.
 */
export async function markMilestoneDone(
  journeyBaseUrl: string,
  milestoneSlug: string,
  milestoneUrl: string,
  expectedMilestoneUrls?: readonly string[],
  context?: CompletionContext
): Promise<void> {
  if (!milestoneSlug) {
    return;
  }
  const contentKey = resolveMilestoneContentKey(milestoneUrl, expectedMilestoneUrls);
  // Queued (not a bare `set`) so this write is ordered after any legacy
  // backfill this journey's own render queued moments earlier — see
  // {@link queueMilestoneCompletionWrite}. interactiveCompletionStorage
  // itself also serializes every write it receives regardless of caller
  // (bounded-record-storage.ts), so this can't race and lose either key even
  // without this module's own queue.
  await queueMilestoneCompletionWrite(contentKey, 100);
  dispatchProgress({ kind: 'guide', contentKey, percentage: 100, hasProgress: true });
  // Local-cache/UX duty (badges, streak) — unchanged.
  await markGuideCompleted(milestoneSlug);

  // Completion-emission boundary for the milestone-as-guide path.
  //
  // Accepted for the MVP, not an oversight: the durable key is the bare final URL
  // segment, unqualified by the owning journey, so two journeys under the same
  // source that share a milestone slug produce the same key and conflate in the
  // warehouse. Local progress is unaffected — milestone progress is stored per
  // journey base URL — so a collision never grants unearned credit. Tracked for
  // RFC reconciliation.
  const milestoneIdentity = resolveMilestoneCompletionIdentity({
    repository: context?.repository,
    packageManifest: context?.packageManifest,
    milestoneSlug,
  });
  recordGuideCompletion({
    kind: 'guide',
    ...milestoneIdentity,
    guideTitle: context?.guideTitle ?? milestoneSlug,
    guideCategory: 'learning-journey',
    pathId: context?.pathId,
    completionPercent: 100,
    source: 'objectives',
    completedAt: new Date().toISOString(),
  });

  // Whole-journey completion: award the path badge and fire the journey trigger
  // only when every CURRENTLY-expected milestone URL is complete. URL-based paths
  // have guides: [] in static data, so the normal badge flow cannot detect
  // completion here. Membership (not a bare count) rejects stale, renamed, or
  // removed milestone URLs left over from an earlier journey revision.
  if (expectedMilestoneUrls && expectedMilestoneUrls.length > 0) {
    const completions = await interactiveCompletionStorage.getAll();
    // A milestone completed before this journey's cover page or toolbar
    // ever rendered — the only two callers of journeyMilestonePercentages,
    // which is the usual place a legacy completion backfills into
    // interactiveCompletionStorage (GuideReaderOverlay renders no toolbar
    // and can still call markMilestoneDone) — would otherwise still be
    // legacy-only here. Consult milestoneCompletionStorage directly as a
    // fallback rather than assuming some other surface already converged
    // it, and queue the same backfill write journeyMilestonePercentages
    // would have made so later readers see it too.
    const legacyCompletedSlugs = milestoneCompletionStorage.getCompletedSync(
      journeyBaseUrl,
      expectedMilestoneUrls as string[]
    );
    // Same resolver as the write above: every expected URL is already the
    // manifest's own canonical spelling, so this is normally a no-op pass
    // through it, but sharing the function keeps both sides of the
    // membership check provably aligned rather than independently correct.
    const allMilestonesDone = expectedMilestoneUrls.every((url) => {
      const key = resolveMilestoneContentKey(url, expectedMilestoneUrls);
      const persisted = completions[key];
      if ((persisted ?? 0) >= 100) {
        return true;
      }
      const slug = getMilestoneSlug(url);
      if (slug && legacyCompletedSlugs.has(slug)) {
        backfillLegacyMilestoneCompletion(key, persisted);
        return true;
      }
      return false;
    });
    if (allMilestonesDone) {
      if (journeyBaseUrl.startsWith('backend-guide:')) {
        await journeyCompletionStorage.set(journeyBaseUrl, 100);
      }

      const path = findPathByUrl(journeyBaseUrl);
      if (path?.badgeId) {
        await learningProgressStorage.awardBadge(path.badgeId);
      }

      // The `journey_completed` trigger, keyed on the journey identity and
      // deduped exactly-once by the recorder so a re-crossed threshold does not
      // re-emit. Fail closed when neither a manifest id nor a curated path id
      // resolves: a loader URL is never an acceptable identity (types.ts
      // contract), and a URL-keyed fact would become a permanently wrong durable key.
      const stableJourneyId = manifestGuideId(context?.packageManifest) ?? path?.id;
      if (stableJourneyId) {
        const journeyIdentity = resolveJourneyCompletionIdentity({
          packageManifest: context?.packageManifest,
          repository: context?.repository,
          guideId: stableJourneyId,
        });
        recordJourneyCompletion({
          kind: 'journey',
          ...journeyIdentity,
          guideTitle: context?.guideTitle ?? path?.title ?? journeyIdentity.guideId,
          guideCategory: 'learning-journey',
          pathId: context?.pathId ?? path?.id,
          completionPercent: 100,
          source: 'objectives',
          completedAt: new Date().toISOString(),
        });
      }
    }
  }
}
