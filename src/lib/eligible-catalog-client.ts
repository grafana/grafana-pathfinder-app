import { z } from 'zod';
import { ALLOWED_RECOMMENDER_DOMAINS, DEFAULT_RECOMMENDER_TIMEOUT } from '../constants';
import type { CatalogPackage } from '../types/package-catalog.types';
import { parseUrlSafely } from '../security';
import { isDevModeEnabledGlobal } from '../utils/dev-mode';
import { eligibleCatalog } from './package-catalog';
import { getRecommenderStackContext } from './recommender-context';

const CACHE_TTL_MS = 5 * 60 * 1000;
const responseSchema = z.object({ packages: z.array(z.unknown()) });

interface CatalogResult {
  items: CatalogPackage[];
  available: boolean;
}

interface CacheEntry {
  result?: CatalogResult;
  nextFetch: number;
  inFlight?: Promise<CatalogResult>;
}

const cache = new Map<string, CacheEntry>();

export function fetchEligibleCatalog(
  serviceUrl: string,
  scope: string,
  { refresh = false }: { refresh?: boolean } = {}
): Promise<CatalogResult> {
  const parsed = parseUrlSafely(serviceUrl);
  if (
    !parsed ||
    parsed.username ||
    parsed.password ||
    !['http:', 'https:'].includes(parsed.protocol) ||
    (!isDevModeEnabledGlobal() &&
      (parsed.protocol !== 'https:' || !ALLOWED_RECOMMENDER_DOMAINS.includes(parsed.hostname)))
  ) {
    return Promise.resolve({ items: [], available: false });
  }
  const endpoint = new URL(parsed.href);
  endpoint.pathname = `${endpoint.pathname.replace(/\/$/, '')}/api/v1/catalog`;
  endpoint.search = '';
  endpoint.hash = '';
  const context = getRecommenderStackContext();
  const key = JSON.stringify([endpoint.href, scope, context.source, context.platform]);
  let entry = cache.get(key);
  if (!entry) {
    entry = { nextFetch: 0 };
    cache.set(key, entry);
  }
  if (entry.inFlight) {
    return entry.inFlight;
  }
  if (!refresh && Date.now() < entry.nextFetch) {
    return Promise.resolve(entry.result ?? { items: [], available: false });
  }
  const current = entry;
  current.inFlight = requestCatalog(endpoint, context)
    .then((items) => {
      current.result = { items, available: true };
      current.nextFetch = Date.now() + CACHE_TTL_MS;
      return current.result;
    })
    .catch(() => {
      current.nextFetch = 0;
      return current.result ?? { items: [], available: false };
    })
    .finally(() => {
      current.inFlight = undefined;
    });
  return current.inFlight;
}

async function requestCatalog(endpoint: URL, context: ReturnType<typeof getRecommenderStackContext>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_RECOMMENDER_TIMEOUT);
  try {
    const response = await fetch(endpoint.href, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(context),
      signal: controller.signal,
      credentials: 'omit',
    });
    if (!response.ok) {
      throw new Error('Public catalog unavailable');
    }
    return eligibleCatalog(responseSchema.parse(await response.json()).packages);
  } finally {
    clearTimeout(timer);
  }
}

export function resetEligibleCatalogCacheForTests() {
  cache.clear();
}
