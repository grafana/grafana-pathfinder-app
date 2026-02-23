// Learning Journey Helper Functions
// Extracted from docs-fetcher.ts but focused on metadata operations only
// No DOM processing - just data manipulation and navigation logic

import {
  RawContent,
  Milestone,
  LearningJourneyMetadata,
  SideJourneys,
  RelatedJourneys,
  ConclusionImage,
} from '../types/content.types';
import { journeyCompletionStorage, milestoneCompletionStorage, learningProgressStorage } from '../lib/user-storage';
import { escapeHtml, sanitizeHtmlUrl } from '../security/html-sanitizer';

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
            <a href="${sanitizeHtmlUrl(item.link)}" 
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
            <a href="${sanitizeHtmlUrl(item.link)}"
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

export function setJourneyCompletionPercentage(journeyBaseUrl: string, percentage: number): void {
  // Fire and forget - storage handles errors internally
  journeyCompletionStorage.set(journeyBaseUrl, percentage);

  // Update learning paths progress when a bundled guide reaches 100%
  if (percentage >= 100 && journeyBaseUrl.startsWith('bundled:')) {
    const guideId = journeyBaseUrl.replace('bundled:', '');
    // Fire and forget - learning paths storage handles errors internally
    learningProgressStorage.markGuideCompleted(guideId);
  }
}

export async function setJourneyCompletionPercentageAsync(journeyBaseUrl: string, percentage: number): Promise<void> {
  await journeyCompletionStorage.set(journeyBaseUrl, percentage);

  // Update learning paths progress when a bundled guide reaches 100%
  if (percentage >= 100 && journeyBaseUrl.startsWith('bundled:')) {
    const guideId = journeyBaseUrl.replace('bundled:', '');
    await learningProgressStorage.markGuideCompleted(guideId);
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
 * Extracts the milestone slug (guide ID) from a milestone URL.
 * e.g. "https://grafana.com/docs/learning-paths/linux-server-integration/select-platform/" -> "select-platform"
 * e.g. "https://grafana.com/docs/.../select-platform/content.json" -> "select-platform"
 */
export function getMilestoneSlug(milestoneUrl: string): string {
  // Strip content.json or unstyled.html suffixes added during content fetching
  const cleanUrl = milestoneUrl.replace(/\/(content\.json|unstyled\.html)$/, '');
  const segments = cleanUrl.replace(/\/+$/, '').split('/');
  return segments[segments.length - 1] || '';
}

/**
 * Marks a learning journey milestone as completed.
 * - Persists the milestone slug in milestoneCompletionStorage
 * - Calls learningProgressStorage.markGuideCompleted to bridge to the learning paths badge/progress system
 * - When totalMilestones is provided and all milestones are done, awards the path badge
 *   (URL-based paths have guides: [] in static data so the normal badge flow cannot detect completion)
 */
export async function markMilestoneDone(
  journeyBaseUrl: string,
  milestoneSlug: string,
  totalMilestones?: number
): Promise<void> {
  if (!milestoneSlug) {
    return;
  }
  await milestoneCompletionStorage.markCompleted(journeyBaseUrl, milestoneSlug);
  await learningProgressStorage.markGuideCompleted(milestoneSlug);

  // Award the path badge when all milestones in the journey are complete
  if (totalMilestones && totalMilestones > 0) {
    const completed = await milestoneCompletionStorage.getCompleted(journeyBaseUrl);
    if (completed.size >= totalMilestones) {
      const { getPathsData } = await import('../learning-paths');
      const normalizedBase = journeyBaseUrl.replace(/\/+$/, '');
      const path = getPathsData().paths.find((p) => p.url && normalizedBase === p.url.replace(/\/+$/, ''));
      if (path?.badgeId) {
        await learningProgressStorage.awardBadge(path.badgeId);
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
