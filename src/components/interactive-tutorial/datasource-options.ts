import type { DataSourceInstanceSettings } from '@grafana/data';
import type { ComboboxOption } from '@grafana/ui';
import { getDataSourceSrv } from '@grafana/runtime';
import { logger } from '../../lib/logging';

/**
 * Data sources an author's `datasourceFilter` offers, matched case-insensitively
 * on the type by exact or substring match — so `"prometheus"` also offers
 * `grafana-amazonprometheus-datasource`, and `"testdata"` offers
 * `grafana-testdata-datasource`.
 */
export function filterDatasourcesByType(filter?: string): DataSourceInstanceSettings[] {
  try {
    const datasources = getDataSourceSrv().getList();
    if (!filter) {
      return datasources;
    }
    const filterLower = filter.toLowerCase();
    return datasources.filter((ds) => {
      const typeLower = ds.type.toLowerCase();
      return typeLower === filterLower || typeLower.includes(filterLower);
    });
  } catch (error) {
    logger.warn('[datasource-options] Failed to get datasources', { error });
    return [];
  }
}

/** Valued by name, not uid — a name is what `{{variable}}` and reftarget selectors match. */
export function toDatasourceOptions(datasources: DataSourceInstanceSettings[]): Array<ComboboxOption<string>> {
  return datasources.map((ds) => ({
    label: ds.name,
    value: ds.name,
    description: ds.type,
  }));
}
