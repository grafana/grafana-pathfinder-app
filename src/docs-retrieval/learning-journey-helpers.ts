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
import { journeyCompletionStorage, milestoneCompletionStorage, learningProgressStorage } from '../lib/user-storage';
// Pre-existing lateral edge documented in ALLOWED_LATERAL_VIOLATIONS
// (architecture.test.ts). This file already calls into `learning-paths`
// via several dynamic imports — moving the badge coordinator behind a
// stable named import keeps that surface explicit instead of hidden in
// `await import(...)` calls scattered through the module.
// eslint-disable-next-line no-restricted-imports
import { markGuideCompleted } from '../learning-paths';
import {
  recordGuideCompletion,
  recordJourneyCompletion,
  resolveCompletionIdentity,
  manifestGuideId,
  manifestGuideSource,
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

  // Since milestones are now sequentially numbered from 1, we can use simple logic
  const nextMilestone = milestones.find((m) => m.number === currentMilestone + 1);
  return nextMilestone ? nextMilestone.url : null;
}

export function getPreviousMilestoneUrl(content: RawContent): string | null {
  if (content.type !== 'learning-journey' || !content.metadata.learningJourney) {
    return null;
  }

  const { currentMilestone, milestones, baseUrl } = content.metadata.learningJourney;

  // Since milestones are now sequentially numbered from 1, we can use simple logic
  if (currentMilestone > 1) {
    const prevMilestone = milestones.find((m) => m.number === currentMilestone - 1);
    return prevMilestone ? prevMilestone.url : null;
  } else if (currentMilestone === 1) {
    // Go back to cover page (milestone 0)
    return baseUrl;
  }

  return null;
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
export function getJourneyProgress(content: RawContent): number {
  if (content.type !== 'learning-journey' || !content.metadata.learningJourney) {
    return 0;
  }

  const { currentMilestone, totalMilestones } = content.metadata.learningJourney;

  if (totalMilestones === 0) {
    return 0;
  }

  return Math.round((currentMilestone / totalMilestones) * 100);
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

  const { currentMilestone, totalMilestones } = content.metadata.learningJourney;

  // Since milestones are now sequentially numbered from 1, this is simple
  return currentMilestone === totalMilestones;
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
    metadata.totalMilestones
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
  // Since milestones are now sequentially numbered from 1,
  // the first milestone is always the one with number === 1
  const firstMilestone = metadata.milestones.find((m) => m.number === 1);

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

function appendBottomNavigationToContent(content: string, currentMilestone: number, totalMilestones: number): string {
  const isLastMilestone = currentMilestone === totalMilestones;
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

export function getJourneyCompletionPercentage(journeyBaseUrl: string): number {
  // Note: This is now async but wrapped to maintain backward compatibility
  // The storage operation will resolve quickly from cache
  let result = 0;
  journeyCompletionStorage.get(journeyBaseUrl).then((percentage) => {
    result = percentage;
  });
  return result;
}

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

function persistJourneyCompletionPercentage(journeyBaseUrl: string, percentage: number): string | undefined {
  // Fire and forget - storage handles errors internally
  journeyCompletionStorage.set(journeyBaseUrl, percentage);

  // Update learning paths progress when a bundled guide reaches 100%
  if (percentage >= 100 && journeyBaseUrl.startsWith('bundled:')) {
    const guideId = journeyBaseUrl.replace('bundled:', '');
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
  await journeyCompletionStorage.set(journeyBaseUrl, percentage);

  // Update learning paths progress when a bundled guide reaches 100%
  if (percentage >= 100 && journeyBaseUrl.startsWith('bundled:')) {
    const guideId = journeyBaseUrl.replace('bundled:', '');
    await markGuideCompleted(guideId);
    recordBundledGuideCompletion(guideId, context);
  }
}

function recordBundledGuideCompletion(guideId: string, context?: CompletionContext): void {
  const manifestType = context?.packageManifest?.type;
  if (manifestType === 'path' || manifestType === 'journey') {
    return;
  }
  const identity = resolveCompletionIdentity({
    packageManifest: context?.packageManifest,
    repository: context?.repository,
    fallbackId: guideId,
    fallbackSource: 'bundled',
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
  const identity = resolveCompletionIdentity({
    packageManifest: context.packageManifest,
    repository: context.repository,
    fallbackId: guideId,
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
 * The single surface-neutral completion emitter. Wired by each content-owning
 * component (DocsPanelContentArea, FloatingPanelContent, GuideReaderOverlay) so
 * every surface routes terminal completion through the same decision, rather
 * than each surface re-deciding (or forgetting to emit).
 */
export function recordGuideCompletionForSurface(input: SurfaceCompletionInput): void {
  const { baseUrl, contentUrl, currentUrl, contentType, metadata, guideTitle } = input;
  // Two distinct keys: the surface base a tab happens to be pinned at, and the
  // journey's resolved cover URL that milestone progress is stored under.
  const surfaceBase = baseUrl || contentUrl;
  const journeyBase = metadata?.learningJourney?.baseUrl;
  const slug = contentType === 'learning-journey' && currentUrl ? getMilestoneSlug(currentUrl) : '';
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
      resolveExpectedMilestoneIds(metadata?.learningJourney),
      completionContext
    );
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
 * The slugs of every milestone the current journey manifest declares. This is
 * the authoritative expected set for whole-journey completion: milestone
 * builders number the list 1..N (no cover page), and each milestone's slug
 * matches the slug stored when it completes (`getMilestoneSlug(currentUrl)`).
 * Passing this set — rather than a bare count — to {@link markMilestoneDone}
 * is what lets a revised journey reject stale/renamed/removed milestone slugs
 * instead of letting them satisfy a count-only threshold with a false record.
 */
export function resolveExpectedMilestoneIds(lj?: Pick<LearningJourneyMetadata, 'milestones'>): string[] {
  if (!lj?.milestones) {
    return [];
  }
  const ids = lj.milestones.map((m) => getMilestoneSlug(m.url)).filter((slug): slug is string => Boolean(slug));
  return Array.from(new Set(ids));
}

/**
 * Marks a learning journey milestone as completed.
 * - Persists the milestone slug in milestoneCompletionStorage
 * - Calls markGuideCompleted (learning-paths/badge-coordinator) to bridge to the badge/progress system
 * - When `expectedMilestoneIds` is provided and EVERY one is present in stored
 *   progress, awards the path badge and fires the whole-journey record. Membership
 *   (not a bare count) is required so stored slugs from an earlier revision of the
 *   journey cannot satisfy the threshold and write a false durable journey record.
 *   Resolve the set with {@link resolveExpectedMilestoneIds} at the call site.
 */
export async function markMilestoneDone(
  journeyBaseUrl: string,
  milestoneSlug: string,
  expectedMilestoneIds?: readonly string[],
  context?: CompletionContext
): Promise<void> {
  if (!milestoneSlug) {
    return;
  }
  await milestoneCompletionStorage.markCompleted(journeyBaseUrl, milestoneSlug);
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
  const milestoneIdentity = resolveCompletionIdentity({
    repository: context?.repository ?? manifestGuideSource(context?.packageManifest),
    fallbackId: milestoneSlug,
    fallbackSource: 'bundled',
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
  // only when every CURRENTLY-expected milestone slug is present. URL-based paths
  // have guides: [] in static data, so the normal badge flow cannot detect
  // completion here. Membership (not `completed.size >= count`) rejects stale,
  // renamed, or removed milestone slugs left over from an earlier journey revision.
  if (expectedMilestoneIds && expectedMilestoneIds.length > 0) {
    const completed = await milestoneCompletionStorage.getCompleted(journeyBaseUrl);
    if (expectedMilestoneIds.every((id) => completed.has(id))) {
      const { getPathsData } = await import('../learning-paths');
      const normalizedBase = journeyBaseUrl.replace(/\/+$/, '');
      const path = getPathsData().paths.find((p) => p.url && normalizedBase === p.url.replace(/\/+$/, ''));
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
        const journeyIdentity = resolveCompletionIdentity({
          packageManifest: context?.packageManifest,
          repository: context?.repository,
          fallbackId: stableJourneyId,
          fallbackSource: 'bundled',
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

/**
 * Checks if a milestone has already been completed.
 */
export async function isMilestoneCompleted(journeyBaseUrl: string, milestoneSlug: string): Promise<boolean> {
  return milestoneCompletionStorage.isCompleted(journeyBaseUrl, milestoneSlug);
}
