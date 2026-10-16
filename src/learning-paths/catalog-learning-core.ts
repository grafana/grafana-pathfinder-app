import type { CatalogPackage } from '../types/package-catalog.types';
import type { LearningPath } from '../types/learning-paths.types';
import type { CatalogProgress } from './catalog-progress.hook';

export function catalogIdentity(item: Pick<CatalogPackage, 'id' | 'source'>): string {
  return `${item.source}:${item.id}`;
}

export function pathCatalogIdentities(paths: LearningPath[]): Set<string> {
  return new Set(paths.map((path) => `${path.isPrivate ? 'organization' : 'grafana'}:${path.id}`));
}

export function selectContinueLearning(
  items: CatalogPackage[],
  progress: ReadonlyMap<string, CatalogProgress>,
  excludeIdentities: ReadonlySet<string>
): CatalogPackage[] {
  return items
    .filter((item) => {
      const percent = progress.get(item.key)?.percent ?? 0;
      return (
        item.source === 'grafana' &&
        Number.isFinite(percent) &&
        percent > 0 &&
        percent < 100 &&
        !excludeIdentities.has(catalogIdentity(item))
      );
    })
    .sort(
      (a, b) =>
        (progress.get(b.key)?.percent ?? 0) - (progress.get(a.key)?.percent ?? 0) || a.title.localeCompare(b.title)
    );
}
