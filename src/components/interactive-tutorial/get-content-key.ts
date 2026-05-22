/**
 * Thin re-export of the canonical content-key resolver.
 *
 * Historically this module owned its own resolver that read the window
 * globals directly. The typed authority lives in `src/global-state/content-key.ts`
 * (`getContentKey()` prefers typed module state and falls back to the
 * legacy `window.__DocsPluginActiveTabUrl` / `__DocsPluginContentKey`
 * globals, then `window.location.pathname`).
 *
 * Keeping a stub here avoids a sprawling import-path migration in this
 * PR while ensuring every section / persistence hook resolves the same
 * key the completion store uses. If you're touching the interactive
 * tier, prefer importing from `../../global-state/content-key` directly.
 */
export { getContentKey } from '../../global-state/content-key';
