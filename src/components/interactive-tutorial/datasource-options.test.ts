import { filterDatasourcesByType, toDatasourceOptions } from './datasource-options';
import { logger } from '../../lib/logging';
import { mockDatasourceList, mockDatasourceListFailure } from '../../test-utils/datasource-list';

jest.mock(
  '@grafana/plugin-compat/datasources',
  () => require('../../test-utils/datasource-list').pluginCompatDatasourcesStub
);

jest.mock('../../lib/logging', () => ({
  logger: { warn: jest.fn(), debug: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

const ds = (name: string, uid: string, type: string) => ({ name, uid, type, meta: {} }) as never;

const LIST = [
  ds('Prod metrics', 'uid-prom', 'prometheus'),
  ds('AWS metrics', 'uid-amp', 'grafana-amazonprometheus-datasource'),
  ds('Prod logs', 'uid-loki', 'loki'),
  ds('Sample data', 'uid-testdata', 'grafana-testdata-datasource'),
  ds('Reporting', 'uid-mysql', 'mysql'),
];

beforeEach(() => {
  jest.clearAllMocks();
  mockDatasourceList(LIST);
});

describe('filterDatasourcesByType', () => {
  it('offers every data source when no filter is authored', async () => {
    expect((await filterDatasourcesByType()).map((d) => d.uid)).toEqual([
      'uid-prom',
      'uid-amp',
      'uid-loki',
      'uid-testdata',
      'uid-mysql',
    ]);
  });

  it('matches a type exactly', async () => {
    expect((await filterDatasourcesByType('loki')).map((d) => d.uid)).toEqual(['uid-loki']);
  });

  it('matches a vendor-prefixed type by substring', async () => {
    expect((await filterDatasourcesByType('prometheus')).map((d) => d.uid)).toEqual(['uid-prom', 'uid-amp']);
    expect((await filterDatasourcesByType('testdata')).map((d) => d.uid)).toEqual(['uid-testdata']);
  });

  it('ignores filter casing', async () => {
    expect((await filterDatasourcesByType('PROMETHEUS')).map((d) => d.uid)).toEqual(['uid-prom', 'uid-amp']);
  });

  it('returns nothing when no type matches', async () => {
    expect(await filterDatasourcesByType('elasticsearch')).toEqual([]);
  });

  it('returns nothing rather than rejecting when the service is unavailable, and logs why', async () => {
    const failure = new Error('srv not ready');
    mockDatasourceListFailure(failure);
    expect(await filterDatasourcesByType('prometheus')).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith('[datasource-options] Failed to get datasources', { error: failure });
  });
});

describe('toDatasourceOptions', () => {
  it('values options by name, not uid', () => {
    expect(toDatasourceOptions([LIST[0]!])).toEqual([
      { label: 'Prod metrics', value: 'Prod metrics', description: 'prometheus' },
    ]);
  });
});
