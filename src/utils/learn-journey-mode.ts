import { classifyDocsUrl, type DocsUrlClassification, type LearnLocation } from '../lib/docs-url-family';
import type { LearningJourneyMetadata } from '../types/content.types';
import { getFeatureFlagValue } from './openfeature';

export const LEARN_JOURNEY_MODE_FLAG = 'pathfinder.learn-journey-mode';

export function isLearnJourneyModeEnabled(): boolean {
  return getFeatureFlagValue(LEARN_JOURNEY_MODE_FLAG, false);
}

/** The location of a Learn journey, section or step. The Learn home and every other URL give `undefined`. */
export function learnJourneyLocation(classification: DocsUrlClassification): LearnLocation | undefined {
  const { learn } = classification;
  return classification.family === 'learn' && learn !== undefined && learn.kind !== 'home' ? learn : undefined;
}

/** A Learn journey, section or step that opens as a learning journey, which happens only while the flag is on. */
export function isLearnJourneyModeUrl(classification: DocsUrlClassification): boolean {
  return learnJourneyLocation(classification) !== undefined && isLearnJourneyModeEnabled();
}

/**
 * The milestone URL a loaded Learn page belongs to. A section URL loads its
 * first step and a step URL may lack the website's trailing slash, but the tab's
 * current URL must be the milestone's own URL.
 */
export function learnMilestoneUrl(metadata: LearningJourneyMetadata | undefined): string | undefined {
  if (!metadata?.currentMilestone || !metadata.milestones) {
    return undefined;
  }
  const current = metadata.milestones.find((milestone) => milestone.number === metadata.currentMilestone);
  return current && learnJourneyLocation(classifyDocsUrl(current.url))?.kind === 'step' ? current.url : undefined;
}
