/**
 * Resolves the expected starting location for a guide.
 *
 * Resolution order:
 *   1. `manifest.startingLocation` — for migrated package guides
 *   2. `bundled-interactives/index.json` `url[0]` — fallback for unmigrated bundled guides
 *      (URLs of the form `bundled:<id>`)
 *   3. `null` — for remote guides without a manifest; caller skips prompting and
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

  if (url.startsWith(BUNDLED_PREFIX)) {
    return resolveFromBundledIndex(url.slice(BUNDLED_PREFIX.length));
  }

  return null;
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
