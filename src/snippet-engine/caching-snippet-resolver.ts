/**
 * Wraps a resolver with a short-lived cache (~5 min TTL) and in-flight
 * dedupe — the parser splice and editor picker can race for the same snippet
 * on first open. Failures aren't cached; they surface as the caller's
 * inert placeholder.
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

    const existing = this.inFlight.get(snippetId);
    if (existing) {
      return existing;
    }

    const promise = this.inner
      .resolve(snippetId)
      .then((resolution) => {
        // Only cache successes — a transient failure shouldn't pin a guide
        // to an error for the session.
        if (resolution.ok) {
          this.cache.set(snippetId, { resolution, expiresAt: this.now() + this.ttlMs });
        }
        return resolution;
      })
      .finally(() => {
        this.inFlight.delete(snippetId);
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

/** Shared resolver used by the parser and editor. */
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
