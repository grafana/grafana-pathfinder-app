/** A controllable `@grafana/plugin-compat/datasources` for suites that mock it from `jest.mock` factories. */

import { useEffect, useState } from 'react';
import { act } from '@testing-library/react';
import type { DataSourceInstanceListItem } from '@grafana/data';

export interface ListedDatasource {
  uid: string;
  name: string;
  type: string;
  meta?: { builtIn?: boolean; id?: string };
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let source: () => Promise<ListedDatasource[]> = async () => [];

export function mockDatasourceList(items: ListedDatasource[]): void {
  source = async () => items;
}

export function mockDatasourceListFailure(error: unknown = new Error('data source service unavailable')): void {
  source = async () => {
    throw error;
  };
}

/** Every read until the returned promise settles stays loading, so a suite can assert what renders meanwhile. */
export function holdDatasourceList(): Deferred<ListedDatasource[]> {
  const deferred = createDeferred<ListedDatasource[]>();
  source = () => deferred.promise;
  return deferred;
}

interface ListFilters {
  filter?: (item: DataSourceInstanceListItem) => boolean;
}

const pendingReads = new Set<Promise<unknown>>();

async function readItems(filters?: ListFilters): Promise<DataSourceInstanceListItem[]> {
  const items = (await source()).map((ds) => ({ ...ds, meta: { ...ds.meta } }) as DataSourceInstanceListItem);
  return filters?.filter ? items.filter(filters.filter) : items;
}

function readList(filters?: ListFilters): Promise<DataSourceInstanceListItem[]> {
  const read = readItems(filters);
  pendingReads.add(read);
  read.finally(() => pendingReads.delete(read)).catch(() => {});
  return read;
}

/** Lets every read already issued settle and re-render; a held list must be resolved first or this never returns. */
export async function settleDatasourceList(): Promise<void> {
  await act(async () => {
    await Promise.allSettled(Array.from(pendingReads));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

export const getDataSourceInstanceListMock = jest.fn(readList);

export const getDataSourceInstanceMock = jest.fn(async (ref: unknown): Promise<unknown> => ({ uid: ref }));

interface ListResult {
  isLoading: boolean;
  error?: Error;
  items: DataSourceInstanceListItem[];
}

const NO_ITEMS: DataSourceInstanceListItem[] = [];

interface SettledRead {
  filter: ListFilters['filter'];
  error?: Error;
  items: DataSourceInstanceListItem[];
}

function useDataSourceInstanceList(filters?: ListFilters): ListResult {
  const [settled, setSettled] = useState<SettledRead | null>(null);
  const filter = filters?.filter;
  useEffect(() => {
    let isCurrent = true;
    getDataSourceInstanceListMock(filter ? { filter } : undefined).then(
      (items) => isCurrent && setSettled({ filter, items }),
      (error) => isCurrent && setSettled({ filter, error, items: NO_ITEMS })
    );
    return () => {
      isCurrent = false;
    };
  }, [filter]);
  if (!settled || settled.filter !== filter) {
    return { isLoading: true, items: settled?.items ?? NO_ITEMS };
  }
  return { isLoading: false, error: settled.error, items: settled.items };
}

export const pluginCompatDatasourcesStub = {
  getDataSourceInstanceList: getDataSourceInstanceListMock,
  getDataSourceInstance: getDataSourceInstanceMock,
  useDataSourceInstanceList,
};
