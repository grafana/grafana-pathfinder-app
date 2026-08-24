/**
 * This user's opt-in to developer surfaces.
 *
 * Replaces the `devModeUserIds` array that used to sit in plugin `jsonData`: a
 * per-user allow-list kept in an org-wide, provisioning-owned blob. Enabling dev
 * mode meant an admin-scoped write of the whole plugin-settings document, which
 * is how toggling it managed to unpin the plugin from the nav (`aa1c2efd`).
 *
 * The tenant-level `devMode` gate still lives in tenant settings; both must be
 * true for dev surfaces to appear, so an admin retains the instance-level veto.
 *
 * WHY localStorage, AND WHY THIS IS A LEAF MODULE
 *
 * Two constraints rule out the hybrid user-storage layer here:
 *
 *   - `isDevModeEnabledGlobal()` and the config bootstrap are synchronous, and
 *     `module.tsx` is on the critical path. Importing `lib/user-storage` — even
 *     dynamically — pulls this module into the analytics/telemetry/user-storage
 *     cycle that src/validation/architecture.test.ts ratchets, and statically it
 *     would drag zod into `module.js` and roughly double it.
 *   - This is a dev/debug toggle, and the repo already stores those locally:
 *     see `StorageKeys.FLAG_OVERRIDES`, the feature-flag override store.
 *
 * The trade-off is deliberate: the opt-in is per-browser rather than following
 * the user across devices. Re-enabling is one click, and the alternative was an
 * org-wide write visible to every other user on the stack.
 */

import { StorageKeys } from './storage-keys';

const KEY = StorageKeys.DEV_MODE_OPT_IN;

/**
 * Reads this user's opt-in. Returns false on anything unexpected — a missing
 * key, unparseable JSON, or a browser that denies storage access — because the
 * safe default for a dev surface is "hidden".
 */
export function readDevModeOptIn(): boolean {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'false') === true;
  } catch {
    return false;
  }
}

/**
 * Records this user's opt-in. Synchronous, so the very next `readDevModeOptIn`
 * observes it; async in signature only, to keep the calling toggle uniform with
 * the rest of the settings writes.
 */
export async function writeDevModeOptIn(enabled: boolean): Promise<void> {
  try {
    localStorage.setItem(KEY, JSON.stringify(enabled));
  } catch (error) {
    // Quota, or a browser that denies storage. Nothing else records this, so the
    // toggle genuinely failed and the caller should surface it.
    throw error instanceof Error ? error : new Error('Failed to persist dev-mode opt-in');
  }
}
