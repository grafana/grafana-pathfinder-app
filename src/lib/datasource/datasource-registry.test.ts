import type { DataSourceApi, DataSourceInstanceSettings } from '@grafana/data';

import { getDataSourceApi, getDataSourceResource, getDataSourceSettings, listDataSources } from './datasource-registry';

jest.mock('@grafana/runtime/unstable', () => ({ __esModule: true }));
const mockUnstable: Record<string, unknown> = jest.requireMock('@grafana/runtime/unstable');

const mockSrv = { getList: jest.fn(), getInstanceSettings: jest.fn(), get: jest.fn() };
jest.mock('@grafana/runtime', () => ({ getDataSourceSrv: () => mockSrv }));

const settings = (name: string, overrides: Partial<DataSourceInstanceSettings> = {}) =>
  ({
    id: 7,
    uid: `uid-${name}`,
    name,
    type: 'prometheus',
    apiVersion: 'v1',
    meta: { id: 'prometheus', builtIn: false },
    readOnly: false,
    jsonData: { secret: 'not a list field' },
    url: '/api/datasources/proxy/7',
    ...overrides,
  }) as unknown as DataSourceInstanceSettings;

const UNSTABLE_FUNCTIONS = ['getDataSourceInstanceList', 'getDataSourceInstanceSettings', 'getDataSourceInstance'];

beforeEach(() => {
  jest.resetAllMocks();
  for (const name of UNSTABLE_FUNCTIONS) {
    delete mockUnstable[name];
  }
});

describe('on a host with the async datasource APIs', () => {
  beforeEach(() => {
    for (const name of UNSTABLE_FUNCTIONS) {
      mockUnstable[name] = jest.fn();
    }
  });

  it('lists through the runtime and passes filters through untouched', async () => {
    const items = [{ uid: 'a', name: 'A', type: 'loki' }];
    (mockUnstable.getDataSourceInstanceList as jest.Mock).mockResolvedValue(items);
    const filters = { all: true, filter: () => true };

    await expect(listDataSources(filters)).resolves.toBe(items);
    expect(mockUnstable.getDataSourceInstanceList).toHaveBeenCalledWith(filters);
    expect(mockSrv.getList).not.toHaveBeenCalled();
  });

  it('resolves settings and instances through the runtime', async () => {
    const ds = { uid: 'a' } as DataSourceApi;
    (mockUnstable.getDataSourceInstanceSettings as jest.Mock).mockResolvedValue(settings('A'));
    (mockUnstable.getDataSourceInstance as jest.Mock).mockResolvedValue(ds);

    await expect(getDataSourceSettings('uid-A')).resolves.toMatchObject({ name: 'A' });
    await expect(getDataSourceApi({ uid: 'a', type: 'loki' })).resolves.toBe(ds);
    expect(mockUnstable.getDataSourceInstance).toHaveBeenCalledWith({ uid: 'a', type: 'loki' });
    expect(mockSrv.getInstanceSettings).not.toHaveBeenCalled();
    expect(mockSrv.get).not.toHaveBeenCalled();
  });
});

describe('on a host before 13.2', () => {
  it('falls back to the legacy list, narrowed to the slim item shape', async () => {
    mockSrv.getList.mockReturnValue([settings('A', { isDefault: true }), settings('B')]);

    const items = await listDataSources();

    expect(items).toEqual([
      {
        uid: 'uid-A',
        name: 'A',
        type: 'prometheus',
        apiVersion: 'v1',
        meta: { id: 'prometheus', builtIn: false },
        readOnly: false,
        isDefault: true,
      },
      expect.objectContaining({ uid: 'uid-B', isDefault: false }),
    ]);
    expect(items[0]).not.toHaveProperty('jsonData');
  });

  it('hands the slim item to the caller filter on the legacy path too', async () => {
    mockSrv.getList.mockImplementation(({ filter }) =>
      [settings('A'), settings('B', { meta: { builtIn: true } as never })].filter(filter)
    );
    const seen: unknown[] = [];

    const items = await listDataSources({
      all: true,
      filter: (item) => {
        seen.push(item);
        return !item.meta.builtIn;
      },
    });

    expect(items.map((item) => item.name)).toEqual(['A']);
    expect(seen.every((item) => !(item as object).hasOwnProperty('jsonData'))).toBe(true);
    expect(mockSrv.getList).toHaveBeenCalledWith(expect.objectContaining({ all: true }));
  });

  it('rejects rather than throwing when the legacy service is not ready', async () => {
    mockSrv.getList.mockImplementation(() => {
      throw new Error('srv not ready');
    });

    await expect(listDataSources()).rejects.toThrow('srv not ready');
  });

  it('falls back to the legacy settings and instance lookups', async () => {
    const ds = { uid: 'a' } as DataSourceApi;
    mockSrv.getInstanceSettings.mockReturnValue(settings('A'));
    mockSrv.get.mockResolvedValue(ds);

    await expect(getDataSourceSettings('uid-A')).resolves.toMatchObject({ name: 'A' });
    await expect(getDataSourceApi('uid-A')).resolves.toBe(ds);
    expect(mockSrv.getInstanceSettings).toHaveBeenCalledWith('uid-A');
    expect(mockSrv.get).toHaveBeenCalledWith('uid-A');
  });
});

describe('getDataSourceResource', () => {
  it('reads through the data source instance', async () => {
    const getResource = jest.fn().mockResolvedValue(['a']);
    const ds = { name: 'Tempo', getResource } as unknown as DataSourceApi;

    await expect(getDataSourceResource(ds, 'labelValues', { label: 'x' })).resolves.toEqual(['a']);
    expect(getResource).toHaveBeenCalledWith('labelValues', { label: 'x' });
  });

  it('rejects for a data source without resource endpoints', async () => {
    await expect(getDataSourceResource({ name: 'Frontend' } as DataSourceApi, 'x')).rejects.toThrow(
      'Data source Frontend does not expose resource endpoints'
    );
  });
});
