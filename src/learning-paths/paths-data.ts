/**
 * Course Data - Runtime Platform Selection
 *
 * Selects the correct course data for the current Grafana edition (OSS or
 * Cloud) and loads it from the interactive-learning CDN with a bundled
 * fallback for offline operation.
 *
 * `getPathsData()` is synchronous and reads from a module-scoped cache.
 * Callers that need the freshest data should call `initCoursesData()` first
 * (the hook does this on mount). Sync access before init returns the
 * bundled fallback.
 */

import { config } from '@grafana/runtime';

import type { Badge, LearningPath, GuideMetadataEntry } from '../types/learning-paths.types';
import type { CoursesPlatformIndex } from '../types/courses.types';

import { FALLBACK_COURSES } from './bundled-courses';
import { fetchCourses, type CoursesPlatform } from './fetch-courses';

export interface PathsDataSet {
  paths: LearningPath[];
  guideMetadata: Record<string, GuideMetadataEntry>;
  badges: Badge[];
}

export type CoursesDataSource = 'cdn' | 'fallback';

function getCurrentPlatform(): CoursesPlatform {
  return config.bootData?.settings?.cloudMigrationIsTarget ? 'cloud' : 'oss';
}

function toPathsDataSet(index: CoursesPlatformIndex): PathsDataSet {
  return {
    paths: index.courses as LearningPath[],
    guideMetadata: index.guideMetadata,
    badges: index.badges,
  };
}

let cache: PathsDataSet = toPathsDataSet(FALLBACK_COURSES[getCurrentPlatform()]);
let initPromise: Promise<{ data: PathsDataSet; source: CoursesDataSource }> | null = null;

/**
 * Returns the cached course data for the current Grafana edition.
 * Returns the bundled fallback if `initCoursesData()` has not resolved yet.
 */
export function getPathsData(): PathsDataSet {
  return cache;
}

/**
 * Loads course data from the CDN, falling back to bundled data on failure.
 * Idempotent: concurrent and repeated calls return the same promise.
 */
export function initCoursesData(): Promise<{ data: PathsDataSet; source: CoursesDataSource }> {
  if (initPromise) {
    return initPromise;
  }
  initPromise = (async () => {
    const platform = getCurrentPlatform();
    const fetched = await fetchCourses(platform);
    if (fetched) {
      cache = toPathsDataSet(fetched);
      return { data: cache, source: 'cdn' as const };
    }
    cache = toPathsDataSet(FALLBACK_COURSES[platform]);
    return { data: cache, source: 'fallback' as const };
  })();
  return initPromise;
}

/** For tests: reset the cache and init promise. */
export function resetCoursesData(): void {
  cache = toPathsDataSet(FALLBACK_COURSES[getCurrentPlatform()]);
  initPromise = null;
}
