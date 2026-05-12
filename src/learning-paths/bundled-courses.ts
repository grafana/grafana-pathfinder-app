/**
 * Bundled offline fallback for course data.
 *
 * Used when the interactive-learning CDN is unreachable, returns a non-2xx,
 * or returns a payload that fails schema validation. Contains a single
 * minimal getting-started course plus the badges needed to render it and
 * the platform-agnostic streak badges.
 */

import type { Badge } from '../types/learning-paths.types';
import type { CoursesPlatformIndex } from '../types/courses.types';
import { COURSES_SCHEMA_VERSION } from '../types/courses.schema';

export const FALLBACK_BADGES: Badge[] = [
  {
    id: 'first-steps',
    title: 'First steps',
    description: 'Complete your first guide',
    icon: 'rocket',
    trigger: { type: 'guide-completed' },
  },
  {
    id: 'grafana-fundamentals',
    title: 'Grafana Fundamentals',
    description: 'Complete the "Getting started with Grafana" course',
    icon: 'grafana',
    trigger: { type: 'path-completed', pathId: 'getting-started' },
  },
  {
    id: 'consistent-learner',
    title: 'Consistent Learner',
    description: 'Maintain a 3-day learning streak',
    icon: 'fire',
    trigger: { type: 'streak', days: 3 },
  },
  {
    id: 'dedicated-learner',
    title: 'Dedicated Learner',
    description: 'Maintain a 7-day learning streak',
    icon: 'star',
    trigger: { type: 'streak', days: 7 },
  },
];

const BASE_FALLBACK: Omit<CoursesPlatformIndex, 'platform'> = {
  schemaVersion: COURSES_SCHEMA_VERSION,
  courses: [
    {
      id: 'getting-started',
      title: 'Getting started with Grafana',
      description: 'Build your first dashboard to learn the essentials of Grafana.',
      guides: ['first-dashboard'],
      badgeId: 'grafana-fundamentals',
      estimatedMinutes: 10,
      icon: 'grafana',
      targetPlatform: 'oss',
    },
  ],
  guideMetadata: {
    'first-dashboard': { title: 'Create your first dashboard', estimatedMinutes: 10 },
  },
  badges: FALLBACK_BADGES,
};

export const FALLBACK_COURSES: Record<'oss' | 'cloud', CoursesPlatformIndex> = {
  oss: { ...BASE_FALLBACK, platform: 'oss' },
  cloud: { ...BASE_FALLBACK, platform: 'cloud' },
};
