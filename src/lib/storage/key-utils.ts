/**
 * Shared low-level storage helpers.
 *
 * Two prefix-sweep operations are duplicated in 7+ call sites across the
 * codebase (`user-storage.ts`, `experiment-utils.ts`,
 * `highlighted-guide-utils.ts`, `experiment-debug.ts`). They follow the same
 * three-step pattern: iterate storage by index, collect matching keys into
 * an array, then act on each. Routing through one helper makes the
 * iteration order, error handling, and "skip keys that turn null mid-walk"
 * behavior consistent across the codebase.
 *
 * These helpers operate on a `Storage` instance directly so they work
 * against `localStorage`, `sessionStorage`, or any test double. They never
 * route through `UserStorage` — the prefix sweep is a key-shape operation,
 * not a value-shape operation.
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
 * Normalize a content key by stripping trailing slashes.
 * Used before prefix comparisons to ensure consistent matching.
 */
function normalizeForPrefixMatch(value: string): string {
  return value.replace(/\/+$/, '');
}

/**
 * Test whether `key` matches `prefix` exactly or is a direct child path of it
 * (i.e., `key` starts with `prefix + '/'`). Unlike naive `startsWith`, this
 * prevents `/alerting` from matching `/alerting-advanced`.
 *
 * Both values are normalized (trailing slashes stripped) before comparison.
 * An empty `prefix` matches everything (for intentional bulk-clear operations).
 *
 * Note: Only `/` is treated as a path boundary. Query strings (`?`) and hash
 * fragments (`#`) are not handled as delimiters—if keys can contain these,
 * callers must handle them separately.
 */
export function matchesPrefixOrChild(key: string, prefix: string): boolean {
  const normalizedKey = normalizeForPrefixMatch(key);
  const normalizedPrefix = normalizeForPrefixMatch(prefix);

  if (normalizedPrefix === '') {
    return true;
  }

  return normalizedKey === normalizedPrefix || normalizedKey.startsWith(normalizedPrefix + '/');
}
