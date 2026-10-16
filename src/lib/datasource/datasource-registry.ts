import type { DataSourceApi, DataSourceInstanceListItem, DataSourceInstanceSettings } from '@grafana/data';
import type { DataSourceRef } from '@grafana/schema';
import { getDataSourceSrv, type BackendSrvRequest } from '@grafana/runtime';
import * as runtimeUnstable from '@grafana/runtime/unstable';

export type DataSourceListItem = DataSourceInstanceListItem;
export type DataSourceListFilters = runtimeUnstable.GetDataSourceInstanceListFilters;
export type DataSourceLookup = DataSourceRef | string;

function toListItem(settings: DataSourceInstanceSettings): DataSourceListItem {
  return {
    uid: settings.uid,
    type: settings.type,
    apiVersion: settings.apiVersion,
    name: settings.name,
    meta: settings.meta,
    readOnly: settings.readOnly,
    isDefault: settings.isDefault ?? false,
  };
}

// The async datasource APIs only exist from Grafana 13.2; older hosts resolve these named exports to undefined.
export async function listDataSources(filters?: DataSourceListFilters): Promise<DataSourceListItem[]> {
  if (typeof runtimeUnstable.getDataSourceInstanceList === 'function') {
    return runtimeUnstable.getDataSourceInstanceList(filters);
  }
  const { filter, ...rest } = filters ?? {};
  const legacyFilter = filter ? (settings: DataSourceInstanceSettings) => filter(toListItem(settings)) : undefined;
  return getDataSourceSrv()
    .getList({ ...rest, filter: legacyFilter })
    .map(toListItem);
}

export async function getDataSourceSettings(ref: DataSourceLookup): Promise<DataSourceInstanceSettings | undefined> {
  if (typeof runtimeUnstable.getDataSourceInstanceSettings === 'function') {
    return runtimeUnstable.getDataSourceInstanceSettings(ref);
  }
  return getDataSourceSrv().getInstanceSettings(ref);
}

export async function getDataSourceApi(ref: DataSourceLookup): Promise<DataSourceApi> {
  if (typeof runtimeUnstable.getDataSourceInstance === 'function') {
    return runtimeUnstable.getDataSourceInstance(ref);
  }
  return getDataSourceSrv().get(ref);
}

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
