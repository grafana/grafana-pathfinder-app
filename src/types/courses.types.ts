/**
 * Course (learning path) wire types for CDN-served content.
 *
 * Courses are the user-facing term; the internal type `LearningPath` is
 * preserved unchanged so existing localStorage progress and badge triggers
 * (`path-completed`) keep working.
 */

import type { Badge, GuideMetadataEntry, LearningPath } from './learning-paths.types';

export type Course = LearningPath;

export interface CoursesPlatformIndex {
  schemaVersion: string;
  platform: 'oss' | 'cloud';
  generatedAt?: string;
  courses: Course[];
  guideMetadata: Record<string, GuideMetadataEntry>;
  badges: Badge[];
}

export interface CourseDocument {
  schemaVersion: string;
  id: string;
  title: string;
  description: string;
  guides: string[];
  guideMetadata?: Record<string, GuideMetadataEntry>;
  badgeId: string;
  targetPlatform?: 'oss' | 'cloud';
  estimatedMinutes?: number;
  icon?: string;
  url?: string;
}

export interface BadgeDocument {
  schemaVersion: string;
  badge: Badge;
}
