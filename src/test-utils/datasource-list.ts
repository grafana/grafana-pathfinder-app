/** A controllable data source list for suites that mock the host's data source service from `jest.mock` factories. */

export interface ListedDatasource {
  uid: string;
  name: string;
  type: string;
  meta?: { builtIn?: boolean };
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

type Source = { kind: 'items'; items: ListedDatasource[] } | { kind: 'error'; error: unknown };

let source: Source = { kind: 'items', items: [] };

export function mockDatasourceList(items: ListedDatasource[]): void {
  source = { kind: 'items', items };
}

export function mockDatasourceListFailure(error: unknown = new Error('data source service unavailable')): void {
  source = { kind: 'error', error };
}

function readList(): ListedDatasource[] {
  if (source.kind === 'error') {
    throw source.error;
  }
  return source.items;
}

export const getListMock = jest.fn(readList);

export const getInstanceMock = jest.fn(async (uid: string): Promise<unknown> => ({ uid }));

export const runtimeDatasourceSrvStub = {
  getDataSourceSrv: () => ({ getList: getListMock, get: getInstanceMock }),
};
