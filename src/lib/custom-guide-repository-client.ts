/**
 * Client for the /custom-guide-repository backend proxy — a slim,
 * denormalized catalogue of the caller's private InteractiveGuide packages
 * (the App Platform analogue of the CDN's repository.json), computed live by
 * pkg/plugin/custom_guide_repository.go rather than pre-built.
 *
 * Consumed by the Custom Guides surface and My Learning ingestion to
 * enumerate path/journey packages without pulling every guide's full
 * content.json just to build a catalogue view.
 *
 * @coupling API: GET /custom-guide-repository served by pkg/plugin/custom_guide_repository.go
 */
import { getBackendSrv } from '@grafana/runtime';

import { PLUGIN_BACKEND_URL } from '../constants';
import { isBackendApiAvailable } from '../utils/fetchBackendGuides';
import { logger } from './logging';
import { recordCustomGuideCatalogueUnavailable } from './telemetry/facade';
import type { Author, DependencyList, PackageType } from '../types/package.types';

export interface CustomGuideManifest {
  type: PackageType;
  repository?: string;
  description?: string;
  milestones?: string[];
  category?: string;
  author?: Author;
  depends?: DependencyList;
}

export interface CustomGuideRepositoryEntry {
  id: string;
  title?: string;
  status?: string;
  manifest?: CustomGuideManifest;
}

/**
 * Availability signal the catalogue surfaces gate on. `available` is false with
 * a machine `reason` when the proxy can't serve (the response is still a
 * soft-200 in that case). Reasons: `identity-unavailable`,
 * `grafana-config-unavailable`, `feature-toggle-disabled`, `namespace-unavailable`,
 * `app-url-unavailable`, `obo-unavailable` (no provisioned on-behalf-of token —
 * check this first when the surface is unexpectedly empty), `backend-unavailable`,
 * or `upstream-<status>` for an upstream error.
 */
interface CustomGuideCapability {
  available: boolean;
  reason?: string;
}

interface CustomGuideRepositoryResponse {
  capability: CustomGuideCapability;
  guides: CustomGuideRepositoryEntry[];
  asOf?: string;
}

const CUSTOM_GUIDE_REPOSITORY_URL = `${PLUGIN_BACKEND_URL}/custom-guide-repository`;

// Short TTL + in-flight de-duplication. Several callers fetch the catalogue on
// panel open (the Custom Guides surface, My Learning ingestion, and the
// panel-open probe), and the proxy deliberately keeps no cross-request cache of
// its own (custom_guide_repository.go). Without this, each caller drives a full
// paginated upstream drain plus its own on-behalf-of token exchange,
// concurrently. The proxy derives the namespace server-side, so keying on the
// client-side namespace gate is safe. A full reload always refetches.
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { entries: CustomGuideRepositoryEntry[]; at: number }>();
const inflight = new Map<string, Promise<CustomGuideRepositoryEntry[]>>();

async function requestCatalogue(): Promise<CustomGuideRepositoryEntry[]> {
  const response = await getBackendSrv().get<CustomGuideRepositoryResponse>(
    CUSTOM_GUIDE_REPOSITORY_URL,
    undefined,
    undefined,
    { showErrorAlert: false, showSuccessAlert: false }
  );
  if (!response?.capability?.available) {
    // Surface WHY the catalogue is empty — otherwise a degraded capability (e.g.
    // obo-unavailable) presents as "no guides" with nothing in the console, which
    // is exactly how the stackId-wipe incident stayed invisible. The log is for a
    // developer at a console; the Faro event is the countable, alertable signal.
    const reason = response?.capability?.reason ?? 'unknown';
    logger.warn('[custom-guides] catalogue unavailable', { reason });
    recordCustomGuideCatalogueUnavailable(reason);
    return [];
  }
  return Array.isArray(response.guides) ? response.guides : [];
}

/**
 * Fetch the caller's custom guide catalogue. The proxy derives the namespace
 * from the trusted plugin context, so none is sent here; `namespace` is only a
 * client-side gate for "am I on a provisioned stack". Returns an empty array
 * when the backend API isn't rolled out, there's no namespace, the proxy
 * reports itself unavailable, or the request fails — a best-effort listing, not
 * a hard dependency (mirrors fetchBackendGuides). Successful results are cached
 * per namespace for CACHE_TTL_MS with in-flight de-duplication so concurrent
 * callers share a single upstream drain; failures are not cached.
 */
export async function fetchCustomGuideRepository(namespace: string): Promise<CustomGuideRepositoryEntry[]> {
  if (!isBackendApiAvailable() || !namespace) {
    return [];
  }

  const cached = cache.get(namespace);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.entries;
  }

  const existing = inflight.get(namespace);
  if (existing) {
    return existing;
  }

  const request = requestCatalogue()
    .then((entries) => {
      cache.set(namespace, { entries, at: Date.now() });
      return entries;
    })
    // Best-effort: never surface a listing failure, and don't cache it so a
    // transient error doesn't stick for the whole TTL.
    .catch(() => [] as CustomGuideRepositoryEntry[])
    .finally(() => {
      inflight.delete(namespace);
    });

  inflight.set(namespace, request);
  return request;
}

/** Drop cached catalogue entries so the next fetch re-lists (e.g. after a publish, or in tests). */
export function invalidateCustomGuideRepositoryCache(): void {
  cache.clear();
}
