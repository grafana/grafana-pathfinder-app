// Metadata + journey extraction for the docs-retrieval pipeline.
//
// Extracted from content-fetcher.ts in Phase 2 of the content-fetcher refactor.
// All eleven symbols moved together — they form a self-contained cluster
// (string parsing + a single bounded `index.json` fetch). The cluster is
// invoked from `fetchContent` via `extractMetadata`, which is the only
// non-private export consumed by content-fetcher.
//
// Tier: docs-retrieval (tier 2). The new module needs only types from
// `../types/content.types` and the global `fetch` API. It does NOT import
// from `../security`, `../lib`, `../utils`, `../constants`, or `../validation`.
//
// CRITICAL INVARIANTS to preserve verbatim (do NOT "fix" any of these):
//
//   1. urlsMatch normalizes (trailing slash + lowercase). It is asymmetric
//      vs. fetchPackageContent's strict `m.url === contentUrl` match —
//      that asymmetry is intentional and must remain (PLAN.md DR-05,
//      INVESTIGATION §6 invariant 5).
//
//   2. fetchLearningJourneyMetadataFromJson does NOT enforce trust or
//      HTTPS on its input baseUrl. This is intentional asymmetric
//      hardening relative to fetchRawHtml's enforceHttps(finalUrl)
//      gate. Adding a trust/HTTPS gate here would change behavior the
//      refactor must preserve (INVESTIGATION §6 invariant 1, hard gate).
//
//   3. Title regex precedence: <title> → <h1> → og:title → 'Documentation'.
//      Trim whitespace from the first match.
//
//   4. findCurrentMilestoneFromUrl strips /unstyled.html and /content.json
//      suffixes before matching. The legacy /milestone-N regex fallback
//      fires before the cover-page check.
//
//   5. getLearningJourneyBaseUrl regex precedence:
//        learning-journeys → learning-paths → tutorials → strip-milestone.
//
//   6. Milestone renumbering: filter `params.grafana.skip:true` first,
//      then map with `index + 1` for sequential numbering — gaps are
//      eliminated. Permalinks are origin-prefixed via `new URL(baseUrl).origin`.
//      Default duration is the literal string `'5-10 min'`.

import {
  ContentMetadata,
  ContentType,
  LearningJourneyMetadata,
  Milestone,
  SingleDocMetadata,
} from '../types/content.types';

/**
 * Extract metadata from HTML without DOM processing.
 * Uses simple string parsing instead of DOM manipulation.
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
 * Extract learning journey metadata using simple parsing.
 * Replaces complex DOM processing with string-based extraction.
 */
export async function extractLearningJourneyMetadata(html: string, url: string): Promise<LearningJourneyMetadata> {
  const baseUrl = getLearningJourneyBaseUrl(url);

  const milestones = await fetchLearningJourneyMetadataFromJson(baseUrl);
  const currentMilestone = findCurrentMilestoneFromUrl(url, milestones);

  // Since we now filter and renumber milestones sequentially (1, 2, 3, ...),
  // totalMilestones is simply the array length.
  const totalMilestones = milestones.length;

  const summary = extractJourneySummary(html);

  return {
    currentMilestone,
    totalMilestones,
    milestones,
    baseUrl,
    summary,
  };
}

export function extractSingleDocMetadata(html: string): SingleDocMetadata {
  const summary = extractDocSummary(html);
  return { summary };
}

/**
 * Simple summary extraction using string parsing.
 * First-3-paragraphs joined with single space, truncated at 300 chars,
 * ellipsis appended only when the joined text reaches the boundary.
 */
export function extractJourneySummary(html: string): string {
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
  const metaMatch = html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i);
  if (metaMatch && metaMatch[1]) {
    return metaMatch[1];
  }

  const paragraphMatch = html.match(/<p[^>]*>(.*?)<\/p>/i);
  if (paragraphMatch && paragraphMatch[1]) {
    return paragraphMatch[1]
      .replace(/<[^>]+>/g, '')
      .trim()
      .substring(0, 200);
  }

  return '';
}

/**
 * Resolve the journey/path/tutorial base URL from any URL within it.
 * Order: learning-journeys → learning-paths → tutorials → strip-milestone.
 */
export function getLearningJourneyBaseUrl(url: string): string {
  // https://grafana.com/docs/learning-journeys/foo/ → https://grafana.com/docs/learning-journeys/foo (legacy)
  // https://grafana.com/docs/learning-paths/foo/ → https://grafana.com/docs/learning-paths/foo (new)
  // https://grafana.com/docs/learning-journeys/foo/milestone-1/ → https://grafana.com/docs/learning-journeys/foo
  // https://grafana.com/tutorials/alerting-get-started/ → https://grafana.com/tutorials/alerting-get-started

  const learningJourneyMatch = url.match(/^(https?:\/\/[^\/]+\/docs\/learning-journeys\/[^\/]+)/);
  if (learningJourneyMatch) {
    return learningJourneyMatch[1]!;
  }

  const learningPathMatch = url.match(/^(https?:\/\/[^\/]+\/docs\/learning-paths\/[^\/]+)/);
  if (learningPathMatch) {
    return learningPathMatch[1]!;
  }

  const tutorialMatch = url.match(/^(https?:\/\/[^\/]+\/tutorials\/[^\/]+)/);
  if (tutorialMatch) {
    return tutorialMatch[1]!;
  }

  return url.replace(/\/milestone-\d+.*$/, '').replace(/\/$/, '');
}

/**
 * Fetch milestone metadata from a learning journey/path's `index.json`.
 *
 * SECURITY NOTE: this function intentionally does NOT enforce trust or
 * HTTPS on `baseUrl`. The asymmetry vs. `fetchRawHtml` is pre-existing
 * behavior (see content-fetcher.ts comments at fetchRawHtml). Adding a
 * gate here would change behavior the refactor must preserve.
 */
export async function fetchLearningJourneyMetadataFromJson(baseUrl: string): Promise<Milestone[]> {
  try {
    const indexJsonUrl = `${baseUrl}/index.json`;
    const response = await fetch(indexJsonUrl);

    if (response.ok) {
      const data = await response.json();

      // The actual structure is an array of Hugo/Jekyll page objects.
      if (Array.isArray(data)) {
        // First, filter out milestones that should be skipped.
        const validItems = data.filter((item) => {
          return !item.params?.grafana?.skip;
        });

        // Then map and renumber sequentially based on array position
        // (index + 1) so there are no gaps even when items are skipped.
        const milestones = validItems.map((item, index) => {
          const milestone: Milestone = {
            number: index + 1,
            title: item.params?.title || item.params?.menutitle || `Step ${index + 1}`,
            duration: '5-10 min',
            url: `${new URL(baseUrl).origin}${item.permalink || item.params?.permalink || ''}`,
            isActive: false,
          };

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

        return milestones; // Already in sequential order, no need to sort.
      }
    } else {
      console.warn(`Failed to fetch metadata (${response.status}): ${indexJsonUrl}`);
    }
  } catch (error) {
    console.warn(`Failed to fetch learning journey metadata from ${baseUrl}/index.json:`, error);
  }

  return [];
}

/**
 * Find current milestone number from URL.
 * Strips /unstyled.html and /content.json suffixes (added during content
 * fetching) before matching; falls back to legacy /milestone-N regex.
 */
export function findCurrentMilestoneFromUrl(url: string, milestones: Milestone[]): number {
  const cleanUrl = url.replace(/\/(unstyled\.html|content\.json)$/, '');

  for (const milestone of milestones) {
    if (urlsMatch(cleanUrl, milestone.url)) {
      return milestone.number;
    }
  }

  // Legacy pattern matching for milestone URLs.
  const milestoneMatch = cleanUrl.match(/\/milestone-(\d+)/);
  if (milestoneMatch) {
    const milestoneNum = parseInt(milestoneMatch[1]!, 10);
    return milestoneNum;
  }

  // Cover-page check: if the cleanUrl is the journey base URL, return 0.
  const baseUrl = getLearningJourneyBaseUrl(cleanUrl);
  if (urlsMatch(cleanUrl, baseUrl) || urlsMatch(cleanUrl, baseUrl + '/')) {
    return 0;
  }

  return 0; // Default to cover page.
}

/**
 * Check if two URLs match, normalizing trailing slash and case.
 *
 * NOTE: this is intentionally lenient. fetchPackageContent uses strict
 * `m.url === contentUrl` matching for milestone-vs-content-URL comparisons.
 * That asymmetry must remain — see PLAN.md DR-05 / INVESTIGATION §6
 * invariant 5.
 */
export function urlsMatch(url1: string, url2: string): boolean {
  const normalize = (u: string) => u.replace(/\/$/, '').toLowerCase();
  return normalize(url1) === normalize(url2);
}
