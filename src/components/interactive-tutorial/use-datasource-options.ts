import { useEffect, useMemo, useState } from 'react';
import type { DataSourceInstanceListItem } from '@grafana/data';
import type { ComboboxOption } from '@grafana/ui';

import { filterDatasourcesByType, toDatasourceOptions } from './datasource-options';

export interface DatasourceOptions {
  datasources: DataSourceInstanceListItem[];
  options: Array<ComboboxOption<string>>;
  /** Distinct from an empty list: a remembered pick is not missing until the list has arrived. */
  loading: boolean;
}

interface LoadedList {
  filter: string | undefined;
  datasources: DataSourceInstanceListItem[];
}

const NO_DATASOURCES: DataSourceInstanceListItem[] = [];

export function useDatasourceOptions(filter: string | undefined, enabled = true): DatasourceOptions {
  const [loaded, setLoaded] = useState<LoadedList | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let isCurrent = true;
    filterDatasourcesByType(filter).then((datasources) => {
      if (isCurrent) {
        setLoaded({ filter, datasources });
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [filter, enabled]);

  const isLoaded = enabled && loaded !== null && loaded.filter === filter;
  const datasources = isLoaded ? loaded.datasources : NO_DATASOURCES;
  const options = useMemo(() => toDatasourceOptions(datasources), [datasources]);

  return { datasources, options, loading: enabled && !isLoaded };
}
