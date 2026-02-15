/**
 * Learning Paths Data Integrity Tests
 *
 * Verifies structural consistency between paths.json and badges.ts:
 * - Every path badgeId has a corresponding BADGES entry
 * - Path-completion badge triggers point back to valid path IDs
 * - Emoji badges have the emoji field set
 */

import { BADGES } from './badges';
import pathsData from './paths.json';
import ljPathsData from './lj-temp-metadata.json';
import type { LearningPath } from '../types/learning-paths.types';

// Merge paths from both files (lj-temp-metadata.json contains learning journey paths)
// Deduplicate by path ID, preferring paths.json entries over lj-temp-metadata.json
const allPaths = [...(pathsData.paths as LearningPath[]), ...(ljPathsData.paths as LearningPath[])];
const pathsMap = new Map<string, LearningPath>();
for (const path of allPaths) {
  if (!pathsMap.has(path.id)) {
    pathsMap.set(path.id, path);
  }
}
const paths = Array.from(pathsMap.values());

describe('paths.json / badges.ts data integrity', () => {
  it('every path badgeId has a matching BADGES entry with a path-completed trigger', () => {
    for (const path of paths) {
      const badge = BADGES.find((b) => b.id === path.badgeId);
      expect(badge).toBeDefined();
      expect(badge!.trigger).toEqual({ type: 'path-completed', pathId: path.id });
    }
  });

  it('every path-completed badge references an existing path', () => {
    const pathIds = new Set(paths.map((p) => p.id));

    const pathBadges = BADGES.filter((b) => b.trigger.type === 'path-completed');
    for (const badge of pathBadges) {
      const trigger = badge.trigger as { type: 'path-completed'; pathId: string };
      expect(pathIds.has(trigger.pathId)).toBe(true);
    }
  });

  it('every guide in a path has a guideMetadata entry', () => {
    // Merge guideMetadata from both files
    const allMetadata = { ...pathsData.guideMetadata, ...ljPathsData.guideMetadata };
    const metadataKeys = Object.keys(allMetadata);
    for (const path of paths) {
      for (const guideId of path.guides) {
        expect(metadataKeys).toContain(guideId);
      }
    }
  });

  it('remote guides have a valid URL in guideMetadata', () => {
    // Merge guideMetadata from both files
    const metadata = { ...pathsData.guideMetadata, ...ljPathsData.guideMetadata } as Record<
      string,
      { title: string; estimatedMinutes: number; url?: string }
    >;

    for (const [, entry] of Object.entries(metadata)) {
      if (entry.url) {
        expect(entry.url).toMatch(/^https:\/\//);
        expect(entry.url).toContain('interactive-learning.grafana.net');
      }
    }
  });

  it('learning journey badges have an emoji field', () => {
    // Badges with path-completed triggers on cloud paths should have emoji
    const cloudPathIds = new Set(paths.filter((p) => p.targetPlatform === 'cloud').map((p) => p.id));
    const cloudPathBadges = BADGES.filter(
      (b) => b.trigger.type === 'path-completed' && cloudPathIds.has((b.trigger as { pathId: string }).pathId)
    );

    for (const badge of cloudPathBadges) {
      expect(badge.emoji).toBeDefined();
      expect(badge.emoji!.length).toBeGreaterThan(0);
    }
  });

  it('no duplicate path IDs', () => {
    const ids = paths.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('no duplicate badge IDs', () => {
    const ids = BADGES.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
