/**
 * Tests for the bundled offline fallback.
 *
 * Verifies the fallback validates against the schema and is internally
 * consistent: every course references an existing badge, and every
 * path-completed badge references an existing course.
 */

import { FALLBACK_BADGES, FALLBACK_COURSES } from './bundled-courses';
import { CoursesPlatformIndexSchema } from '../types/courses.schema';

describe('FALLBACK_COURSES', () => {
  it('OSS index validates against the schema', () => {
    const result = CoursesPlatformIndexSchema.safeParse(FALLBACK_COURSES.oss);
    expect(result.success).toBe(true);
  });

  it('Cloud index validates against the schema', () => {
    const result = CoursesPlatformIndexSchema.safeParse(FALLBACK_COURSES.cloud);
    expect(result.success).toBe(true);
  });

  it('every course references an existing badge', () => {
    for (const platform of ['oss', 'cloud'] as const) {
      const { courses, badges } = FALLBACK_COURSES[platform];
      const badgeIds = new Set(badges.map((b) => b.id));
      for (const course of courses) {
        expect(badgeIds.has(course.badgeId)).toBe(true);
      }
    }
  });

  it('every path-completed badge references an existing course', () => {
    for (const platform of ['oss', 'cloud'] as const) {
      const { courses, badges } = FALLBACK_COURSES[platform];
      const courseIds = new Set(courses.map((c) => c.id));
      for (const badge of badges) {
        if (badge.trigger.type === 'path-completed') {
          expect(courseIds.has(badge.trigger.pathId)).toBe(true);
        }
      }
    }
  });

  it('every guide referenced by a course has guideMetadata', () => {
    for (const platform of ['oss', 'cloud'] as const) {
      const { courses, guideMetadata } = FALLBACK_COURSES[platform];
      const knownGuides = new Set(Object.keys(guideMetadata));
      for (const course of courses) {
        for (const guideId of course.guides) {
          expect(knownGuides.has(guideId)).toBe(true);
        }
      }
    }
  });

  it('exports the badge set independently via FALLBACK_BADGES', () => {
    expect(FALLBACK_BADGES.length).toBeGreaterThan(0);
    expect(FALLBACK_BADGES).toEqual(FALLBACK_COURSES.oss.badges);
  });

  it('has no duplicate badge IDs', () => {
    const ids = FALLBACK_BADGES.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
