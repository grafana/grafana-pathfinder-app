import { normalizeGuideId } from '../completion-records/completion-identity';
import type { CatalogPackage } from '../types/package-catalog.types';
import { catalogTopic } from './catalog-discovery';

export interface CompletionSuggestionContext {
  url: string;
  id?: string;
  category?: string;
  public: boolean;
  inPath: boolean;
  pathUrl?: string;
  pathId?: string;
  platform?: 'oss' | 'cloud';
}

interface SuggestionProgress {
  percent: number;
  nextId?: string;
}

const RELATED_TOPICS = new Set(['dashboards', 'data-sources', 'alerting', 'metrics', 'logs', 'k6', 'getting-started']);

function normalizedUrl(value: string): string {
  if (value.startsWith('bundled:')) {
    return normalizeGuideId(value);
  }
  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    url.pathname = normalizeGuideId(url.pathname).replace(/\/$/, '');
    return url.href;
  } catch {
    return value;
  }
}

function bundledId(value: string): string | undefined {
  return value.startsWith('bundled:') ? normalizeGuideId(value.slice('bundled:'.length)) : undefined;
}

function matchesKnownPlatform(match: unknown, platform: 'oss' | 'cloud', depth = 0): boolean {
  if (!match || typeof match !== 'object' || Array.isArray(match) || depth > 32) {
    return true;
  }
  const expression = match as Record<string, unknown>;
  if (
    (expression.targetPlatform === 'oss' || expression.targetPlatform === 'cloud') &&
    expression.targetPlatform !== platform
  ) {
    return false;
  }
  if (
    Array.isArray(expression.and) &&
    !expression.and.every((condition) => matchesKnownPlatform(condition, platform, depth + 1))
  ) {
    return false;
  }
  return (
    !Array.isArray(expression.or) ||
    expression.or.length === 0 ||
    expression.or.some((condition) => matchesKnownPlatform(condition, platform, depth + 1))
  );
}

export function selectCompletionSuggestions(
  items: CatalogPackage[],
  progress: ReadonlyMap<string, SuggestionProgress>,
  context: CompletionSuggestionContext
): CatalogPackage[] {
  if (!context.public) {
    return [];
  }
  const currentUrl = normalizedUrl(context.url);
  const pathUrl = context.pathUrl ? normalizedUrl(context.pathUrl) : undefined;
  const currentId = context.id ? normalizeGuideId(context.id) : bundledId(context.url);
  const isCurrent = (item: CatalogPackage) =>
    normalizedUrl(item.url) === currentUrl || (currentId !== undefined && item.id === currentId);
  const current = items.find((item) => item.source === 'grafana' && isCurrent(item));
  const topic = catalogTopic({
    id: '',
    title: '',
    category: context.category ?? (current ? catalogTopic(current) : undefined),
  });
  const eligible = items.filter(
    (item) =>
      item.source === 'grafana' &&
      !isCurrent(item) &&
      (!context.platform ||
        ((!item.curatedPath?.targetPlatform || item.curatedPath.targetPlatform === context.platform) &&
          matchesKnownPlatform(item.targeting?.match, context.platform))) &&
      !(item.format === 'path' && (item.id === context.pathId || (pathUrl && normalizedUrl(item.url) === pathUrl))) &&
      (progress.get(item.key)?.percent ?? 0) < 100
  );
  const ordered = [...eligible].sort((a, b) => a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
  const suggestions: CatalogPackage[] = [];
  const memberId = bundledId(context.url);
  if (!context.inPath && memberId && current?.format === 'guide' && bundledId(current.url) === memberId) {
    const containingPaths = ordered.filter(
      (item) => item.curatedPath && !item.curatedPath.url && item.memberIds?.includes(memberId)
    );
    for (const path of containingPaths) {
      const nextId = progress.get(path.key)?.nextId;
      const memberIds = [...new Set([nextId, ...(path.memberIds ?? [])])];
      const next = memberIds.flatMap((id) =>
        ordered.filter(
          (item) =>
            item.format === 'guide' && item.id === id && bundledId(item.url) === id && path.memberIds?.includes(id)
        )
      )[0];
      if (next) {
        suggestions.push(next);
        break;
      }
    }
  }
  if (RELATED_TOPICS.has(topic)) {
    suggestions.push(...ordered.filter((item) => catalogTopic(item) === topic));
  }
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  return suggestions
    .filter((item) => {
      const url = normalizedUrl(item.url);
      if (seenIds.has(item.id) || (url && seenUrls.has(url))) {
        return false;
      }
      seenIds.add(item.id);
      if (url) {
        seenUrls.add(url);
      }
      return true;
    })
    .slice(0, 2);
}
