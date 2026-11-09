import type { DataSourceApi, DataSourceInstanceListItem } from '@grafana/data';
import type { BackendSrvRequest } from '@grafana/runtime';

export {
  getDataSourceInstance as getDataSourceApi,
  getDataSourceInstanceList as listDataSources,
  getDataSourceInstanceSettings as getDataSourceSettings,
} from '@grafana/plugin-compat/datasources';

export type DataSourceListItem = DataSourceInstanceListItem;

interface ResourceCapable {
  getResource<T>(path: string, params?: BackendSrvRequest['params']): Promise<T>;
}

function hasResources(ds: DataSourceApi): ds is DataSourceApi & ResourceCapable {
  return typeof (ds as Partial<ResourceCapable>).getResource === 'function';
}

export async function getDataSourceResource<T>(
  ds: DataSourceApi,
  path: string,
  params?: BackendSrvRequest['params']
): Promise<T> {
  if (!hasResources(ds)) {
    throw new Error(`Data source ${ds.name} does not expose resource endpoints`);
  }
  return ds.getResource<T>(path, params);
}
