import { pathCatalogIdentities, selectContinueLearning } from './catalog-learning-core';
import type { CatalogPackage } from '../types/package-catalog.types';
import type { LearningPath } from '../types/learning-paths.types';

const item = (id: string, source: CatalogPackage['source'] = 'grafana'): CatalogPackage => ({
  key: `${source}:${id}`,
  id,
  source,
  format: 'path',
  title: 'Same title',
  url: `${source}:${id}`,
});

it('uses source and package identity for paths displayed in courses', () => {
  expect(pathCatalogIdentities([{ id: 'shared', isPrivate: true }, { id: 'local' }] as LearningPath[])).toEqual(
    new Set(['organization:shared', 'grafana:local'])
  );
});

it('only continues positive incomplete progress and preserves source collisions', () => {
  const items = [
    item('same'),
    item('same', 'organization'),
    item('zero'),
    item('done'),
    item('invalid'),
    item('missing'),
    { ...item('guide'), format: 'guide' as const },
  ];
  const progress = new Map([
    ['grafana:same', { percent: 50 }],
    ['organization:same', { percent: 60 }],
    ['grafana:zero', { percent: 0 }],
    ['grafana:done', { percent: 100 }],
    ['grafana:invalid', { percent: NaN }],
    ['grafana:guide', { percent: 20 }],
  ]);
  expect(selectContinueLearning(items, progress, new Set(['organization:same'])).map((entry) => entry.key)).toEqual([
    'grafana:same',
    'grafana:guide',
  ]);
});
