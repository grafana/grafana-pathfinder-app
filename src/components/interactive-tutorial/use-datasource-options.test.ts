import { act, renderHook } from '@testing-library/react';

import { useDatasourceOptions } from './use-datasource-options';
import {
  getDataSourceInstanceListMock,
  holdDatasourceList,
  mockDatasourceList,
  mockDatasourceListFailure,
  type ListedDatasource,
} from '../../test-utils/datasource-list';

jest.mock(
  '@grafana/plugin-compat/datasources',
  () => require('../../test-utils/datasource-list').pluginCompatDatasourcesStub
);
jest.mock('../../lib/logging', () => ({ logger: { warn: jest.fn(), debug: jest.fn(), error: jest.fn() } }));

const LIST: ListedDatasource[] = [
  { uid: 'prom-1', name: 'Prod metrics', type: 'prometheus' },
  { uid: 'loki-1', name: 'Prod logs', type: 'loki' },
];

beforeEach(() => jest.clearAllMocks());

it('reports loading, not an empty list, until the list arrives', async () => {
  const list = holdDatasourceList();
  const { result } = renderHook(() => useDatasourceOptions('prometheus'));

  expect(result.current).toEqual({ datasources: [], options: [], loading: true });

  await act(async () => list.resolve(LIST));

  expect(result.current.loading).toBe(false);
  expect(result.current.datasources.map((ds) => ds.uid)).toEqual(['prom-1']);
  expect(result.current.options).toEqual([{ label: 'Prod metrics', value: 'Prod metrics', description: 'prometheus' }]);
});

it('settles to an empty, loaded list when nothing matches or the service fails', async () => {
  mockDatasourceList(LIST);
  const noMatch = renderHook(() => useDatasourceOptions('tempo'));
  await act(async () => {});
  expect(noMatch.result.current).toEqual({ datasources: [], options: [], loading: false });

  mockDatasourceListFailure();
  const failed = renderHook(() => useDatasourceOptions('prometheus'));
  await act(async () => {});
  expect(failed.result.current).toEqual({ datasources: [], options: [], loading: false });
});

it('goes back to loading on a filter change instead of offering the list for the old filter', async () => {
  mockDatasourceList(LIST);
  const { result, rerender } = renderHook(({ filter }) => useDatasourceOptions(filter), {
    initialProps: { filter: 'prometheus' },
  });
  await act(async () => {});
  expect(result.current.datasources.map((ds) => ds.uid)).toEqual(['prom-1']);

  const list = holdDatasourceList();
  rerender({ filter: 'loki' });
  expect(result.current).toEqual({ datasources: [], options: [], loading: true });

  await act(async () => list.resolve(LIST));
  expect(result.current.datasources.map((ds) => ds.uid)).toEqual(['loki-1']);
});

it('ignores a list that arrives for a superseded filter', async () => {
  const stale = holdDatasourceList();
  const { result, rerender } = renderHook(({ filter }) => useDatasourceOptions(filter), {
    initialProps: { filter: 'prometheus' },
  });
  const current = holdDatasourceList();
  rerender({ filter: 'loki' });

  await act(async () => current.resolve(LIST));
  await act(async () => stale.resolve([{ uid: 'prom-9', name: 'Late', type: 'prometheus' }]));

  expect(result.current.datasources.map((ds) => ds.uid)).toEqual(['loki-1']);
});

it('neither fetches nor reports loading when disabled', () => {
  const { result } = renderHook(() => useDatasourceOptions('prometheus', false));
  expect(result.current).toEqual({ datasources: [], options: [], loading: false });
  expect(getDataSourceInstanceListMock).not.toHaveBeenCalled();
});
