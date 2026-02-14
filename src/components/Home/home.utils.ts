/**
 * Home page utilities
 *
 * Pure helper functions for the home page components.
 */

import pathsData from '../../learning-paths/paths.json';

/** Look up the estimated minutes for a guide from the bundled metadata. */
export function getGuideEstimate(guideId: string): number {
  const meta = (pathsData.guideMetadata as Record<string, { title: string; estimatedMinutes: number }>)[guideId];
  return meta?.estimatedMinutes ?? 5;
}
