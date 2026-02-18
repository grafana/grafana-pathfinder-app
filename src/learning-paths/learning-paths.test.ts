/**
 * Learning Paths Data Integrity Tests
 *
 * Verifies structural consistency between paths.json and badges.ts:
 * - Every path badgeId has a corresponding BADGES entry
 * - Path-completion badge triggers point back to valid path IDs
 * - Emoji badges have the emoji field set
 */

import { BADGES } from './badges';
import ossPathsData from './paths.json';
import cloudPathsData from './paths-cloud.json';
import type { LearningPath, GuideMetadataEntry } from '../types/learning-paths.types';

// Merge OSS + cloud paths (cloud adds URL-based paths, OSS has static bundled paths)
const allPaths = [...(ossPathsData.paths as LearningPath[]), ...(cloudPathsData.paths as LearningPath[])];
// Deduplicate by path ID (cloud overrides OSS if same ID exists)
const pathsMap = new Map<string, LearningPath>();
for (const path of allPaths) {
  pathsMap.set(path.id, path);
}
const paths = Array.from(pathsMap.values());
const allGuideMetadata = {
  ...ossPathsData.guideMetadata,
  ...cloudPathsData.guideMetadata,
} as Record<string, GuideMetadataEntry>;

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

  it('every guide in a static path has a guideMetadata entry', () => {
    const metadataKeys = Object.keys(allGuideMetadata);
    for (const path of paths) {
      // URL-based paths have empty guides (fetched dynamically at runtime)
      if (path.url) {
        continue;
      }
      for (const guideId of path.guides) {
        expect(metadataKeys).toContain(guideId);
      }
    }
  });

  it('URL-based paths have a valid url and empty guides', () => {
    const urlPaths = paths.filter((p) => p.url);
    for (const path of urlPaths) {
      expect(path.url).toMatch(/^https:\/\//);
      expect(path.guides).toEqual([]);
    }
  });

  it('remote guides have a valid URL in guideMetadata', () => {
    for (const [, entry] of Object.entries(allGuideMetadata)) {
      if (entry.url) {
        expect(entry.url).toMatch(/^https:\/\//);
        expect(entry.url).toContain('interactive-learning.grafana.net');
      }
    }
  });

  it('cloud file adds paths not in the OSS file', () => {
    const ossPathIds = new Set((ossPathsData.paths as LearningPath[]).map((p) => p.id));
    const cloudOnlyPaths = (cloudPathsData.paths as LearningPath[]).filter((p) => !ossPathIds.has(p.id));
    expect(cloudOnlyPaths.length).toBeGreaterThan(0);
  });

  it('no path ID collisions between OSS and cloud files', () => {
    const ossPathIds = new Set((ossPathsData.paths as LearningPath[]).map((p) => p.id));
    const cloudPathIds = new Set((cloudPathsData.paths as LearningPath[]).map((p) => p.id));
    for (const id of ossPathIds) {
      expect(cloudPathIds.has(id)).toBe(false);
    }
  });

  it('learning journey badges have an emoji field', () => {
    // Badges for URL-based (cloud) paths should have emoji
    const cloudPathIds = new Set((cloudPathsData.paths as LearningPath[]).map((p) => p.id));
    const cloudBadges = BADGES.filter(
      (b) => b.trigger.type === 'path-completed' && cloudPathIds.has((b.trigger as { pathId: string }).pathId)
    );

    for (const badge of cloudBadges) {
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
