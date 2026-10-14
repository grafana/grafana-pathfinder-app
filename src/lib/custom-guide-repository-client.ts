import { readProxyDiagnostics, reportProxyFailure, reportProxyResponse } from './proxy-diagnostics';
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
import { config, getBackendSrv } from '@grafana/runtime';

import { PLUGIN_BACKEND_URL } from '../constants';
import { isBackendApiAvailable } from '../utils/fetchBackendGuides';
import { classifyRequestFailure } from './fetch-error';
import { logger } from './logging';
import { recordCustomGuideCatalogueUnavailable } from './telemetry/facade';
import { PackageTypeSchema } from '../types/package.schema';
import type { Author, ManifestTrack, PackageType } from '../types/package.types';

/**
 * `type` is optional because the Go proxy forwards the stored string verbatim
 * with no validation and no omitempty — `requestCatalogue` drops anything that
 * isn't a PackageType rather than let the declaration overclaim the wire.
 */
export interface CustomGuideManifest {
  type?: PackageType;
  repository?: string;
  description?: string;
  milestones?: string[];
  tracks?: ManifestTrack[];
  category?: string;
  author?: Author;
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
 * soft-200 in that case, for every reason below). Reasons:
 * `identity-unavailable` (no acceptable caller token — absent, expired, forged,
 * or issued for another stack), `identity-unverifiable` (nothing this stack
 * supplies makes verification possible: no app URL to build a verifier from, or
 * no server-derived namespace to bind the token to), `signing-keys-unreachable`
 * (no signing-keys endpoint answered at all, which points at the configured
 * address rather than at the caller), `feature-toggle-disabled`,
 * `obo-unavailable` (no provisioned on-behalf-of token — check this first when
 * the surface is unexpectedly empty), or `upstream-<status>` for an upstream
 * error.
 *
 * The identity gate runs before the backend resolver, so that resolver's
 * `namespace-unavailable` and `app-url-unavailable` are unreachable on this
 * route — a stack missing either reports `identity-unverifiable` first. Its
 * `grafana-config-unavailable` is unreachable for an unrelated reason: the guard
 * is `cfg == nil`, and the plugin SDK never returns a nil Grafana config (a
 * missing context value and a nil pointer both yield an empty one), so that
 * branch is dead whatever the gate ordering.
 */
interface CustomGuideCapability {
  available: boolean;
  reason?: string;
}

type WireManifest = Omit<CustomGuideManifest, 'type'> & { type?: string };
type WireEntry = Omit<CustomGuideRepositoryEntry, 'manifest'> & { manifest?: WireManifest };

interface CustomGuideRepositoryResponse {
  capability: CustomGuideCapability;
  guides: WireEntry[];
  asOf?: string;
}

const CUSTOM_GUIDE_REPOSITORY_URL = `${PLUGIN_BACKEND_URL}/custom-guide-repository`;
const APP_PLATFORM_REPOSITORY = 'app-platform';

// Short TTL + in-flight de-duplication. Several callers fetch the catalogue on
// panel open (the Custom Guides surface, My Learning ingestion, and the
// panel-open probe), and the proxy deliberately keeps no cross-request cache of
// its own (custom_guide_repository.go). Without this, each caller drives a full
// paginated upstream drain plus its own on-behalf-of token exchange,
// concurrently. The proxy derives the namespace server-side, so keying on the
// client-side namespace gate is safe. A full reload always refetches.
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { result: CustomGuideCatalogue; at: number }>();
const inflight = new Map<string, Promise<CustomGuideCatalogue>>();

function reportCatalogueFetchFailure(err: unknown): void {
  reportProxyFailure(err);
  try {
    const diagnostic = readProxyDiagnostics((err as { data?: { diagnostics?: unknown } })?.data?.diagnostics);
    const reason = diagnostic?.upstreamStatus
      ? `upstream-${diagnostic.upstreamStatus}`
      : (diagnostic?.reason ?? classifyRequestFailure(err));
    // The log context bridges to Faro too (logging.ts sanitizes it, it does not
    // strip it), so it carries the same bounded token — never `err.message`.
    logger.warn('[custom-guides] catalogue fetch failed', { reason });
    recordCustomGuideCatalogueUnavailable(reason);
  } catch {
    // Observability must not turn a swallowed listing failure into a rejection.
  }
}

export interface CustomGuideCatalogue {
  entries: CustomGuideRepositoryEntry[];
  available: boolean;
  reason?: string;
}

interface CatalogueResult extends CustomGuideCatalogue {
  cacheable: boolean;
}

// Bounded token, same closed vocabulary as the reasons above (TELEMETRY.md).
const MALFORMED_REASON = 'malformed-response';

// `null` is absent, not malformed: the proxy is Go, and json.Marshal of a nil
// []guide emits `null`, so an empty catalogue legitimately sends exactly that.
function isMalformedGuides(guides: unknown): boolean {
  return guides !== undefined && guides !== null && !Array.isArray(guides);
}

function narrowPackageType(type: string | undefined): PackageType | undefined {
  const parsed = PackageTypeSchema.safeParse(type);
  return parsed.success ? parsed.data : undefined;
}

// Source identity comes from the private loader, never an authored manifest.
function shapeEntry(entry: WireEntry): CustomGuideRepositoryEntry {
  const { manifest, ...rest } = entry;
  if (!manifest) {
    return rest;
  }
  return {
    ...rest,
    manifest: { ...manifest, type: narrowPackageType(manifest.type), repository: APP_PLATFORM_REPOSITORY },
  };
}

async function requestCatalogue(): Promise<CatalogueResult> {
  const response = await getBackendSrv().get<CustomGuideRepositoryResponse>(
    CUSTOM_GUIDE_REPOSITORY_URL,
    undefined,
    undefined,
    { showErrorAlert: false, showSuccessAlert: false }
  );
  reportProxyResponse(response);
  if (!response?.capability?.available) {
    const reason = response?.capability?.reason ?? 'unknown';
    logger.warn('[custom-guides] catalogue unavailable', { reason });
    recordCustomGuideCatalogueUnavailable(reason);
    return { entries: [], available: false, reason, cacheable: true };
  }
  if (isMalformedGuides(response.guides)) {
    logger.warn('[custom-guides] catalogue malformed', { reason: MALFORMED_REASON });
    recordCustomGuideCatalogueUnavailable(MALFORMED_REASON);
    return { entries: [], available: false, reason: MALFORMED_REASON, cacheable: false };
  }
  const guides = Array.isArray(response.guides) ? response.guides : [];
  return { entries: guides.map(shapeEntry), available: true, cacheable: true };
}

export async function fetchCustomGuideCatalogue(
  namespace: string,
  options: { refresh?: boolean } = {}
): Promise<CustomGuideCatalogue> {
  if (!isBackendApiAvailable() || !namespace) {
    return { entries: [], available: false, reason: 'unsupported' };
  }

  const key = `${namespace}:${config?.bootData?.user?.orgId ?? ''}:${config?.bootData?.user?.id ?? ''}`;
  if (options.refresh) {
    cache.delete(key);
  }
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.result;
  }
  const existing = inflight.get(key);
  if (existing) {
    return existing;
  }
  const request = requestCatalogue()
    .then(({ cacheable, ...result }) => {
      if (cacheable) {
        cache.set(key, { result, at: Date.now() });
      }
      return result;
    })
    .catch((err: unknown): CustomGuideCatalogue => {
      reportCatalogueFetchFailure(err);
      return { entries: [], available: false, reason: 'request-failed' };
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, request);
  return request;
}

export async function fetchCustomGuideRepository(namespace: string): Promise<CustomGuideRepositoryEntry[]> {
  return (await fetchCustomGuideCatalogue(namespace)).entries;
}

/** Drop cached catalogue entries so the next fetch re-lists (e.g. after a publish, or in tests). */
export function invalidateCustomGuideRepositoryCache(): void {
  cache.clear();
}
