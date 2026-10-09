import { useEffect, useState } from 'react';

import { listDataSources, type DataSourceListItem } from '../../lib/datasource/datasource-registry';
import { logger } from '../../lib/logging';

export interface DataSourceListState {
  dataSources: DataSourceListItem[];
  loading: boolean;
}

const IDLE: DataSourceListState = { dataSources: [], loading: false };
const LOADING: DataSourceListState = { dataSources: [], loading: true };

/** Lists the data sources the viewer can query; a failed lookup reads as an empty list. */
export function useDataSourceList(enabled = true): DataSourceListState {
  const [state, setState] = useState<DataSourceListState>(LOADING);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    listDataSources()
      .catch((error: unknown) => {
        logger.warn('[useDataSourceList] Failed to list data sources', { error });
        return [];
      })
      .then((dataSources) => {
        if (!cancelled) {
          setState({ dataSources, loading: false });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return enabled ? state : IDLE;
}
