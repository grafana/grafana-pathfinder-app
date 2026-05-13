/**
 * Course schema integrity tests
 *
 * Course definitions now live in the interactive-learning CDN. These tests
 * exercise the wire schema with a representative inline fixture covering
 * every badge trigger type, mixed package-ID + URL guide entries, and the
 * platform field. The schema is the contract between this plugin and the
 * CDN; the CDN-side validation in interactive-tutorials uses the same Zod
 * module via the pathfinder-cli.
 */

import { CoursesPlatformIndexSchema, COURSES_SCHEMA_VERSION } from '../types/courses.schema';
import type { CoursesPlatformIndex } from '../types/courses.types';

const FIXTURE: CoursesPlatformIndex = {
  schemaVersion: COURSES_SCHEMA_VERSION,
  platform: 'cloud',
  courses: [
    {
      id: 'getting-started',
      title: 'Getting started with Grafana',
      description: 'Learn the essentials.',
      guides: ['welcome-to-grafana', 'first-dashboard'],
      badgeId: 'grafana-fundamentals',
      targetPlatform: 'oss',
      estimatedMinutes: 25,
      icon: 'grafana',
    },
    {
      id: 'linux-server-integration',
      title: 'Monitor a Linux server',
      description: 'Set up full Linux server observability with Alloy.',
      guides: ['linux-server-integration-lj', 'https://grafana.com/docs/learning-paths/linux-server-integration/'],
      badgeId: 'penguin-wrangler',
      targetPlatform: 'cloud',
      estimatedMinutes: 20,
      icon: 'server',
    },
  ],
  guideMetadata: {
    'welcome-to-grafana': { title: 'Welcome', estimatedMinutes: 5 },
    'first-dashboard': { title: 'First dashboard', estimatedMinutes: 10 },
  },
  badges: [
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
      id: 'penguin-wrangler',
      title: 'Penguin Wrangler',
      description: 'Wrangled a Linux server into full observability with Alloy',
      icon: 'server',
      emoji: '🐧',
      trigger: { type: 'path-completed', pathId: 'linux-server-integration' },
    },
    {
      id: 'consistent-learner',
      title: 'Consistent Learner',
      description: 'Maintain a 3-day learning streak',
      icon: 'fire',
      trigger: { type: 'streak', days: 3 },
    },
  ],
};

describe('CoursesPlatformIndex schema', () => {
  it('accepts a well-formed fixture covering all trigger types', () => {
    const result = CoursesPlatformIndexSchema.safeParse(FIXTURE);
    expect(result.success).toBe(true);
  });

  it('rejects an unknown trigger type', () => {
    const bad = {
      ...FIXTURE,
      badges: [...FIXTURE.badges, { id: 'x', title: 'x', description: 'x', icon: 'x', trigger: { type: 'mystery' } }],
    };
    expect(CoursesPlatformIndexSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an unsafe URL scheme in a guide entry', () => {
    const bad = {
      ...FIXTURE,
      courses: [{ ...FIXTURE.courses[0], guides: ['javascript:alert(1)'] }],
    };
    expect(CoursesPlatformIndexSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a missing badgeId on a course', () => {
    const bad = {
      ...FIXTURE,
      courses: [{ ...FIXTURE.courses[0], badgeId: undefined as unknown as string }],
    };
    expect(CoursesPlatformIndexSchema.safeParse(bad).success).toBe(false);
  });

  it('tolerates additional unknown fields (forward compat)', () => {
    const augmented = { ...FIXTURE, somethingNew: 'value' };
    expect(CoursesPlatformIndexSchema.safeParse(augmented).success).toBe(true);
  });

  describe('fixture integrity', () => {
    it('every course badgeId points to a defined badge', () => {
      const badgeIds = new Set(FIXTURE.badges.map((b) => b.id));
      for (const course of FIXTURE.courses) {
        expect(badgeIds.has(course.badgeId)).toBe(true);
      }
    });

    it('every path-completed badge references an existing course', () => {
      const courseIds = new Set(FIXTURE.courses.map((c) => c.id));
      for (const badge of FIXTURE.badges) {
        if (badge.trigger.type === 'path-completed') {
          expect(courseIds.has(badge.trigger.pathId)).toBe(true);
        }
      }
    });

    it('guide entries are either bare IDs or absolute https URLs', () => {
      for (const course of FIXTURE.courses) {
        for (const entry of course.guides) {
          if (entry.startsWith('http://') || entry.startsWith('https://')) {
            expect(entry).toMatch(/^https:\/\//);
          } else {
            expect(entry).not.toMatch(/^\w+:\/\//);
          }
        }
      }
    });
  });
});
