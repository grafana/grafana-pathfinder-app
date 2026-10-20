import type { Recommendation, RecommendationRelevance } from '../types/context.types';
import { getPackageRenderType } from '../types/package.types';

export const GENERAL_RELEVANCE: RecommendationRelevance = {
  version: 1,
  tier: 0,
  taskSignals: 0,
  urlSpecificity: 0,
  environmentSignals: 0,
};

export function sanitizeRelevance(value: unknown): RecommendationRelevance | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const r = value as Record<string, unknown>;
  if (r.version !== 1) {
    return undefined;
  }
  for (const [key, max] of Object.entries({ tier: 3, taskSignals: 4, urlSpecificity: 4096, environmentSignals: 2 })) {
    const n = r[key];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > max) {
      return undefined;
    }
  }
  return {
    version: 1,
    tier: r.tier as number,
    taskSignals: r.taskSignals as number,
    urlSpecificity: r.urlSpecificity as number,
    environmentSignals: r.environmentSignals as number,
  };
}

export function compareRelevance(a: RecommendationRelevance, b: RecommendationRelevance): number {
  return (
    b.tier - a.tier ||
    b.taskSignals - a.taskSignals ||
    b.urlSpecificity - a.urlSpecificity ||
    b.environmentSignals - a.environmentSignals
  );
}

export function recommendationIdentity(rec: Recommendation): string {
  return typeof rec.manifest?.id === 'string' ? `package:${rec.repository ?? ''}:${rec.manifest.id}` : `url:${rec.url}`;
}

function formatPriority(rec: Recommendation): number {
  const type = rec.type === 'package' ? getPackageRenderType(rec.manifest) : rec.type;
  return type === 'interactive' ? 0 : type === 'learning-journey' ? 1 : 2;
}

function comparePriority(a: Recommendation, b: Recommendation): number {
  const placement = (rec: Recommendation) =>
    rec.placement === 'suggestion' ? 2 : rec.placement === 'experiment' ? 1 : 0;
  const ar = a.relevance ?? GENERAL_RELEVANCE;
  const br = b.relevance ?? GENERAL_RELEVANCE;
  return (
    placement(b) - placement(a) ||
    br.tier - ar.tier ||
    Number(a.completionPercentage === 100) - Number(b.completionPercentage === 100) ||
    compareRelevance(ar, br) ||
    (b.matchAccuracy ?? 0) - (a.matchAccuracy ?? 0)
  );
}

function startLocationAffinity(rec: Recommendation, currentPath: string): number {
  const start = rec.manifest?.startingLocation;
  if (typeof start !== 'string' || !start.startsWith('/') || start.startsWith('//') || !currentPath) {
    return 0;
  }
  try {
    return new URL(start, 'https://grafana.local').pathname.replace(/\/+$/, '') === currentPath.replace(/\/+$/, '')
      ? 1
      : -1;
  } catch {
    return 0;
  }
}

function packageId(rec: Recommendation): string | undefined {
  return typeof rec.manifest?.id === 'string'
    ? rec.manifest.id
    : rec.url?.startsWith('bundled:')
      ? rec.url.slice('bundled:'.length)
      : undefined;
}

export function rankRecommendations(recommendations: readonly Recommendation[], currentPath = ''): Recommendation[] {
  const ordered = [...recommendations].sort((a, b) => {
    const order =
      comparePriority(a, b) ||
      formatPriority(a) - formatPriority(b) ||
      startLocationAffinity(b, currentPath) - startLocationAffinity(a, currentPath) ||
      Number(Boolean(b.editorialFeatured)) - Number(Boolean(a.editorialFeatured));
    const ai = recommendationIdentity(a);
    const bi = recommendationIdentity(b);
    return order || (ai < bi ? -1 : ai > bi ? 1 : 0);
  });
  const prerequisites = ordered.map((rec, index) => {
    const ids = [rec.manifest?.depends, rec.manifest?.recommends].flatMap((field) =>
      Array.isArray(field) ? field.filter((id): id is string => typeof id === 'string') : []
    );
    return new Set(
      ids.flatMap((id) => {
        const candidates = ordered.flatMap((candidate, i) =>
          i !== index && packageId(candidate) === id && comparePriority(rec, candidate) === 0 ? [i] : []
        );
        const sameRepository = candidates.find((i) => ordered[i]?.repository === rec.repository);
        const prerequisite = sameRepository ?? (candidates.length === 1 ? candidates[0] : undefined);
        return prerequisite === undefined ? [] : [prerequisite];
      })
    );
  });
  const pending = ordered.map((_, index) => index);
  const result: Recommendation[] = [];
  while (pending.length) {
    // Only reorder peers; a weak prerequisite must never displace stronger context.
    const first = pending[0]!;
    const ready = pending.findIndex(
      (index) => comparePriority(ordered[first]!, ordered[index]!) === 0 && !prerequisites[index]!.size
    );
    const [index] = pending.splice(ready < 0 ? 0 : ready, 1);
    result.push(ordered[index!]!);
    prerequisites.forEach((dependencies) => dependencies.delete(index!));
  }
  return result;
}

export function mergeRankedRecommendations(
  recommendations: readonly Recommendation[],
  featured: readonly Recommendation[],
  currentPath = ''
): Recommendation[] {
  const merged = new Map<string, Recommendation>();
  for (const rec of [...recommendations, ...featured]) {
    const key = recommendationIdentity(rec);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, rec);
      continue;
    }
    const relevance =
      compareRelevance(rec.relevance ?? GENERAL_RELEVANCE, existing.relevance ?? GENERAL_RELEVANCE) < 0
        ? rec.relevance
        : existing.relevance;
    merged.set(key, {
      ...rec,
      ...existing,
      relevance,
      placement:
        rec.placement === 'suggestion' || existing.placement === 'suggestion'
          ? 'suggestion'
          : (rec.placement ?? existing.placement),
      editorialFeatured: rec.editorialFeatured || existing.editorialFeatured,
    });
  }
  return rankRecommendations([...merged.values()], currentPath);
}

// This evaluates only the existing offline vocabulary and fails closed on richer rules.
export function localRelevance(
  match: unknown,
  path: string,
  platform: string,
  depth = 0
): RecommendationRelevance | undefined {
  if (!match || typeof match !== 'object' || Array.isArray(match) || depth > 32) {
    return undefined;
  }
  if (depth === 0 && !supportsLocalEvidence(match)) {
    return undefined;
  }
  const node = match as Record<string, unknown>;
  if (Object.keys(node).some((key) => !['and', 'or', 'urlPrefix', 'urlPrefixIn', 'targetPlatform'].includes(key))) {
    return undefined;
  }
  const children = node.and ?? node.or;
  if (Array.isArray(children) && children.length > 0) {
    const results = children.map((child) => localRelevance(child, path, platform, depth + 1));
    if (node.and && results.some((r) => !r)) {
      return undefined;
    }
    return results.filter((r): r is RecommendationRelevance => Boolean(r)).sort(compareRelevance)[0];
  }
  const prefixes = typeof node.urlPrefix === 'string' ? [node.urlPrefix] : node.urlPrefixIn;
  if (Array.isArray(prefixes)) {
    const matching = prefixes.filter(
      (prefix): prefix is string => typeof prefix === 'string' && path.startsWith(prefix)
    );
    if (!matching.length) {
      return undefined;
    }
    const specificity = Math.max(
      0,
      ...matching.map((prefix) => (prefix === '/' ? 0 : Math.min(4096, [...prefix].length)))
    );
    return { ...GENERAL_RELEVANCE, tier: specificity > 0 ? 2 : 0, urlSpecificity: specificity };
  }
  if (node.targetPlatform === platform || node.targetPlatform === 'any') {
    return { ...GENERAL_RELEVANCE };
  }
  return undefined;
}

export function legacyRelevance(rec: Recommendation, path: string): RecommendationRelevance {
  if (rec.missingCriteria?.length) {
    return { ...GENERAL_RELEVANCE };
  }
  const prefixes = (rec.matchedCriteria ?? []).flatMap((criterion) => {
    if (criterion.startsWith('urlPrefix:')) {
      return [criterion.slice('urlPrefix:'.length)];
    }
    return criterion.startsWith('urlPrefixIn:') ? criterion.slice('urlPrefixIn:'.length).split(',') : [];
  });
  return localRelevance({ urlPrefixIn: prefixes }, path, '') ?? { ...GENERAL_RELEVANCE };
}

function supportsLocalEvidence(match: unknown, depth = 0): boolean {
  if (!match || typeof match !== 'object' || Array.isArray(match) || depth > 32) {
    return false;
  }
  const node = match as Record<string, unknown>;
  return (
    Object.keys(node).every((key) => ['and', 'or', 'urlPrefix', 'urlPrefixIn', 'targetPlatform'].includes(key)) &&
    ['and', 'or'].every(
      (key) =>
        node[key] === undefined ||
        (Array.isArray(node[key]) && node[key].every((child) => supportsLocalEvidence(child, depth + 1)))
    )
  );
}
