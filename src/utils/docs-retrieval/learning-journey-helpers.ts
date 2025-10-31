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
} from './content.types';
import { journeyCompletionStorage } from '../../lib/user-storage';

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
export function generateJourneyContentWithExtras(baseContent: string, metadata: LearningJourneyMetadata): string {
  let enhancedContent = baseContent;

  // Add "Ready to Begin" button for cover pages (milestone 0)
  if (metadata.currentMilestone === 0 && metadata.totalMilestones > 0) {
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

  // Add bottom navigation (only for milestone pages, not cover pages)
  if (metadata.currentMilestone > 0) {
    enhancedContent = appendBottomNavigationToContent(
      enhancedContent,
      metadata.currentMilestone,
      metadata.totalMilestones
    );
  }

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
                data-milestone-url="${firstMilestone.url}">
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
      <h3 class="journey-side-journeys-title">${sideJourneys.heading}</h3>
      <ul class="journey-side-journeys-list">
        ${sideJourneys.items
          .map(
            (item) => `
          <li class="journey-side-journey-item">
            <a href="${item.link}" 
               target="_blank" 
               rel="noopener noreferrer"
               data-side-journey-link="true"
               class="journey-side-journey-link">
              ${item.title}
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
      <h3 class="journey-related-journeys-title">${relatedJourneys.heading}</h3>
      <ul class="journey-related-journeys-list">
        ${relatedJourneys.items
          .map(
            (item) => `
          <li class="journey-related-journey-item">
            <a href="${item.link}"
               data-related-journey-link="true"
               class="journey-related-journey-link">
              ${item.title}
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
      <img src="${conclusionImage.src}" 
           alt="Journey conclusion" 
           width="${conclusionImage.width}" 
           height="${conclusionImage.height}"
           class="journey-conclusion-img" />
    </div>
  `;

  return content + conclusionImageHtml;
}

function appendBottomNavigationToContent(content: string, currentMilestone: number, totalMilestones: number): string {
  // Don't show navigation for cover pages (milestone 0)
  if (currentMilestone === 0) {
    return content;
  }

  const isLastMilestone = currentMilestone === totalMilestones;

  // Conditionally render Previous button (primary style, always show)
  const prevButton = `
    <button class="btn btn--primary journey-nav-prev" 
            data-journey-nav="prev">
      ← Previous
    </button>
  `;

  // Conditionally render Next button (primary style, hide on last milestone)
  const nextButton = isLastMilestone
    ? ''
    : `
    <button class="btn btn--primary journey-nav-next" 
            data-journey-nav="next">
      Next →
    </button>
  `;

  const navigationHtml = `
    <div class="journey-bottom-navigation">
      <div class="journey-bottom-nav-container">
        ${prevButton}
        <span class="journey-progress-text">Step ${currentMilestone} of ${totalMilestones}</span>
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
}

export async function setJourneyCompletionPercentageAsync(journeyBaseUrl: string, percentage: number): Promise<void> {
  return journeyCompletionStorage.set(journeyBaseUrl, percentage);
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
