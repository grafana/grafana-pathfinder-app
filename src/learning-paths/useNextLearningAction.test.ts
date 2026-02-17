/**
 * useNextLearningAction Tests
 *
 * Tests the pure computeNextAction function that determines the next
 * guide a user should open based on their learning path progress.
 */

import { computeNextAction } from './useNextLearningAction';
import type { LearningPath, PathGuide } from '../types/learning-paths.types';

// ============================================================================
// FIXTURES
// ============================================================================

const makePath = (id: string, title: string, guides: string[]): LearningPath => ({
  id,
  title,
  description: `Description for ${title}`,
  guides,
  badgeId: `${id}-badge`,
});

const makeGuides = (guideIds: string[], completedIds: string[]): PathGuide[] => {
  let foundCurrent = false;
  return guideIds.map((id) => {
    const completed = completedIds.includes(id);
    const isCurrent = !completed && !foundCurrent;
    if (isCurrent) {
      foundCurrent = true;
    }
    return { id, title: `Guide: ${id}`, completed, isCurrent };
  });
};

const paths: LearningPath[] = [
  makePath('getting-started', 'Getting started with Grafana', ['welcome', 'prometheus-101', 'first-dashboard']),
  makePath('observability', 'Observability basics', ['prom-basics', 'loki-basics', 'advanced-queries']),
  makePath('alerting', 'Alerting fundamentals', ['alert-intro', 'alert-rules']),
];

// ============================================================================
// TESTS
// ============================================================================

describe('computeNextAction', () => {
  it('returns the first in-progress path current guide', () => {
    const completedGuides = ['welcome'];

    const result = computeNextAction({
      paths,
      getPathProgress: (id) => (id === 'getting-started' ? 33 : 0),
      getPathGuides: (id) => {
        const path = paths.find((p) => p.id === id);
        return path ? makeGuides(path.guides, completedGuides) : [];
      },
      isPathCompleted: () => false,
    });

    expect(result).toEqual({
      guideId: 'prometheus-101',
      guideTitle: 'Guide: prometheus-101',
      guideUrl: 'bundled:prometheus-101',
      pathTitle: 'Getting started with Grafana',
      pathProgress: 33,
    });
  });

  it('prefers in-progress paths over not-started', () => {
    const completedGuides = ['prom-basics'];

    const result = computeNextAction({
      paths,
      getPathProgress: (id) => (id === 'observability' ? 33 : 0),
      getPathGuides: (id) => {
        const path = paths.find((p) => p.id === id);
        return path ? makeGuides(path.guides, completedGuides) : [];
      },
      isPathCompleted: () => false,
    });

    expect(result).not.toBeNull();
    expect(result!.pathTitle).toBe('Observability basics');
    expect(result!.guideId).toBe('loki-basics');
  });

  it('returns first not-started path when nothing is in-progress', () => {
    const result = computeNextAction({
      paths,
      getPathProgress: () => 0,
      getPathGuides: (id) => {
        const path = paths.find((p) => p.id === id);
        return path ? makeGuides(path.guides, []) : [];
      },
      isPathCompleted: () => false,
    });

    expect(result).not.toBeNull();
    expect(result!.pathTitle).toBe('Getting started with Grafana');
    expect(result!.guideId).toBe('welcome');
  });

  it('returns null when all paths are complete', () => {
    const result = computeNextAction({
      paths,
      getPathProgress: () => 100,
      getPathGuides: (id) => {
        const path = paths.find((p) => p.id === id);
        return path ? makeGuides(path.guides, path.guides) : [];
      },
      isPathCompleted: () => true,
    });

    expect(result).toBeNull();
  });

  it('returns null when paths array is empty', () => {
    const result = computeNextAction({
      paths: [],
      getPathProgress: () => 0,
      getPathGuides: () => [],
      isPathCompleted: () => false,
    });

    expect(result).toBeNull();
  });

  it('skips completed paths and picks the next non-completed one', () => {
    const result = computeNextAction({
      paths,
      getPathProgress: (id) => (id === 'getting-started' ? 100 : 0),
      getPathGuides: (id) => {
        const path = paths.find((p) => p.id === id);
        if (!path) {
          return [];
        }
        const completed = id === 'getting-started' ? path.guides : [];
        return makeGuides(path.guides, completed);
      },
      isPathCompleted: (id) => id === 'getting-started',
    });

    expect(result).not.toBeNull();
    expect(result!.pathTitle).toBe('Observability basics');
    expect(result!.guideId).toBe('prom-basics');
  });

  it('prefers higher-progress in-progress path when multiple are in-progress', () => {
    const result = computeNextAction({
      paths,
      getPathProgress: (id) => {
        if (id === 'getting-started') {
          return 33;
        }
        if (id === 'observability') {
          return 66;
        }
        return 0;
      },
      getPathGuides: (id) => {
        const path = paths.find((p) => p.id === id);
        if (!path) {
          return [];
        }
        if (id === 'getting-started') {
          return makeGuides(path.guides, ['welcome']);
        }
        if (id === 'observability') {
          return makeGuides(path.guides, ['prom-basics', 'loki-basics']);
        }
        return makeGuides(path.guides, []);
      },
      isPathCompleted: () => false,
    });

    expect(result).not.toBeNull();
    expect(result!.pathTitle).toBe('Observability basics');
    expect(result!.pathProgress).toBe(66);
  });

  it('uses bundled URL when guide has no URL in metadata', () => {
    const result = computeNextAction({
      paths: [makePath('test', 'Test', ['nonexistent-guide'])],
      getPathProgress: () => 0,
      getPathGuides: () => [{ id: 'nonexistent-guide', title: 'Test Guide', completed: false, isCurrent: true }],
      isPathCompleted: () => false,
    });

    expect(result).not.toBeNull();
    expect(result!.guideUrl).toBe('bundled:nonexistent-guide');
  });
});
