/**
 * The set of experiment arms the current user is enrolled in, for analytics
 * enrichment (`bindExperimentsProvider`) and Faro session cohorts.
 *
 * Lives here rather than in `../openfeature` so the flag registry stays unaware of
 * which experiments exist — adding or retiring one touches only this directory.
 */

import { AUTO_OPEN_GUIDE_EXPERIMENT_FLAG } from '../../constants/auto-open-guide-experiment';
import type { ExperimentAnalyticsEntry } from '../openfeature';
import { getAutoOpenGuideEnrollment } from './auto-open-guide/state';
import {
  getEnrolledInteractiveLearningBannerConfig,
  INTERACTIVE_LEARNING_BANNER_FLAG,
} from './interactive-learning-banner';

// Excluded arms are dropped — 'excluded' means the user isn't enrolled, matching
// the exposure-event convention (openfeature-tracking.ts). Every read here is a
// cache read, never an evaluation: this runs on every reportAppInteraction and
// must not enroll anyone.
export const getActiveExperiments = (): ExperimentAnalyticsEntry[] => {
  const entries: ExperimentAnalyticsEntry[] = [];

  const autoOpenGuide = getAutoOpenGuideEnrollment();
  if (autoOpenGuide) {
    entries.push({ flag: AUTO_OPEN_GUIDE_EXPERIMENT_FLAG, variant: autoOpenGuide.variant });
  }

  const banner = getEnrolledInteractiveLearningBannerConfig();
  if (banner && banner.variant !== 'excluded') {
    entries.push({ flag: INTERACTIVE_LEARNING_BANNER_FLAG, ...banner });
  }

  return entries;
};
