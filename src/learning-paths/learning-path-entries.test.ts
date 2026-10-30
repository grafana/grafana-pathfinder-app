import type { CatalogPackage } from '../types/package-catalog.types';
import type { LearningPath, ResolvedAssignment } from '../types/learning-paths.types';
import { selectLearningPathEntries } from './learning-path-entries';

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
