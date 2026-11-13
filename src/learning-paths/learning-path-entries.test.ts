import type { CatalogPackage } from '../types/package-catalog.types';
import type { LearningPath, ResolvedAssignment } from '../types/learning-paths.types';
import { selectLearningPathEntries, selectPathAssignmentEntries } from './learning-path-entries';

const path: LearningPath = { id: 'path', title: 'Path', description: '', guides: ['guide'], badgeId: '' };
const catalogPath: CatalogPackage = {
  key: 'catalog:path',
  id: 'path',
  title: 'Path',
  format: 'path',
  source: 'grafana',
  url: 'bundled:path',
  memberIds: ['guide'],
};
const defaults = {
  paths: [path],
  onlinePaths: [],
  assignmentByTargetId: new Map<string, ResolvedAssignment>(),
  catalogItems: [catalogPath],
  catalogProgress: new Map<string, { percent: number }>(),
  getPathProgress: () => 28,
  getPathGuides: () => [],
};

it('preserves local progress when the catalogue has no saved path progress', () => {
  expect(selectLearningPathEntries(defaults)[0]?.percent).toBe(28);
});

it('uses the furthest catalogue evidence without duplicating aliases', () => {
  const entries = selectLearningPathEntries({
    ...defaults,
    paths: [],
    catalogItems: [catalogPath, { ...catalogPath, key: 'curated:path' }],
    catalogProgress: new Map([
      ['catalog:path', { percent: 25 }],
      ['curated:path', { percent: 100 }],
    ]),
    includeCompleted: true,
  });
  expect(entries).toHaveLength(1);
  expect(entries[0]?.percent).toBe(100);
});

it('keeps public and organization paths with the same ID distinct', () => {
  const entries = selectLearningPathEntries({ ...defaults, paths: [path, { ...path, isPrivate: true }] });
  expect(entries.map((entry) => entry.key)).toEqual(['grafana:path', 'organization:path']);
});

it('keeps completed paths out of the available list but includes them for completion counts', () => {
  const options = { ...defaults, getPathProgress: () => 100 };
  expect(selectLearningPathEntries(options)).toEqual([]);
  expect(selectLearningPathEntries({ ...options, includeCompleted: true })).toHaveLength(1);
});

it('applies assignment progress only to the matching path source', () => {
  const publicAssignment: ResolvedAssignment = {
    targetId: 'path',
    targetSource: 'bundled',
    title: 'Public',
    overdue: false,
    satisfied: false,
    progress: 25,
  };
  const privateAssignment: ResolvedAssignment = {
    ...publicAssignment,
    targetSource: 'app-platform',
    title: 'Private',
    progress: 75,
  };
  const entries = selectLearningPathEntries({
    ...defaults,
    paths: [path, { ...path, isPrivate: true }],
    assignmentByTargetId: new Map([
      ['grafana:path', publicAssignment],
      ['organization:path', privateAssignment],
    ]),
  });
  expect(entries.map(({ key, percent, assignment }) => [key, percent, assignment?.title])).toEqual([
    ['grafana:path', 25, 'Public'],
    ['organization:path', 75, 'Private'],
  ]);
  const legacyKeyEntries = selectLearningPathEntries({
    ...defaults,
    paths: [path],
    assignmentByTargetId: new Map([['path', privateAssignment]]),
  });
  expect(legacyKeyEntries[0]?.assignment).toBeUndefined();
});

it('keeps unavailable path obligations visible and preserves duplicate rule and track rows', () => {
  const assignment = {
    targetType: 'path',
    targetId: 'path',
    targetSource: 'app-platform',
    ruleId: 'one',
    lifecycle: 'active',
    satisfied: false,
    guides: [{ guideId: 'a', guideSource: 'app-platform', completed: true }],
  };
  const privatePath = {
    ...path,
    isPrivate: true,
    manifest: { type: 'path', milestones: ['a'], tracks: [{ trackId: 'second', label: 'Second', guides: ['b'] }] },
  };
  const entries = selectPathAssignmentEntries(
    [
      assignment,
      {
        ...assignment,
        ruleId: 'two',
        trackId: 'second',
        guides: [{ guideId: 'b', guideSource: 'app-platform', completed: false }],
      },
      { ...assignment, targetId: 'missing', guides: undefined },
    ],
    [
      {
        key: 'organization:path',
        path: privatePath,
        percent: 0,
        guides: [
          { id: 'a', title: 'A', completed: false, isCurrent: true },
          { id: 'b', title: 'B', completed: false, isCurrent: false },
        ],
      },
    ]
  );
  expect(new Set(entries.map(({ key }) => key)).size).toBe(3);
  expect(entries.map(({ percent }) => percent)).toEqual([100, 0, 0]);
  expect(entries[1]?.guides.map(({ id }) => id)).toEqual(['b']);
  expect(entries[1]?.assignment?.trackId).toBe('second');
  expect(entries[2]?.assignmentUnavailable).toBe(true);
  expect(entries[2]?.assignment?.progressUnavailable).toBe(true);
  expect(entries[2]?.path.title).toBe('missing');
  expect(
    selectPathAssignmentEntries([assignment], [{ key: 'grafana:path', path, guides: [], percent: 0 }])[0]
      ?.assignmentUnavailable
  ).toBe(true);
});

it('does not substitute a bundled path for an unresolved online or unknown-source assignment', () => {
  const entry = { key: 'grafana:path', path, guides: [], percent: 0, contentSource: 'bundled' };
  for (const targetSource of ['online-cdn', 'interactive-tutorials', 'unknown']) {
    const [row] = selectPathAssignmentEntries(
      [{ targetType: 'path', targetId: 'path', targetSource, satisfied: false, lifecycle: 'active' }],
      [entry]
    );
    expect(row?.assignmentUnavailable).toBe(true);
  }
  for (const targetSource of ['online-cdn', 'interactive-tutorials']) {
    const [row] = selectPathAssignmentEntries(
      [{ targetType: 'path', targetId: 'path', targetSource, satisfied: false, lifecycle: 'active' }],
      [{ ...entry, contentSource: 'online-cdn' }]
    );
    expect(row?.assignmentUnavailable).toBe(false);
  }
});
