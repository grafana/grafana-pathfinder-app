/**
 * Shared parser for Grafana's `grafana.navigation.extensionSidebarDocked`
 * localStorage key. Older Grafana versions wrote the docked plugin id as a
 * bare string; newer versions write `{ pluginId, componentTitle, ... }`.
 *
 * The same parse was previously inlined three times in `module.tsx` (restore
 * + suggest-reject paths) and `experiment-utils.ts`
 * (`isExtensionSidebarOwnedByOther`) with subtly different fallback logic.
 * Consolidating fixes one of the patterns flagged in
 * `.cursor/local/USER_STORAGE_ANALYSIS.md` as B4 (convergent re-bugging) and
 * eliminates the "which variant does each caller use?" question for future
 * sidebar-coordination work.
 *
 * The key itself is externally owned by Grafana — it lives outside
 * `StorageKeys` and stays the responsibility of the platform. This module
 * only provides shape-aware reading.
 */

export const EXTENSION_SIDEBAR_DOCKED_KEY = 'grafana.navigation.extensionSidebarDocked';

/**
 * Structured view of the docked-sidebar entry.
 *
 *   - `null`: the key is absent (or storage is unavailable). Nothing is
 *     docked from the Grafana-side perspective.
 *   - `{ pluginId, componentTitle }`: the docked surface is identified.
 *     Either or both fields may be `undefined` depending on Grafana version
 *     and which component is docked.
 */
export interface ExtensionSidebarDocked {
  pluginId?: string;
  componentTitle?: string;
}

/**
 * Read and parse the docked-sidebar entry from localStorage.
 *
 * Returns `null` when the key is absent or storage throws. Returns a
 * structured object when the value parses as JSON. Falls back to treating
 * the raw string as a `pluginId` to preserve the legacy contract from older
 * Grafana versions.
 */
export function parseExtensionSidebarDocked(): ExtensionSidebarDocked | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(EXTENSION_SIDEBAR_DOCKED_KEY);
  } catch {
    return null;
  }
  if (raw === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { pluginId?: unknown; componentTitle?: unknown };
    return {
      pluginId: typeof parsed.pluginId === 'string' ? parsed.pluginId : undefined,
      componentTitle: typeof parsed.componentTitle === 'string' ? parsed.componentTitle : undefined,
    };
  } catch {
    // Legacy plain-string format from older Grafana versions.
    return { pluginId: raw };
  }
}

/**
 * True when the docked sidebar belongs to a plugin other than `myPluginId`.
 * Returns false when nothing is docked or the docked surface belongs to us.
 */
export function isExtensionSidebarOwnedByOther(myPluginId: string): boolean {
  const docked = parseExtensionSidebarDocked();
  if (!docked) {
    return false;
  }
  const { pluginId } = docked;
  return typeof pluginId === 'string' && pluginId.length > 0 && pluginId !== myPluginId;
}

/**
 * True when *something* is docked (Pathfinder or otherwise). Convenience
 * for the "is the sidebar in use at all?" check.
 */
export function isExtensionSidebarInUse(): boolean {
  try {
    return localStorage.getItem(EXTENSION_SIDEBAR_DOCKED_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Match the docked surface against a Pathfinder fingerprint. Mirrors the
 * historical `module.tsx` restore-path check: pluginId equality OR a
 * componentTitle match for older Grafana versions where pluginId was not
 * yet recorded.
 */
export function isExtensionSidebarOwnedByPathfinder(
  myPluginId: string,
  componentTitleMatch: string
): boolean {
  const docked = parseExtensionSidebarDocked();
  if (!docked) {
    return false;
  }
  return docked.pluginId === myPluginId || docked.componentTitle === componentTitleMatch;
}

/**
 * Clear the docked-sidebar key. Safe to call when storage is unavailable.
 */
export function clearExtensionSidebarDocked(): void {
  try {
    localStorage.removeItem(EXTENSION_SIDEBAR_DOCKED_KEY);
  } catch {
    // Storage unavailable — nothing to clear from our side.
  }
}
