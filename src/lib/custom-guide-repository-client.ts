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
import { PackageTypeSchema } from '../types/package.schema';
import type { Author, PackageType } from '../types/package.types';

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
 * address rather than at the caller), `grafana-config-unavailable`,
 * `feature-toggle-disabled`, `app-url-unavailable`, `obo-unavailable` (no
 * provisioned on-behalf-of token — check this first when the surface is
 * unexpectedly empty), or `upstream-<status>` for an upstream error. The
 * identity gate runs before the backend resolver, so `namespace-unavailable` is
 * not reachable on this route: a stack with no namespace reports
 * `identity-unverifiable` first.
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
const cache = new Map<string, { entries: CustomGuideRepositoryEntry[]; at: number }>();
const inflight = new Map<string, Promise<CustomGuideRepositoryEntry[]>>();

// Bounded token, never the error text — it lands on a Faro event attribute,
// which must stay low-cardinality (docs/developer/TELEMETRY.md). `data.statusCode`
// is body-derived, so the integer bound is what keeps the vocabulary finite.
function classifyRequestFailure(err: unknown): string {
  const status =
    (err as { status?: number })?.status ??
    (err as { statusCode?: number })?.statusCode ??
    (err as { data?: { statusCode?: number } })?.data?.statusCode;
  const bounded = typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599;
  return bounded ? `http-${status}` : 'transport-error';
}

function reportCatalogueFetchFailure(err: unknown): void {
  try {
    const reason = classifyRequestFailure(err);
    // The log context bridges to Faro too (logging.ts sanitizes it, it does not
    // strip it), so it carries the same bounded token — never `err.message`.
    logger.warn('[custom-guides] catalogue fetch failed', { reason });
    recordCustomGuideCatalogueUnavailable(reason);
  } catch {
    // Observability must not turn a swallowed listing failure into a rejection.
  }
}

interface CatalogueResult {
  entries: CustomGuideRepositoryEntry[];
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

// Every entry from this proxy is an App Platform package, but the CR manifest
// leaves `repository` omitempty (and authoring tooling may stamp the CDN
// default). Force it here — the launch surfaces thread this manifest into
// packageInfo, and a missing/wrong value fails the `app-platform` gate in
// package-content.ts (fabricated public websiteUrl) and mislabels the durable
// completion source (completion-identity.ts guideSource). `type` is narrowed in
// the same pass: the proxy forwards it unvalidated, so anything that isn't a
// PackageType becomes undefined, which the `'path'`/`'journey'` comparisons
// downstream already treat as "not a path".
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
  if (!response?.capability?.available) {
    // Surface WHY the catalogue is empty — otherwise a degraded capability (e.g.
    // obo-unavailable) presents as "no guides" with nothing in the console, which
    // is exactly how the stackId-wipe incident stayed invisible. The log is for a
    // developer at a console; the Faro event is the countable, alertable signal.
    const reason = response?.capability?.reason ?? 'unknown';
    logger.warn('[custom-guides] catalogue unavailable', { reason });
    recordCustomGuideCatalogueUnavailable(reason);
    return { entries: [], cacheable: true };
  }
  if (isMalformedGuides(response.guides)) {
    // Schema drift between the Go proxy and this client would otherwise render
    // as "no guides authored", with the metric at zero and a silent console.
    logger.warn('[custom-guides] catalogue malformed', { reason: MALFORMED_REASON });
    recordCustomGuideCatalogueUnavailable(MALFORMED_REASON);
    return { entries: [], cacheable: false };
  }
  const guides = Array.isArray(response.guides) ? response.guides : [];
  return { entries: guides.map(shapeEntry), cacheable: true };
}

/**
 * Fetch the caller's custom guide catalogue. The proxy derives the namespace
 * from the trusted plugin context, so none is sent here; `namespace` is only a
 * client-side gate for "am I on a provisioned stack". Returns an empty array
 * when the backend API isn't rolled out, there's no namespace, the proxy
 * reports itself unavailable, or the request fails — a best-effort listing, not
 * a hard dependency (mirrors fetchBackendGuides). Successful results are cached
 * per namespace for CACHE_TTL_MS with in-flight de-duplication so concurrent
 * callers share a single upstream drain; failures and malformed responses are
 * not cached.
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
    .then(({ entries, cacheable }) => {
      // Drift may be fixed by the next deploy; caching it would keep the
      // surface empty for the whole TTL after the backend recovered.
      if (cacheable) {
        cache.set(namespace, { entries, at: Date.now() });
      }
      return entries;
    })
    // Best-effort: never surface a listing failure to callers, and don't cache
    // it so a transient error doesn't stick for the whole TTL. Still counted —
    // `showErrorAlert: false` makes this otherwise invisible from the browser.
    .catch((err: unknown) => {
      reportCatalogueFetchFailure(err);
      return [] as CustomGuideRepositoryEntry[];
    })
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
