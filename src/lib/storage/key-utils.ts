/**
 * Shared low-level storage helpers, in two families that share the same
 * key-shape vocabulary.
 *
 * 1. Prefix sweeps — `collectKeysByPrefix` / `clearKeysByPrefix`. The
 *    collect-then-act pattern is duplicated in 7+ call sites across the
 *    codebase (`user-storage.ts`, `experiment-utils.ts`,
 *    `highlighted-guide-utils.ts`, `experiment-debug.ts`), all following the
 *    same three steps: iterate storage by index, collect matching keys into
 *    an array, then act on each. Routing through one helper keeps the
 *    iteration order, error handling, and "skip keys that turn null
 *    mid-walk" behavior consistent. These operate on a `Storage` instance
 *    directly so they work against `localStorage`, `sessionStorage`, or any
 *    test double, and never route through `UserStorage` — a prefix sweep is
 *    a key-shape operation, not a value-shape one.
 *
 * 2. Key-shape predicate — `isKeyUnderPrefix`. A pure function over content
 *    keys (no `Storage`) that decides path-hierarchy membership, so callers
 *    reset a path without clobbering a sibling that merely shares its text
 *    prefix. It lives here beside the sweeps because they are its callers
 *    and speak the same key vocabulary.
 */

/**
 * Return every key in `storage` that begins with `prefix`.
 *
 * Iterates from `storage.length - 1` down to 0 so a caller can safely
 * `storage.removeItem(key)` while iterating without skipping siblings.
 * Returns an empty array if storage access throws (private mode, etc).
 */
export function collectKeysByPrefix(storage: Storage, prefix: string): string[] {
  const matches: string[] = [];
  try {
    for (let i = storage.length - 1; i >= 0; i--) {
      const key = storage.key(i);
      if (key !== null && key.startsWith(prefix)) {
        matches.push(key);
      }
    }
  } catch {
    // Storage unavailable — caller treats absence as "no keys".
  }
  return matches;
}

/**
 * Remove every key in `storage` that begins with `prefix`. Returns the
 * list of keys that were cleared, in the order they were removed. Safe to
 * call when storage is unavailable (returns `[]`).
 */
export function clearKeysByPrefix(storage: Storage, prefix: string): string[] {
  const keys = collectKeysByPrefix(storage, prefix);
  try {
    for (const key of keys) {
      storage.removeItem(key);
    }
  } catch {
    // Partial removal is fine — the keys we did clear remain cleared.
  }
  return keys;
}

/**
 * Return `true` when `key` belongs under the path hierarchy rooted at
 * `prefix`. This avoids the sibling-clobber bug (#1928) where a plain
 * `key.startsWith(prefix)` causes `/alerting` to match `/alerting-advanced`
 * and a reset of one path wipes its sibling's progress.
 *
 * A child is recognised only when `prefix` is followed by a hierarchy
 * boundary. `/` is the path delimiter; `?` and `#` are boundaries too, so a
 * query string or fragment on the path itself (`/alerting?utm=x`,
 * `/alerting#top`) is still under the path, while `/alerting-advanced` — where
 * the next character is neither — is not. An empty prefix matches everything
 * (clear-all semantics) and an exact match is always under itself. A prefix
 * that already ends with `/` is matched by plain `startsWith`.
 */
const HIERARCHY_BOUNDARIES = new Set(['/', '?', '#']);

export function isKeyUnderPrefix(key: string, prefix: string): boolean {
  if (prefix === '') {
    return true;
  }
  if (key === prefix) {
    return true;
  }
  if (prefix.endsWith('/')) {
    return key.startsWith(prefix);
  }
  if (!key.startsWith(prefix)) {
    return false;
  }
  return HIERARCHY_BOUNDARIES.has(key.charAt(prefix.length));
}
