import { renderHook } from '@testing-library/react';
import { useDiscoverMore } from './useDiscoverMore';
import { usePackageCatalog } from './package-catalog.hook';
import { onlineCatalog } from '../lib/package-catalog';
import type { CatalogPackage } from '../types/package-catalog.types';

jest.mock('./package-catalog.hook', () => ({ usePackageCatalog: jest.fn() }));
const catalogMock = usePackageCatalog as jest.Mock;
const makeItem = (
  id: string,
  source: CatalogPackage['source'] = 'grafana',
  format: CatalogPackage['format'] = 'path'
): CatalogPackage => ({
  id,
  key: `${source}:${id}`,
  title: 'Same title',
  source,
  format,
  url: `${source}:${id}`,
  memberIds: ['one', 'two'],
});

beforeEach(() =>
  catalogMock.mockReturnValue({
    items: [makeItem('a'), makeItem('b'), makeItem('a', 'organization'), makeItem('g', 'grafana', 'guide')],
    loading: false,
    scope: 'org:1',
  })
);

it('retains runtime-normalized prerequisite metadata from the shared catalog', () => {
  const label = '  Literal <b> & **syntax**  ';
  catalogMock.mockReturnValue({
    items: onlineCatalog({
      baseUrl: 'https://interactive-learning.grafana.net/packages/',
      packages: [
        {
          id: 'test-path',
          path: 'test-path/',
          type: 'path',
          manifest: {
            id: 'test-path',
            type: 'path',
            milestones: ['first', 'second'],
            prerequisites: [{ id: 'notice', label, format: 42 }],
          },
        },
      ],
    }),
    loading: false,
    scope: 'org:1',
  });
  const { result } = renderHook(() => useDiscoverMore());
  expect(result.current.items[0]).toMatchObject({
    milestoneCount: 2,
    manifest: {
      id: 'test-path',
      type: 'path',
      milestones: ['first', 'second'],
      prerequisites: [{ id: 'notice', label }],
    },
  });
});

it('uses the same catalog for published official and organization paths', () => {
  const { result } = renderHook(() => useDiscoverMore());
  expect(result.current.items.map((item) => item.key)).toEqual(['grafana:a', 'grafana:b', 'organization:a']);
  expect(result.current.items[0]).toMatchObject({ milestoneCount: 2, catalogPackage: { id: 'a' } });
});

it('excludes source/package identity while retaining same-title and source-collision paths', () => {
  const { result } = renderHook(() => useDiscoverMore({ excludeIdentities: new Set(['grafana:a']) }));
  expect(result.current.items.map((item) => item.key)).toEqual(['grafana:b', 'organization:a']);
});

it('caps the preview and exposes the full catalog for Continue learning', () => {
  const { result } = renderHook(() => useDiscoverMore({ count: 1 }));
  expect(result.current.items).toHaveLength(1);
  expect(result.current.catalog.items).toHaveLength(4);
});

it('renders available bundled paths while remote sources load', () => {
  catalogMock.mockReturnValue({ items: [makeItem('local')], loading: true, scope: 'org:1' });
  const { result } = renderHook(() => useDiscoverMore());
  expect(result.current.isLoading).toBe(false);
  expect(result.current.items[0]?.id).toBe('local');
});
