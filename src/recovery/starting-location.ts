/**
 * Resolves the expected starting location for a guide.
 *
 * Resolution order:
 *   1. `manifest.startingLocation` — for migrated package guides
 *   2. `manifest.additionalFields.startingLocation` — the App Platform location. The
 *      `InteractiveGuide` CRD's `#Manifest` does not declare `startingLocation`, so a
 *      value written at the top level is pruned on write; both the block editor and
 *      `scripts/upsert-learning-path.sh` put it under `additionalFields` instead. Two
 *      locations to handle until the CUE field is promoted (see `docs/design/CONCERNS.md`).
 *   3. `bundled-interactives/index.json` `url[0]` — fallback for unmigrated bundled guides
 *      (URLs of the form `bundled:<id>`)
 *   4. `null` — for remote guides without a manifest; caller skips prompting and
 *      relies on the existing location `Fix this` as a safety net
 *
 * Whatever wins, it leaves here only if `validateInternalNavigationPath` accepts
 * it. A manifest is authored data that reaches `locationService.push` through
 * `confirmAlignment`, so it is held to the same same-origin / denied-route bar as
 * an authored `navigate` action — one validator, not a parallel check. A rejected
 * value resolves to `null` rather than to the validator's `/` fallback: prompting
 * a reader to navigate to the root is a worse answer than not prompting at all.
 *
 * This is the single gate. `pendingAlignment` is written from this return value
 * and from nowhere else, so validating here covers what gets stored, what the
 * prompt shows, what telemetry reports, and what is eventually pushed.
 *
 * More than one manifest may describe the same launch, and they are not equally
 * complete: a catalogue-proxy entry is a slim projection that drops keys its Go
 * struct does not declare, while a content loader's manifest is whole. Callers
 * pass them most-authoritative-first and the first declared value wins, so a slim
 * manifest no longer shadows a complete one.
 *
 * @see docs/design/AUTORECOVERY_DESIGN.md § "The implied 0th step"
 */

import { validateInternalNavigationPath } from '../security/url-validator';

// Synchronous import: this JSON is bundled at build time.
const bundledIndex = require('../bundled-interactives/index.json') as BundledIndexShape;

interface BundledInteractiveEntry {
  id: string;
  url?: string | string[];
}

interface BundledIndexShape {
  interactives?: BundledInteractiveEntry[];
}

const BUNDLED_PREFIX = 'bundled:';

export interface ResolveStartingLocationOptions {
  /**
   * Whether the reader holds admin privileges. Omitted means "not an admin",
   * so a caller that forgets it gets the stricter answer.
   */
  isAdmin?: boolean;
}

/**
 * A launch describes itself with either one manifest or several. The parameter
 * accepts both shapes so the common single-manifest call stays as it reads, and
 * only a caller that genuinely holds competing manifests pays the array syntax.
 */
export type ManifestCandidates = Record<string, unknown> | Array<Record<string, unknown> | undefined>;

export function resolveStartingLocation(
  url: string,
  packageManifests?: ManifestCandidates,
  options?: ResolveStartingLocationOptions
): string | null {
  const candidates = Array.isArray(packageManifests) ? packageManifests : [packageManifests];
  const candidate = resolveCandidate(url, candidates);
  if (candidate === null) {
    return null;
  }
  return validateInternalNavigationPath(candidate, options?.isAdmin);
}

function resolveCandidate(url: string, packageManifests: Array<Record<string, unknown> | undefined>): string | null {
  // Manifest authority dominates: a manifest that declares the value at all
  // settles it, and only then do we fall through to the next one. Within a
  // single manifest the typed field still wins over `additionalFields` — a
  // promoted CUE field is the more specific declaration, and `additionalFields`
  // is where a value waits for that promotion.
  for (const packageManifest of packageManifests) {
    const fromManifest = packageManifest?.startingLocation;
    if (typeof fromManifest === 'string' && fromManifest.length > 0) {
      return fromManifest;
    }

    const fromAdditional = readAdditionalStartingLocation(packageManifest);
    if (fromAdditional) {
      return fromAdditional;
    }
  }

  if (url.startsWith(BUNDLED_PREFIX)) {
    return resolveFromBundledIndex(extractBundledId(url));
  }

  return null;
}

function readAdditionalStartingLocation(packageManifest?: Record<string, unknown>): string | null {
  const additional = packageManifest?.additionalFields;
  if (!additional || typeof additional !== 'object' || Array.isArray(additional)) {
    return null;
  }
  const value = (additional as Record<string, unknown>).startingLocation;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Pulls the bare guide ID out of a `bundled:` URL. The system accepts two
 * formats:
 *   - `bundled:<id>` — legacy bare ID (e.g. `bundled:welcome-to-grafana`)
 *   - `bundled:<id>/content.json` — package-format path
 *
 * The index.json index keys on the bare ID, so we strip the suffix before
 * looking up. Without this, `bundled:welcome-to-grafana/content.json` would
 * miss its index entry and the bundled fallback would silently return null.
 */
function extractBundledId(url: string): string {
  const path = url.slice(BUNDLED_PREFIX.length);
  // The bare ID is everything before the first '/'. This collapses both the
  // `<id>` and `<id>/content.json` (and any future `<id>/something`) formats.
  const slash = path.indexOf('/');
  return slash === -1 ? path : path.slice(0, slash);
}

function resolveFromBundledIndex(id: string): string | null {
  try {
    const entries = bundledIndex.interactives;
    if (!Array.isArray(entries)) {
      return null;
    }
    const entry = entries.find((e) => e?.id === id);
    if (!entry) {
      return null;
    }
    if (Array.isArray(entry.url)) {
      const first = entry.url[0];
      return typeof first === 'string' && first.length > 0 ? first : null;
    }
    if (typeof entry.url === 'string' && entry.url.length > 0) {
      return entry.url;
    }
    return null;
  } catch {
    return null;
  }
}
