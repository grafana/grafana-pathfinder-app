/**
 * Maximum allowed length for a content key.
 * Prevents excessively long strings from bloating localStorage.
 */
const MAX_KEY_LENGTH = 200;

/**
 * Sanitizes a content key to prevent path traversal and limit storage bloat.
 * Removes `..` sequences and truncates to MAX_KEY_LENGTH.
 */
function sanitizeKey(key: string): string {
  return key.replace(/\.\./g, '').slice(0, MAX_KEY_LENGTH);
}

/**
 * Shared content key resolver for interactive step persistence.
 *
 * Both InteractiveSection and useStandalonePersistence MUST use this function
 * to ensure persist and restore operations target the same storage key.
 *
 * IMPORTANT: Prefers tabUrl over contentKey because tabUrl is available
 * immediately on mount, while __DocsPluginContentKey is set asynchronously
 * via useEffect in content-renderer.tsx (fires AFTER child components mount).
 * Using contentKey first would cause a mismatch: restore (on mount) would
 * fall back to tabUrl while persist (at interaction time) would use contentKey,
 * writing to different storage keys and losing progress on refresh.
 */
export function getContentKey(): string {
  try {
    const tabUrl = (window as any).__DocsPluginActiveTabUrl as string | undefined;
    const contentKey = (window as any).__DocsPluginContentKey as string | undefined;
    const tabId = (window as any).__DocsPluginActiveTabId as string | undefined;
    // Prefer tabUrl — always available on mount, ensuring persist and restore use the same key
    if (tabUrl && tabUrl.length > 0) {
      return sanitizeKey(tabUrl);
    }
    // Fallback to contentKey (set asynchronously, may not be available on mount)
    if (contentKey && contentKey.length > 0) {
      return sanitizeKey(contentKey);
    }
    // Last resort: use tabId
    if (tabId && tabId.length > 0) {
      return sanitizeKey(`tab:${tabId}`);
    }
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[getContentKey] Failed to resolve content key:', error);
    }
  }
  return typeof window !== 'undefined' ? sanitizeKey(window.location.pathname) : 'unknown';
}
