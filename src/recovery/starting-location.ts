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
 * @see docs/design/AUTORECOVERY_DESIGN.md § "The implied 0th step"
 */

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

export function resolveStartingLocation(url: string, packageManifest?: Record<string, unknown>): string | null {
  const fromManifest = packageManifest?.startingLocation;
  if (typeof fromManifest === 'string' && fromManifest.length > 0) {
    return fromManifest;
  }

  // The typed field wins when both are present: a promoted CUE field is the more
  // specific declaration, and `additionalFields` is where a value waits for that
  // promotion.
  const fromAdditional = readAdditionalStartingLocation(packageManifest);
  if (fromAdditional) {
    return fromAdditional;
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
