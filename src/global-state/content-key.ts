/**
 * Content key — the identifier used to scope persisted progress to the
 * current guide / milestone.
 *
 * This module owns the canonical storage as typed module-scope state.
 * The legacy `window.__DocsPluginActiveTabUrl` and
 * `window.__DocsPluginContentKey` globals are still set and/or read by
 * their existing owners (`useGlobalActiveTabExposure`,
 * `content-renderer.tsx`, and `analytics.ts`); the typed readers
 * transparently fall back to them so callers can migrate to the typed
 * API piecemeal. The fallback is therefore load-bearing — do not
 * remove it until those remaining consumers also use the typed API.
 *
 * Resolution order:
 *   1. Active tab URL (canonical: set by `useGlobalActiveTabExposure`)
 *   2. Content-key override (set when the active tab URL is not yet
 *      available — e.g. during preview mode)
 *   3. `window.location.pathname` (last-resort fallback)
 */

const MAX_KEY_LENGTH = 200;

let activeTabUrl: string | undefined;
let contentKeyOverride: string | undefined;

function sanitize(value: string): string {
  return value.replace(/\.\./g, '').slice(0, MAX_KEY_LENGTH);
}

function readGlobal(name: string): string | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  const value = (window as unknown as Record<string, unknown>)[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Update the active tab URL. Producers that own the window global may
 * call this in addition to setting the global; the read path tolerates
 * either being the source.
 */
export function setActiveTabUrl(value: string | undefined): void {
  activeTabUrl = value && value.length > 0 ? value : undefined;
}

export function setContentKeyOverride(value: string | undefined): void {
  contentKeyOverride = value && value.length > 0 ? value : undefined;
}

/**
 * Read the active tab URL as it was last written, falling back to the
 * legacy `window.__DocsPluginActiveTabUrl` global. Returns the raw value
 * without sanitization — callers that need a storage-safe identifier
 * should use {@link getContentKey} instead.
 */
export function getActiveTabUrl(): string | undefined {
  return activeTabUrl ?? readGlobal('__DocsPluginActiveTabUrl');
}

/**
 * Read the content-key override, falling back to the legacy
 * `window.__DocsPluginContentKey` global. Returns the raw value
 * without sanitization — callers that need a storage-safe identifier
 * should use {@link getContentKey} instead.
 */
export function getContentKeyOverride(): string | undefined {
  return contentKeyOverride ?? readGlobal('__DocsPluginContentKey');
}

export function getContentKey(): string {
  const tabUrl = activeTabUrl ?? readGlobal('__DocsPluginActiveTabUrl');
  if (tabUrl) {
    return sanitize(tabUrl);
  }
  const override = contentKeyOverride ?? readGlobal('__DocsPluginContentKey');
  if (override) {
    return sanitize(override);
  }
  return typeof window !== 'undefined' ? sanitize(window.location.pathname) : 'unknown';
}

/**
 * Test-only reset. Clears the typed module state so each test starts
 * from the same baseline; window globals are not touched (callers
 * manage those in their own setup).
 */
export function resetContentKeyForTests(): void {
  activeTabUrl = undefined;
  contentKeyOverride = undefined;
}
