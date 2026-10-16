import { useMemo } from 'react';
import type { CatalogPackage } from '../types/package-catalog.types';
import type { ManifestJson } from '../types/package.types';
import { catalogIdentity } from './catalog-learning-core';
import { usePackageCatalog } from './package-catalog.hook';

export interface DiscoverMoreItem {
  id: string;
  key?: string;
  title: string;
  description?: string;
  contentUrl: string;
  milestoneCount?: number;
  manifest?: ManifestJson;
  catalogPackage?: CatalogPackage;
}

export interface UseDiscoverMoreOptions {
  excludeIdentities?: ReadonlySet<string>;
  count?: number;
}

export function toDiscoverMoreItem(item: CatalogPackage): DiscoverMoreItem {
  return {
    id: item.id,
    key: item.key,
    title: item.title,
    description: item.description,
    contentUrl: item.url,
    milestoneCount: item.memberIds?.length,
    manifest: item.packageInfo?.packageManifest as ManifestJson | undefined,
    catalogPackage: item,
  };
}

export function selectDiscoverMore(
  items: CatalogPackage[],
  excludeIdentities: ReadonlySet<string> = new Set(),
  count = 5
): DiscoverMoreItem[] {
  return items
    .filter((item) => item.format === 'path' && !excludeIdentities.has(catalogIdentity(item)))
    .sort((a, b) => a.title.localeCompare(b.title) || a.key.localeCompare(b.key))
    .slice(0, count)
    .map(toDiscoverMoreItem);
}

export function useDiscoverMore(options: UseDiscoverMoreOptions = {}) {
  const catalog = usePackageCatalog();
  const { excludeIdentities, count = 5 } = options;
  const items = useMemo(
    () => selectDiscoverMore(catalog.items, excludeIdentities, count),
    [catalog.items, excludeIdentities, count]
  );
  return { items, isLoading: catalog.loading && items.length === 0, catalog };
}

export type UseDiscoverMoreReturn = ReturnType<typeof useDiscoverMore>;
