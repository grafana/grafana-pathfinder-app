import { normalizeGuideId } from '../completion-records/completion-identity';
import type { CatalogPackage } from '../types/package-catalog.types';
import type { DependencyList } from '../types/package.types';

export interface CompletionSuggestionContext {
  url: string;
  id?: string;
  category?: string;
  public: boolean;
  inPath: boolean;
  pathUrl?: string;
  pathId?: string;
  platform?: 'oss' | 'cloud';
  suggests?: DependencyList;
  source?: 'grafana' | 'organization';
}

interface SuggestionProgress {
  percent: number;
  nextId?: string;
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
): 'suggested' | 'inferred' {
  if (item.source === contextSource(context)) {
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
  for (const clause of context.suggests ?? []) {
    const alternatives = Array.isArray(clause) ? clause : [clause];
    if (
      alternatives.some((id) =>
        items.some((item) => item.source === source && item.id === id && (progress.get(item.key)?.percent ?? 0) >= 100)
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
  if (suggestions.length > 0) {
    return suggestions.slice(0, 2);
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
      const memberIds = path.memberIds?.slice(path.memberIds.indexOf(memberId) + 1) ?? [];
      const next = memberIds.flatMap((id) =>
        ordered.filter(
          (item) =>
            item.format === 'guide' && item.id === id && bundledId(item.url) === id && path.memberIds?.includes(id)
        )
      )[0];
      if (next) {
        return [next];
      }
    }
  }
  return [];
}
