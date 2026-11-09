import type { DataSourceApi } from '@grafana/data';

import { getDataSourceResource } from './datasource-registry';

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
