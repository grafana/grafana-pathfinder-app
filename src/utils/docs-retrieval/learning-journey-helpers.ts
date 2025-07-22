// Learning Journey Helper Functions
// Extracted from docs-fetcher.ts but focused on metadata operations only
// No DOM processing - just data manipulation and navigation logic

import { 
  RawContent, 
  Milestone, 
  LearningJourneyMetadata,
  SideJourneys,
  RelatedJourneys,
  ConclusionImage
} from './content.types';

/**
 * Navigation helpers - these work with metadata, not DOM
 */
export function getNextMilestoneUrl(content: RawContent): string | null {
  if (content.type !== 'learning-journey' || !content.metadata.learningJourney) {
    return null;
  }

  const { currentMilestone, milestones } = content.metadata.learningJourney;
  
  if (currentMilestone < milestones.length) {
    const nextMilestone = milestones.find(m => m.number === currentMilestone + 1);
    return nextMilestone ? nextMilestone.url : null;
  }
  
  return null;
}

export function getPreviousMilestoneUrl(content: RawContent): string | null {
  if (content.type !== 'learning-journey' || !content.metadata.learningJourney) {
    return null;
  }

  const { currentMilestone, milestones } = content.metadata.learningJourney;
  
  if (currentMilestone > 1) {
    const prevMilestone = milestones.find(m => m.number === currentMilestone - 1);
    return prevMilestone ? prevMilestone.url : null;
  } else if (currentMilestone === 1) {
    // Go back to cover page (milestone 0)
    return content.metadata.learningJourney.baseUrl;
  }
  
  return null;
}

export function getCurrentMilestone(content: RawContent): Milestone | null {
  if (content.type !== 'learning-journey' || !content.metadata.learningJourney) {
    return null;
  }

  const { currentMilestone, milestones } = content.metadata.learningJourney;
  return milestones.find(m => m.number === currentMilestone) || null;
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
  
  if (totalMilestones === 0) {return 0;}
  
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
  return currentMilestone === totalMilestones;
}

export function isFirstMilestone(content: RawContent): boolean {
  if (content.type !== 'learning-journey' || !content.metadata.learningJourney) {
    return false;
  }

  return content.metadata.learningJourney.currentMilestone === 1;
}

/**
 * Content enhancement helpers
 * These prepare content for rendering but don't manipulate DOM
 */
export function generateJourneyContentWithExtras(
  baseContent: string, 
  metadata: LearningJourneyMetadata
): string {
  let enhancedContent = baseContent;

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

  // Add bottom navigation
  enhancedContent = appendBottomNavigationToContent(
    enhancedContent,
    metadata.currentMilestone,
    metadata.totalMilestones
  );

  return enhancedContent;
}

function getCurrentMilestoneFromMetadata(metadata: LearningJourneyMetadata): Milestone | null {
  return metadata.milestones.find(m => m.number === metadata.currentMilestone) || null;
}

/**
 * Content appending functions
 * These generate HTML strings to append to content
 */
function appendSideJourneysToContent(content: string, sideJourneys: SideJourneys): string {
  if (!sideJourneys.items || sideJourneys.items.length === 0) {
    return content;
  }

  const sideJourneysHtml = `
    <div class="journey-side-journeys">
      <h3 class="journey-side-journeys-title">${sideJourneys.heading}</h3>
      <ul class="journey-side-journeys-list">
        ${sideJourneys.items.map(item => `
          <li class="journey-side-journey-item">
            <a href="${item.link}" 
               target="_blank" 
               rel="noopener noreferrer"
               data-side-journey-link="true"
               class="journey-side-journey-link">
              ${item.title}
            </a>
          </li>
        `).join('')}
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
        ${relatedJourneys.items.map(item => `
          <li class="journey-related-journey-item">
            <a href="${item.link}"
               data-related-journey-link="true"
               class="journey-related-journey-link">
              ${item.title}
            </a>
          </li>
        `).join('')}
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

function appendBottomNavigationToContent(
  content: string, 
  currentMilestone: number, 
  totalMilestones: number
): string {
  const hasNext = currentMilestone < totalMilestones;
  const hasPrev = currentMilestone > 0;

  // Don't show navigation for cover pages (milestone 0)
  if (currentMilestone === 0) {
    return content;
  }

  if (!hasNext && !hasPrev) {
    return content;
  }

  const navigationHtml = `
    <div class="journey-bottom-navigation">
      <div class="journey-bottom-nav-container">
        ${hasPrev ? `
          <button class="journey-bottom-nav-button journey-nav-prev" 
                  data-journey-nav="prev">
            ← Previous
          </button>
        ` : '<div class="journey-nav-spacer"></div>'}
        
        <div class="journey-progress-indicator">
          ${currentMilestone} of ${totalMilestones}
        </div>
        
        ${hasNext ? `
          <button class="journey-bottom-nav-button journey-nav-next" 
                  data-journey-nav="next">
            Next →
          </button>
        ` : '<div class="journey-nav-spacer"></div>'}
      </div>
    </div>
  `;

  return content + navigationHtml;
}

/**
 * Cache completion percentage tracking
 * These functions manage progress state in localStorage
 */
const COMPLETION_STORAGE_KEY = 'grafana-docs-plugin-journey-completion';

export function getJourneyCompletionPercentage(journeyBaseUrl: string): number {
  try {
    const completionData = JSON.parse(localStorage.getItem(COMPLETION_STORAGE_KEY) || '{}');
    return completionData[journeyBaseUrl] || 0;
  } catch {
    return 0;
  }
}

export function setJourneyCompletionPercentage(journeyBaseUrl: string, percentage: number): void {
  try {
    const completionData = JSON.parse(localStorage.getItem(COMPLETION_STORAGE_KEY) || '{}');
    completionData[journeyBaseUrl] = Math.max(0, Math.min(100, percentage));
    localStorage.setItem(COMPLETION_STORAGE_KEY, JSON.stringify(completionData));
  } catch (error) {
    console.warn('Failed to save journey completion percentage:', error);
  }
}

export function clearJourneyCompletion(journeyBaseUrl: string): void {
  try {
    const completionData = JSON.parse(localStorage.getItem(COMPLETION_STORAGE_KEY) || '{}');
    delete completionData[journeyBaseUrl];
    localStorage.setItem(COMPLETION_STORAGE_KEY, JSON.stringify(completionData));
  } catch (error) {
    console.warn('Failed to clear journey completion:', error);
  }
}

export function getAllJourneyCompletions(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(COMPLETION_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
} 
