/**
 * Caching Snippet Resolver
 *
 * Wraps an underlying resolver with a short-lived in-memory cache
 * (TTL ~5 min) and in-flight request dedupe. Used by the parser splice
 * and the editor picker — both can race for the same snippet on first
 * open, and we don't want to hammer the CDN.
 *
 * The CDN is the single source of truth; there is no bundled fallback.
 * A network failure simply returns the failure resolution, which the
 * caller renders as an inert placeholder block.
 */

import type { SnippetCatalog } from '../types/json-snippet.types';

import { createOnlineSnippetResolver } from './online-snippet-resolver';
import type { SnippetCatalogProvider, SnippetResolution, SnippetResolver } from './types';

const DEFAULT_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  resolution: SnippetResolution;
  expiresAt: number;
}

export class CachingSnippetResolver implements SnippetResolver, SnippetCatalogProvider {
  private readonly inner: SnippetResolver & SnippetCatalogProvider;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<SnippetResolution>>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(inner: SnippetResolver & SnippetCatalogProvider, options: { ttlMs?: number; now?: () => number } = {}) {
    this.inner = inner;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? (() => Date.now());
  }

  async resolve(snippetId: string): Promise<SnippetResolution> {
    const cached = this.cache.get(snippetId);
    if (cached && cached.expiresAt > this.now()) {
      return cached.resolution;
    }

    // Dedupe concurrent resolutions of the same id — picker + card +
    // parser splice may all race for the same snippet on first open.
    const existing = this.inFlight.get(snippetId);
    if (existing) {
      return existing;
    }

    const promise = this.inner.resolve(snippetId).then((resolution) => {
      // Only cache successes — a transient network failure shouldn't
      // pin a guide to an error placeholder for the rest of the session.
      if (resolution.ok) {
        this.cache.set(snippetId, { resolution, expiresAt: this.now() + this.ttlMs });
      }
      this.inFlight.delete(snippetId);
      return resolution;
    });

    this.inFlight.set(snippetId, promise);
    return promise;
  }

  async list(): Promise<SnippetCatalog> {
    return this.inner.list();
  }

  /** Test-only: clear cache and in-flight tracking. */
  clearForTests(): void {
    this.cache.clear();
    this.inFlight.clear();
  }
}

let sharedResolver: CachingSnippetResolver | undefined;

/**
 * Singleton accessor for the standard resolver used by the parser and
 * the editor. Tests should construct their own instance via the
 * constructor and inject a mocked inner resolver.
 */
export function getSnippetResolver(): CachingSnippetResolver {
  if (!sharedResolver) {
    sharedResolver = new CachingSnippetResolver(createOnlineSnippetResolver());
  }
  return sharedResolver;
}

/** Test-only: reset the singleton between tests. */
export function __resetSnippetResolverForTests(): void {
  sharedResolver = undefined;
}
