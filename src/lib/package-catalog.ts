import { isAllowedContentUrl } from '../security';
import { packageIdSchema } from '../types/package.schema';
import { RuntimeManifestJsonObjectSchema } from './runtime-manifest';
import { GuideStatsSummarySchema } from '../types/guide-stats.schema';
import { getManifestMemberIds, type RepositoryJson } from '../types/package.types';
import type { CatalogFilters, CatalogPackage } from '../types/package-catalog.types';
import type { LearningPath, GuideMetadataEntry } from '../types/learning-paths.types';
import type { CustomGuideRepositoryEntry } from './custom-guide-repository-client';
import { buildPackageFileUrl, type PackageRecommendationsResponse } from './package-recommendations-client';
import { GUIDE_STATS_VERSION } from './guide-stats/summary';

const EXCLUDED_BUNDLED_IDS = new Set(['e2e-framework-test', 'json-guide-demo']);

function displayText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function positiveMinutes(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function activityCount(stats: unknown): number | undefined {
  const parsed = GuideStatsSummarySchema.safeParse(stats);
  return parsed.success && parsed.data.version === GUIDE_STATS_VERSION ? parsed.data.completableBlockCount : undefined;
}

const ORGANIZATION_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,252}$/;

const isPublicId = (id: string) => packageIdSchema.safeParse(id).success;

function members(manifest?: Record<string, unknown>, isValidId = isPublicId): string[] | undefined {
  if (!Array.isArray(manifest?.milestones)) {
    return undefined;
  }
  const ids = manifest.milestones.filter((id): id is string => typeof id === 'string' && isValidId(id));
  return ids.length === manifest.milestones.length ? ids : undefined;
}

export function bundledCatalog(
  repository: RepositoryJson,
  guideMetadata: Record<string, GuideMetadataEntry>
): CatalogPackage[] {
  return Object.entries(repository)
    .filter(([id, entry]) => !EXCLUDED_BUNDLED_IDS.has(id) && entry.category !== 'testing')
    .map(([id, entry]) => ({
      key: `bundled:${id}`,
      id,
      title: displayText(entry.title) || id,
      description: entry.description,
      format: entry.type === 'guide' ? 'guide' : 'path',
      source: 'grafana',
      category: entry.category,
      url: `bundled:${id}/content.json`,
      estimatedMinutes: positiveMinutes(entry.estimatedMinutes) ?? positiveMinutes(guideMetadata[id]?.estimatedMinutes),
      activityCount: activityCount(entry.stats),
      memberIds: members(entry),
      packageInfo: {
        packageId: id,
        packageManifest: { ...entry, id, repository: 'bundled' },
        repository: 'bundled',
      },
    }));
}

export function onlineCatalog(response: PackageRecommendationsResponse): CatalogPackage[] {
  return response.packages.flatMap((entry) => {
    if (!packageIdSchema.safeParse(entry.id).success) {
      return [];
    }
    const url = buildPackageFileUrl(response.baseUrl, entry.path, 'content.json');
    if (!isAllowedContentUrl(url)) {
      return [];
    }
    const parsed = RuntimeManifestJsonObjectSchema.safeParse(entry.manifest);
    const manifest = parsed.success ? parsed.data : undefined;
    if (EXCLUDED_BUNDLED_IDS.has(entry.id) || manifest?.category === 'testing') {
      return [];
    }
    const type = manifest?.type ?? entry.type ?? 'guide';
    if (type !== 'guide' && type !== 'path' && type !== 'journey') {
      return [];
    }
    return [
      {
        key: `online-cdn:${entry.id}`,
        id: entry.id,
        title: displayText(entry.title) || entry.id,
        description: displayText(entry.description) ?? manifest?.description,
        format: type === 'guide' ? ('guide' as const) : ('path' as const),
        source: 'grafana' as const,
        category: manifest?.category,
        url,
        estimatedMinutes: positiveMinutes(manifest?.estimatedMinutes),
        activityCount: activityCount(manifest?.stats),
        memberIds: members(manifest),
        packageInfo: manifest
          ? {
              packageId: entry.id,
              packageManifest: { ...manifest, id: entry.id },
              repository: 'online-cdn',
            }
          : undefined,
      },
    ];
  });
}

export function organizationCatalog(entries: CustomGuideRepositoryEntry[]): CatalogPackage[] {
  return entries.flatMap((entry) => {
    if (entry.status !== 'published' || typeof entry.id !== 'string' || !ORGANIZATION_ID.test(entry.id)) {
      return [];
    }
    const manifest = { ...entry.manifest, id: entry.id, repository: 'app-platform' };
    return [
      {
        key: `app-platform:${entry.id}`,
        id: entry.id,
        title: displayText(entry.title) || entry.id,
        description: displayText(entry.manifest?.description),
        format: manifest.type === 'path' || manifest.type === 'journey' ? ('path' as const) : ('guide' as const),
        source: 'organization' as const,
        category: displayText(entry.manifest?.category),
        url: `backend-guide:${entry.id}`,
        memberIds: members(manifest, (id) => ORGANIZATION_ID.test(id)),
        packageInfo: { packageId: entry.id, packageManifest: manifest, repository: 'app-platform' },
      },
    ];
  });
}

export function curatedCatalog(paths: LearningPath[]): CatalogPackage[] {
  return paths
    .filter((path) => !path.isPrivate)
    .map((path) => ({
      key: `curated:${path.id}`,
      id: path.id,
      title: path.title,
      description: path.description,
      format: 'path',
      source: 'grafana',
      url: path.url || '',
      estimatedMinutes: positiveMinutes(path.estimatedMinutes),
      memberIds: path.url ? undefined : path.guides,
      curatedPath: path,
    }));
}

export function mergeCatalog(...sources: CatalogPackage[][]): CatalogPackage[] {
  const seen = new Set<string>();
  return sources.flat().filter((item) => {
    const identity = `${item.source}:${item.id}`;
    if (seen.has(identity)) {
      return false;
    }
    seen.add(identity);
    return true;
  });
}

export function withoutPathMembers(items: CatalogPackage[]): CatalogPackage[] {
  const members = new Set(
    items.flatMap((item) =>
      item.format === 'path'
        ? [...(item.memberIds ?? []), ...getManifestMemberIds(item.packageInfo?.packageManifest)].map(
            (id) => `${item.source}:${id}`
          )
        : []
    )
  );
  return items.filter((item) => item.format === 'path' || !members.has(`${item.source}:${item.id}`));
}

export function filterCatalog(items: CatalogPackage[], filters: CatalogFilters): CatalogPackage[] {
  const query = filters.query.trim().toLocaleLowerCase();
  const tokens = query.split(/\s+/).filter(Boolean);
  const rank = (item: CatalogPackage) => {
    const title = item.title.toLocaleLowerCase();
    return title === query ? 0 : tokens.every((token) => title.includes(token)) ? 1 : 2;
  };
  return items
    .filter((item) => {
      const haystack = [item.title, item.description, item.category].filter(Boolean).join(' ').toLocaleLowerCase();
      return (
        (filters.format === 'all' || item.format === filters.format) &&
        (filters.source === 'all' || item.source === filters.source) &&
        (filters.category === 'all' || (item.category || 'uncategorized') === filters.category) &&
        tokens.every((token) => haystack.includes(token))
      );
    })
    .sort((a, b) => (query ? rank(a) - rank(b) : 0) || a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
}
