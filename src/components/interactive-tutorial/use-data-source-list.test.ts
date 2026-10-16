import { renderHook, waitFor } from '@testing-library/react';

import { useDataSourceList } from './use-data-source-list';

const mockListDataSources = jest.fn();
jest.mock('../../lib/datasource/datasource-registry', () => ({
  listDataSources: () => mockListDataSources(),
}));
jest.mock('../../lib/logging', () => ({ logger: { warn: jest.fn() } }));

const LIST = [{ uid: 'prom-1', name: 'Prometheus', type: 'prometheus' }];

beforeEach(() => {
  mockListDataSources.mockReset();
});

it('reports loading until the list resolves', async () => {
  mockListDataSources.mockResolvedValue(LIST);
  const { result } = renderHook(() => useDataSourceList());

  expect(result.current).toEqual({ dataSources: [], loading: true });
  await waitFor(() => expect(result.current).toEqual({ dataSources: LIST, loading: false }));
});

it('reads a failed lookup as an empty list rather than loading forever', async () => {
  mockListDataSources.mockRejectedValue(new Error('srv not ready'));
  const { result } = renderHook(() => useDataSourceList());

  await waitFor(() => expect(result.current).toEqual({ dataSources: [], loading: false }));
});

it('does not ask for the list when disabled', () => {
  const { result } = renderHook(() => useDataSourceList(false));

  expect(result.current).toEqual({ dataSources: [], loading: false });
  expect(mockListDataSources).not.toHaveBeenCalled();
});

it('ignores a list that resolves after unmount', async () => {
  let resolve: (value: unknown) => void = () => {};
  mockListDataSources.mockReturnValue(new Promise((r) => (resolve = r)));
  const { result, unmount } = renderHook(() => useDataSourceList());

  unmount();
  resolve(LIST);
  await Promise.resolve();
  expect(result.current.loading).toBe(true);
});
