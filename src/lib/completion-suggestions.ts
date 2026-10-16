import { normalizeGuideId } from '../completion-records/completion-identity';
import type { CatalogPackage } from '../types/package-catalog.types';
import type { DependencyList } from '../types/package.types';
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
  recommends?: DependencyList;
  suggests?: DependencyList;
  source?: 'grafana' | 'organization';
}

interface SuggestionProgress {
  percent: number;
  nextId?: string;
}

const RELATED_TOPICS = new Set(['dashboards', 'data-sources', 'alerting', 'metrics', 'logs', 'k6', 'getting-started']);

const DISCOVERY_STOP_WORDS = new Set([
  'grafana',
  'cloud',
  'guide',
  'learning',
  'path',
  'getting',
  'started',
  'with',
  'your',
  'first',
  'and',
  'the',
  'for',
  'how',
  'use',
  'using',
  'to',
  'in',
  'of',
  'a',
  'an',
  'this',
  'that',
]);

function discoveryWords(item: CatalogPackage | undefined): Set<string> {
  return new Set(
    `${item?.title ?? ''} ${item?.id ?? ''}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2 && !DISCOVERY_STOP_WORDS.has(word))
  );
}

function rankCatalogFallback(
  items: CatalogPackage[],
  current: CatalogPackage | undefined,
  topic: string
): CatalogPackage[] {
  const words = discoveryWords(current);
  const relevance = (item: CatalogPackage) => [...discoveryWords(item)].filter((word) => words.has(word)).length;
  const formatRank = (item: CatalogPackage) =>
    topic === 'getting-started' ? Number(item.format === 'path') : Number(item.format === 'guide');
  return [...items].sort(
    (a, b) =>
      formatRank(b) - formatRank(a) ||
      relevance(b) - relevance(a) ||
      (a.estimatedMinutes ?? Infinity) - (b.estimatedMinutes ?? Infinity) ||
      a.key.localeCompare(b.key)
  );
}

function contextSource(context: CompletionSuggestionContext): CatalogPackage['source'] | undefined {
  return context.public
    ? context.source === 'organization'
      ? undefined
      : 'grafana'
    : context.source === 'organization'
      ? 'organization'
      : undefined;
}

export function completionSuggestionReason(
  item: CatalogPackage,
  context: CompletionSuggestionContext
): 'recommended' | 'suggested' | 'inferred' {
  if (item.source === contextSource(context)) {
    if (context.recommends?.some((clause) => (Array.isArray(clause) ? clause.includes(item.id) : clause === item.id))) {
      return 'recommended';
    }
    if (context.suggests?.some((clause) => (Array.isArray(clause) ? clause.includes(item.id) : clause === item.id))) {
      return 'suggested';
    }
  }
  return 'inferred';
}

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
  const source = contextSource(context);
  if (!source) {
    return [];
  }
  const currentUrl = normalizedUrl(context.url);
  const pathUrl = context.pathUrl ? normalizedUrl(context.pathUrl) : undefined;
  const currentId = context.id ? normalizeGuideId(context.id) : bundledId(context.url);
  const isCurrent = (item: CatalogPackage) =>
    normalizedUrl(item.url) === currentUrl || (currentId !== undefined && item.id === currentId);
  const current = items.find((item) => item.source === source && isCurrent(item));
  const topic = catalogTopic({
    id: '',
    title: '',
    category: context.category ?? (current ? catalogTopic(current) : undefined),
  });
  const eligible = items.filter(
    (item) =>
      item.source === source &&
      !isCurrent(item) &&
      (!context.platform ||
        ((!item.curatedPath?.targetPlatform || item.curatedPath.targetPlatform === context.platform) &&
          matchesKnownPlatform(item.targeting?.match, context.platform))) &&
      !(item.format === 'path' && (item.id === context.pathId || (pathUrl && normalizedUrl(item.url) === pathUrl))) &&
      (progress.get(item.key)?.percent ?? 0) < 100
  );
  const ordered = [...eligible].sort((a, b) => a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
  const suggestions: CatalogPackage[] = [];
  for (const relationships of [context.recommends, context.suggests]) {
    for (const clause of relationships ?? []) {
      const alternatives = Array.isArray(clause) ? clause : [clause];
      if (
        alternatives.some((id) =>
          items.some(
            (item) => item.source === source && item.id === id && (progress.get(item.key)?.percent ?? 0) >= 100
          )
        )
      ) {
        continue;
      }
      const next = alternatives
        .flatMap((id) => ordered.filter((item) => item.id === id))
        .find(
          (item) =>
            !suggestions.some(
              (suggestion) => suggestion.id === item.id || normalizedUrl(suggestion.url) === normalizedUrl(item.url)
            )
        );
      if (next) {
        suggestions.push(next);
      }
    }
  }
  if (suggestions.length > 0) {
    return suggestions.slice(0, 2);
  }
  if (context.public && topic === 'getting-started') {
    const introductoryPath = rankCatalogFallback(
      ordered.filter((item) => item.format === 'path' && catalogTopic(item) === topic),
      current,
      topic
    )[0];
    if (introductoryPath) {
      return [introductoryPath];
    }
  }
  const memberId = bundledId(context.url);
  if (
    context.public &&
    !context.inPath &&
    memberId &&
    current?.format === 'guide' &&
    bundledId(current.url) === memberId
  ) {
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
  if (context.public && RELATED_TOPICS.has(topic)) {
    suggestions.push(
      ...rankCatalogFallback(
        ordered.filter((item) => catalogTopic(item) === topic),
        current,
        topic
      )
    );
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
    .slice(0, 1);
}
