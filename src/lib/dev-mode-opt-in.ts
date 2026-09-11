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
 * Reads this user's opt-in, tri-state: `undefined` means this browser has never
 * recorded a choice, which is what separates a fresh browser from a deliberate
 * opt-out. The legacy `devModeUserIds` migration reads only the former; without
 * the distinction it would re-derive an opt-in from the allow-list on every
 * publish and a later opt-out could never stick.
 *
 * Anything unexpected — unparseable JSON, or a browser that denies storage — is
 * read as `false` rather than `undefined`: the safe default for a dev surface is
 * "hidden", and a store we cannot read is not a store we can migrate into.
 */
export function readDevModeOptIn(): boolean | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) {
      return undefined;
    }
    return JSON.parse(raw) === true;
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

/**
 * Records an opt-in carried over from the deprecated `devModeUserIds` array,
 * without the throw: the migration runs during a config publish, where a browser
 * that denies storage is not a failure the user asked for. It just means the
 * carry-forward is re-attempted on the next load.
 */
export function adoptLegacyDevModeOptIn(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(true));
  } catch {
    // Storage unavailable; the opt-in stays derived from the allow-list for now.
  }
}
