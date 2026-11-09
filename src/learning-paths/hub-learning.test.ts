import type { LearningPath, PathGuide, ResolvedAssignment } from '../types/learning-paths.types';
import { selectHubResume, selectHubStats, type HubLearningDeps } from './hub-learning';

const path = (id: string, extra: Partial<LearningPath> = {}): LearningPath => ({
  id,
  title: `Path ${id}`,
  description: '',
  guides: [`${id}-1`, `${id}-2`, `${id}-3`],
  badgeId: `${id}-badge`,
  ...extra,
});

const guidesFor = (id: string, completed: number): PathGuide[] =>
  [1, 2, 3].map((n) => ({
    id: `${id}-${n}`,
    title: `Guide ${id}-${n}`,
    completed: n <= completed,
    isCurrent: n === completed + 1,
    url: `bundled:${id}-${n}`,
  }));

const assignment = (targetId: string, extra: Partial<ResolvedAssignment> = {}): ResolvedAssignment => ({
  targetId,
  title: `Path ${targetId}`,
  overdue: false,
  satisfied: false,
  progress: 0,
  ...extra,
});

function deps(
  paths: LearningPath[],
  completedByPath: Record<string, number>,
  assignments: ResolvedAssignment[] = []
): HubLearningDeps {
  return {
    paths,
    assignmentByTargetId: new Map(assignments.map((a) => [a.targetId, a])),
    getPathProgress: (id) => Math.round(((completedByPath[id] ?? 0) / 3) * 100),
    isPathCompleted: (id) => (completedByPath[id] ?? 0) >= 3,
    getPathGuides: (id) => guidesFor(id, completedByPath[id] ?? 0),
  };
}

describe('selectHubResume', () => {
  it('returns null when nothing is started', () => {
    expect(selectHubResume(deps([path('a'), path('b')], {}))).toBeNull();
  });

  it('ignores a path that is not started even though a next guide exists', () => {
    expect(selectHubResume(deps([path('a')], { a: 0 }))).toBeNull();
  });

  it('skips completed paths', () => {
    expect(selectHubResume(deps([path('a')], { a: 3 }))).toBeNull();
  });

  it('picks the started path furthest along and numbers its current guide', () => {
    const resume = selectHubResume(deps([path('a'), path('b')], { a: 1, b: 2 }));

    expect(resume).toMatchObject({
      pathId: 'b',
      pathTitle: 'Path b',
      guideTitle: 'Guide b-3',
      guideUrl: 'bundled:b-3',
      percent: 67,
      moduleNumber: 3,
      moduleCount: 3,
    });
  });

  it('prefers the assignment progress and carries the assigned track', () => {
    const resume = selectHubResume(
      deps([path('a'), path('b')], { a: 1, b: 2 }, [
        assignment('a', { progress: 90, trackId: 'ops', trackLabel: 'Operations' }),
      ])
    );

    expect(resume).toMatchObject({ pathId: 'a', percent: 90, trackId: 'ops', trackLabel: 'Operations' });
  });

  it('treats a satisfied assignment as finished', () => {
    expect(
      selectHubResume(deps([path('a')], { a: 1 }, [assignment('a', { satisfied: true, progress: 100 })]))
    ).toBeNull();
  });

  it('falls back to the path url and keeps the manifest of a package-backed path', () => {
    const manifest = { id: 'a', type: 'path' };
    const packaged = path('a', { url: 'https://example.com/a/', manifest });
    const withoutUrls = (id: string): PathGuide[] => guidesFor(id, 1).map(({ url: _url, ...guide }) => guide);
    const resume = selectHubResume({ ...deps([packaged], { a: 1 }), getPathGuides: withoutUrls });

    expect(resume).toMatchObject({ guideUrl: 'https://example.com/a/', pathUrl: 'https://example.com/a/', manifest });
  });

  it('marks a resume from an organization path as private', () => {
    expect(selectHubResume(deps([path('a', { isPrivate: true })], { a: 1 }))?.isPrivate).toBe(true);
    expect(selectHubResume(deps([path('b')], { b: 1 }))?.isPrivate).toBeUndefined();
  });

  it('skips a path with no current guide', () => {
    const none = (id: string): PathGuide[] => guidesFor(id, 1).map((guide) => ({ ...guide, isCurrent: false }));
    expect(selectHubResume({ ...deps([path('a')], { a: 1 }), getPathGuides: none })).toBeNull();
  });
});

describe('selectHubStats', () => {
  const now = Date.now();
  const inDays = (days: number) => new Date(now + days * 86_400_000).toISOString();

  it('counts assignments, started paths and completed guides', () => {
    const d = deps([path('a'), path('b'), path('c')], { a: 1, b: 3, c: 0 });
    const stats = selectHubStats(d, [assignment('a'), assignment('b')], 7);

    expect(stats).toMatchObject({ assignments: 2, inProgress: 1, completed: 7 });
    expect(stats.nextDue).toBeUndefined();
  });

  it('reports the first assignment that has a due date', () => {
    const d = deps([path('a')], {});
    const stats = selectHubStats(d, [assignment('x'), assignment('y', { dueAt: inDays(3) })], 0);

    expect(stats.nextDue).toMatchObject({ tone: 'later', days: 3 });
  });

  it('marks a past due date as overdue', () => {
    const d = deps([path('a')], {});
    const stats = selectHubStats(d, [assignment('y', { dueAt: inDays(-2), overdue: true })], 0);

    expect(stats.nextDue?.tone).toBe('overdue');
  });
});
