/**
 * The set of experiment arms the current user is enrolled in, for analytics
 * enrichment (`bindExperimentsProvider`) and Faro session cohorts.
 *
 * Lives here rather than in `../openfeature` so the flag registry stays unaware of
 * which experiments exist — adding or retiring one touches only this directory.
 */

import { getHighlightedGuideConfig, type ExperimentAnalyticsEntry, type FeatureFlagName } from '../openfeature';
import {
  getEnrolledInteractiveLearningBannerConfig,
  INTERACTIVE_LEARNING_BANNER_FLAG,
} from './interactive-learning-banner';

const HIGHLIGHTED_GUIDE_FLAG: FeatureFlagName = 'pathfinder.highlighted-guide-experiment';

// Excluded arms are dropped — 'excluded' means the user isn't enrolled, matching
// the exposure-event convention (openfeature-tracking.ts).
export const getActiveExperiments = (): ExperimentAnalyticsEntry[] => {
  const entries: ExperimentAnalyticsEntry[] = [];

  const highlightedGuide = getHighlightedGuideConfig();
  if (highlightedGuide.variant !== 'excluded') {
    entries.push({ flag: HIGHLIGHTED_GUIDE_FLAG, ...highlightedGuide });
  }

  // Cache read, never an evaluation: this runs on every reportAppInteraction and
  // must not enroll anyone who has not opened Pathfinder.
  const banner = getEnrolledInteractiveLearningBannerConfig();
  if (banner && banner.variant !== 'excluded') {
    entries.push({ flag: INTERACTIVE_LEARNING_BANNER_FLAG, ...banner });
  }

  return entries;
};
