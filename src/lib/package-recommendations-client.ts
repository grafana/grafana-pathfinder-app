import { getBackendSrv } from '@grafana/runtime';

import { PLUGIN_BACKEND_URL } from '../constants';

/**
 * Subset of the recommender's MatchExpr that ContextService.matchesUrlPrefix
 * and ContextService.matchesPlatform already understand. Anything else is
 * deliberately omitted — this is the "low weight" matcher the bundled flow
 * uses, applied to the online package index.
 */
export interface PackageMatchExpr {
  urlPrefix?: string;
  urlPrefixIn?: string[];
  targetPlatform?: 'oss' | 'cloud' | string;
  and?: PackageMatchExpr[];
  or?: PackageMatchExpr[];
}

export interface PackageTargeting {
  match: PackageMatchExpr;
}

export interface OnlinePackageEntry {
  id: string;
  path: string;
  title?: string;
  description?: string;
  type?: string;
  targeting?: PackageTargeting;
  /**
   * Inlined contents of the package's manifest.json, when the backend
   * successfully fetched it. Carries fields like `milestones`, `recommends`,
   * `suggests`, `description`, `startingLocation` — used by the rendering
   * pipeline to surface milestone counts, deferred nav links, and the
   * correct "Start" CTA wiring. Absent when the per-package manifest fetch
   * failed; the entry is still discoverable but renders without these.
   */
  manifest?: Record<string, unknown>;
}

export interface PackageRecommendationsResponse {
  baseUrl: string;
  packages: OnlinePackageEntry[];
}

const PACKAGE_RECOMMENDATIONS_URL = `${PLUGIN_BACKEND_URL}/package-recommendations`;

// Session-lifetime state. Reset only via `online` event or
// `__resetPackageRecommendationsClientForTests`.
let unavailable = false;
let cache: PackageRecommendationsResponse | null = null;
let inFlight: Promise<PackageRecommendationsResponse | null> | null = null;
let onlineListenerAttached = false;

function attachOnlineListenerOnce(): void {
  if (onlineListenerAttached || typeof window === 'undefined') {
    return;
  }
  // A failed fetch sets `unavailable` for the rest of the session; coming
  // back online lets the next recommendations cycle try again — but we
  // never proactively retry.
  window.addEventListener('online', () => {
    unavailable = false;
  });
  onlineListenerAttached = true;
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

async function performFetch(): Promise<PackageRecommendationsResponse | null> {
  try {
    const response = await getBackendSrv().get<PackageRecommendationsResponse>(
      PACKAGE_RECOMMENDATIONS_URL,
      undefined,
      undefined,
      {
        showErrorAlert: false,
        showSuccessAlert: false,
      }
    );
    if (!response || !Array.isArray(response.packages)) {
      unavailable = true;
      return null;
    }
    cache = response;
    return response;
  } catch {
    // Any failure (network, 4xx, 5xx, abort) marks the feature unavailable
    // for the session. The frontend won't retry until a window 'online'
    // event resets the flag.
    unavailable = true;
    return null;
  }
}

/**
 * Fetch the online package recommendations index, using process-cached results
 * after the first call. Returns an empty array when:
 *  - the browser is offline (navigator.onLine === false)
 *  - a previous fetch failed during this session (sticky)
 *  - the backend returned a malformed response
 *
 * Never throws. Concurrent callers share a single in-flight promise so the
 * backend is hit at most once per cache window.
 */
export async function fetchOnlinePackageRecommendations(): Promise<{
  baseUrl: string;
  packages: OnlinePackageEntry[];
}> {
  attachOnlineListenerOnce();

  if (cache) {
    return cache;
  }
  if (unavailable || isOffline()) {
    return { baseUrl: '', packages: [] };
  }

  if (!inFlight) {
    inFlight = performFetch().finally(() => {
      inFlight = null;
    });
  }
  const result = await inFlight;
  return result ?? { baseUrl: '', packages: [] };
}

/**
 * Test-only reset. Not exported via index.ts.
 */
export function __resetPackageRecommendationsClientForTests(): void {
  unavailable = false;
  cache = null;
  inFlight = null;
  onlineListenerAttached = false;
}
