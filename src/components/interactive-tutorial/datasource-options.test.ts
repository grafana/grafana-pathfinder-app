import { filterDatasourcesByType, toDatasourceOptions } from './datasource-options';

const ds = (name: string, uid: string, type: string) => ({ name, uid, type }) as never;

const LIST = [
  ds('Prod metrics', 'uid-prom', 'prometheus'),
  ds('AWS metrics', 'uid-amp', 'grafana-amazonprometheus-datasource'),
  ds('Prod logs', 'uid-loki', 'loki'),
  ds('Sample data', 'uid-testdata', 'grafana-testdata-datasource'),
  ds('Reporting', 'uid-mysql', 'mysql'),
];

describe('filterDatasourcesByType', () => {
  it('offers every data source when no filter is authored', () => {
    expect(filterDatasourcesByType(LIST).map((d) => d.uid)).toEqual([
      'uid-prom',
      'uid-amp',
      'uid-loki',
      'uid-testdata',
      'uid-mysql',
    ]);
  });

  it('matches a type exactly', () => {
    expect(filterDatasourcesByType(LIST, 'loki').map((d) => d.uid)).toEqual(['uid-loki']);
  });

  it('matches a vendor-prefixed type by substring', () => {
    expect(filterDatasourcesByType(LIST, 'prometheus').map((d) => d.uid)).toEqual(['uid-prom', 'uid-amp']);
    expect(filterDatasourcesByType(LIST, 'testdata').map((d) => d.uid)).toEqual(['uid-testdata']);
  });

  it('ignores filter casing', () => {
    expect(filterDatasourcesByType(LIST, 'PROMETHEUS').map((d) => d.uid)).toEqual(['uid-prom', 'uid-amp']);
  });

  it('returns nothing when no type matches', () => {
    expect(filterDatasourcesByType(LIST, 'elasticsearch')).toEqual([]);
  });
});

describe('toDatasourceOptions', () => {
  it('values options by name, not uid', () => {
    expect(toDatasourceOptions([LIST[0]!])).toEqual([
      { label: 'Prod metrics', value: 'Prod metrics', description: 'prometheus' },
    ]);
  });
});
