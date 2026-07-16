/**
 * Pure milestone-index helpers extracted from docs-panel.tsx.
 *
 * Milestones in a learning journey are 1-indexed when surfaced to the user
 * (milestone 1, 2, 3, ...). The "introduction" cover page is milestone 0.
 * `findCurrentMilestoneIndex` returns that 1-indexed value, or 0 when the
 * current URL does not appear in the milestones array.
 */

import { isEndJourneyUrl } from '../../../docs-retrieval';

/**
 * Find the 1-indexed position of `currentUrl` within `milestones`.
 *
 * Returns 0 when the URL is the cover page (not in the milestones array)
 * or otherwise unmatched — this matches the prior behavior of treating
 * "unknown URL" and "intro page" identically. end-journey pages resolve to
 * the last milestone so completion reads 100%.
 */
export function findCurrentMilestoneIndex(milestones: Array<{ url: string }>, currentUrl: string): number {
  const index = milestones.findIndex((m) => m.url === currentUrl);
  if (index >= 0) {
    return index + 1;
  }
  return isEndJourneyUrl(currentUrl) ? milestones.length : 0;
}
