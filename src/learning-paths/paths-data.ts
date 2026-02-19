/**
 * Learning Paths Data - Runtime Platform Selection
 *
 * Selects the correct paths data file (OSS or Cloud) based on
 * the current Grafana edition at runtime. Cloud is a superset
 * of OSS, containing all OSS paths plus cloud-only paths.
 */

import { config } from '@grafana/runtime';

import type { LearningPath, GuideMetadataEntry } from '../types/learning-paths.types';

import ossPathsData from './paths.json';
import cloudPathsData from './paths-cloud.json';

// ============================================================================
// TYPES
// ============================================================================

export interface PathsDataSet {
  paths: LearningPath[];
  guideMetadata: Record<string, GuideMetadataEntry>;
}

// ============================================================================
// RUNTIME SELECTION
// ============================================================================

/**
 * Returns the appropriate paths data for the current Grafana edition.
 * Cloud gets the full superset (OSS + cloud paths); OSS gets only OSS paths.
 */
export function getPathsData(): PathsDataSet {
  const isCloud = config.bootData?.settings?.cloudMigrationIsTarget ?? false;
  const raw = isCloud ? cloudPathsData : ossPathsData;
  return {
    paths: raw.paths as LearningPath[],
    guideMetadata: raw.guideMetadata as Record<string, GuideMetadataEntry>,
  };
}
