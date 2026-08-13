import { filterDatasourcesByType, getDatasourceOptions, toDatasourceOptions } from './datasource-options';

const mockGetList = jest.fn();

jest.mock('@grafana/runtime', () => ({
  getDataSourceSrv: () => ({ getList: mockGetList }),
}));

jest.mock('../../lib/logging', () => ({
  logger: { warn: jest.fn(), debug: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

const ds = (name: string, uid: string, type: string) => ({ name, uid, type }) as never;

const LIST = [
  ds('Prod metrics', 'uid-prom', 'prometheus'),
  ds('AWS metrics', 'uid-amp', 'grafana-amazonprometheus-datasource'),
  ds('Prod logs', 'uid-loki', 'loki'),
  ds('Sample data', 'uid-testdata', 'grafana-testdata-datasource'),
  ds('Reporting', 'uid-mysql', 'mysql'),
];

beforeEach(() => {
  jest.clearAllMocks();
  mockGetList.mockReturnValue(LIST);
});

describe('filterDatasourcesByType', () => {
  it('offers every data source when no filter is authored', () => {
    expect(filterDatasourcesByType().map((d) => d.uid)).toEqual([
      'uid-prom',
      'uid-amp',
      'uid-loki',
      'uid-testdata',
      'uid-mysql',
    ]);
  });

  it('matches a type exactly', () => {
    expect(filterDatasourcesByType('loki').map((d) => d.uid)).toEqual(['uid-loki']);
  });

  it('matches a vendor-prefixed type by substring', () => {
    expect(filterDatasourcesByType('prometheus').map((d) => d.uid)).toEqual(['uid-prom', 'uid-amp']);
    expect(filterDatasourcesByType('testdata').map((d) => d.uid)).toEqual(['uid-testdata']);
  });

  it('ignores filter casing', () => {
    expect(filterDatasourcesByType('PROMETHEUS').map((d) => d.uid)).toEqual(['uid-prom', 'uid-amp']);
  });

  it('returns nothing when no type matches', () => {
    expect(filterDatasourcesByType('elasticsearch')).toEqual([]);
  });

  it('returns nothing rather than throwing when the service is unavailable', () => {
    mockGetList.mockImplementation(() => {
      throw new Error('srv not ready');
    });
    expect(filterDatasourcesByType('prometheus')).toEqual([]);
  });
});

describe('toDatasourceOptions', () => {
  it('values options by name, not uid', () => {
    expect(toDatasourceOptions([LIST[0]!])).toEqual([
      { label: 'Prod metrics', value: 'Prod metrics', description: 'prometheus' },
    ]);
  });
});

describe('getDatasourceOptions', () => {
  it('filters then maps, so both hosts of the picker agree', () => {
    expect(getDatasourceOptions('prometheus')).toEqual([
      { label: 'Prod metrics', value: 'Prod metrics', description: 'prometheus' },
      { label: 'AWS metrics', value: 'AWS metrics', description: 'grafana-amazonprometheus-datasource' },
    ]);
  });
});
