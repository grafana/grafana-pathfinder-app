// Metadata extraction for fetched documentation content.
// String-based parsing (no DOM); extracts titles, summaries, and learning-journey
// milestone metadata for the unified content fetcher.
import {
  ContentMetadata,
  ContentType,
  LearningJourneyMetadata,
  SingleDocMetadata,
  Milestone,
} from '../../types/content.types';
import { getLearningJourneyBaseUrl, urlsMatch } from './url-utils';
import { logger } from '../../lib/logging';

/**
 * Extract metadata from HTML without DOM processing
 * Uses simple string parsing instead of DOM manipulation
 */
export async function extractMetadata(
  html: string,
  url: string,
  contentType: ContentType,
  isNativeJson: boolean
): Promise<ContentMetadata> {
  const title = isNativeJson ? extractTitleFromJson(html) : extractTitleFromHtml(html);

  if (contentType === 'learning-journey') {
    const learningJourney = await extractLearningJourneyMetadata(html, url);
    return { title, learningJourney };
  } else {
    const singleDoc = extractSingleDocMetadata(html);
    return { title, singleDoc };
  }
}

export function extractTitleFromJson(json: string): string {
  const parsed: unknown = JSON.parse(json);
  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    'title' in parsed &&
    typeof (parsed as { title: unknown }).title === 'string'
  ) {
    return (parsed as { title: string }).title || 'Documentation';
  }
  return 'Documentation';
}

export function extractTitleFromHtml(html: string): string {
  const titlePatterns = [
    /<title[^>]*>([^<]+)<\/title>/i,
    /<h1[^>]*>([^<]+)<\/h1>/i,
    /<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i,
  ];

  for (const pattern of titlePatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return 'Documentation';
}

/**
 * Extract learning journey metadata using simple parsing
 * Replaces complex DOM processing with string-based extraction
 */
async function extractLearningJourneyMetadata(html: string, url: string): Promise<LearningJourneyMetadata> {
  const baseUrl = getLearningJourneyBaseUrl(url);

  // Extract milestones from index.json metadata file
  const milestones = await fetchLearningJourneyMetadataFromJson(baseUrl);
  const currentMilestone = findCurrentMilestoneFromUrl(url, milestones);

  // Since we now filter and renumber milestones sequentially (1, 2, 3, ...),
  // totalMilestones is simply the array length
  const totalMilestones = milestones.length;

  // Extract summary from first few paragraphs (simple string matching)
  const summary = extractJourneySummary(html);

  return {
    currentMilestone,
    totalMilestones,
    milestones,
    baseUrl,
    summary,
  };
}

/**
 * Extract single doc metadata
 */
export function extractSingleDocMetadata(html: string): SingleDocMetadata {
  const summary = extractDocSummary(html);
  return { summary };
}

/**
 * Simple summary extraction using string parsing
 */
export function extractJourneySummary(html: string): string {
  // Look for first few paragraphs
  const paragraphMatches = html.match(/<p[^>]*>(.*?)<\/p>/gi);
  if (paragraphMatches && paragraphMatches.length > 0) {
    const firstParagraphs = paragraphMatches.slice(0, 3);
    const text = firstParagraphs
      .map((p) => p.replace(/<[^>]+>/g, '').trim())
      .join(' ')
      .substring(0, 300);

    return text + (text.length >= 300 ? '...' : '');
  }

  return '';
}

export function extractDocSummary(html: string): string {
  // Try meta description first
  const metaMatch = html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i);
  if (metaMatch && metaMatch[1]) {
    return metaMatch[1];
  }

  // Fallback to first paragraph
  const paragraphMatch = html.match(/<p[^>]*>(.*?)<\/p>/i);
  if (paragraphMatch && paragraphMatch[1]) {
    return paragraphMatch[1]
      .replace(/<[^>]+>/g, '')
      .trim()
      .substring(0, 200);
  }

  return '';
}

export async function fetchLearningJourneyMetadataFromJson(baseUrl: string): Promise<Milestone[]> {
  try {
    const indexJsonUrl = `${baseUrl}/index.json`;
    const response = await fetch(indexJsonUrl);

    if (response.ok) {
      const data = await response.json();

      // The actual structure is an array of Hugo/Jekyll page objects
      if (Array.isArray(data)) {
        // First, filter out milestones that should be skipped
        const validItems = data.filter((item) => {
          // Skip if grafana.skip is true
          return !item.params?.grafana?.skip;
        });

        // Then map and renumber sequentially based on array position
        const milestones = validItems.map((item, index) => {
          // Use array index + 1 for sequential numbering (1, 2, 3, etc.)
          // This ensures no gaps in numbering even when items are skipped
          const milestone: Milestone = {
            number: index + 1,
            title: item.params?.title || item.params?.menutitle || `Step ${index + 1}`,
            duration: '5-10 min', // Default duration as it's not in the data
            url: `${new URL(baseUrl).origin}${item.permalink || item.params?.permalink || ''}`,
            isActive: false,
          };

          // Add optional fields if they exist
          if (item.params?.side_journeys) {
            milestone.sideJourneys = item.params.side_journeys;
          }

          if (item.params?.related_journeys) {
            milestone.relatedJourneys = item.params.related_journeys;
          }

          if (item.params?.cta?.image) {
            milestone.conclusionImage = {
              src: `${new URL(baseUrl).origin}${item.params.cta.image.src}`,
              width: item.params.cta.image.width,
              height: item.params.cta.image.height,
            };
          }

          return milestone;
        });

        return milestones; // Already in sequential order, no need to sort
      }
    } else {
      logger.warn(`Failed to fetch metadata (${response.status}): ${indexJsonUrl}`);
    }
  } catch (error) {
    logger.warn(`Failed to fetch learning journey metadata from ${baseUrl}/index.json`, { error });
  }

  return [];
}

/**
 * Find current milestone number from URL - improved version
 * Handles /unstyled.html and /content.json suffixes added during content fetching
 */
export function findCurrentMilestoneFromUrl(url: string, milestones: Milestone[]): number {
  // Strip /unstyled.html or /content.json suffixes for comparison (added during content fetching)
  const cleanUrl = url.replace(/\/(unstyled\.html|content\.json)$/, '');

  // Try exact URL match first (with and without trailing slash)
  for (const milestone of milestones) {
    if (urlsMatch(cleanUrl, milestone.url)) {
      return milestone.number;
    }
  }

  // Legacy pattern matching for milestone URLs
  const milestoneMatch = cleanUrl.match(/\/milestone-(\d+)/);
  if (milestoneMatch) {
    const milestoneNum = parseInt(milestoneMatch[1]!, 10);
    return milestoneNum;
  }

  // Check if this URL looks like a journey base URL (cover page)
  const baseUrl = getLearningJourneyBaseUrl(cleanUrl);
  if (urlsMatch(cleanUrl, baseUrl) || urlsMatch(cleanUrl, baseUrl + '/')) {
    return 0;
  }

  return 0; // Default to cover page
}
