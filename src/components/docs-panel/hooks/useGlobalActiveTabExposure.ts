/**
 * Exposes the active tab's id and URL on `window` for interactive persistence
 * keys (read by `InteractiveSection` during progress restoration).
 *
 * MUST use `useLayoutEffect` (not `useEffect`) so the globals are set
 * synchronously before any child's passive `useEffect` runs. `useEffect`
 * fires bottom-up (children first), so a parent `useEffect` would still
 * hold the PREVIOUS milestone's URL when `InteractiveSection` restores
 * progress, causing wrong-milestone progress to flash. `useLayoutEffect`
 * fires synchronously before any passive effects.
 *
 * Contract surfaces preserved (Pattern J — pinned by
 * docs-panel.contract.test.tsx):
 *   - Window global names: `__DocsPluginActiveTabId`, `__DocsPluginActiveTabUrl`
 *
 * The try/catch keeps the effect resilient against frozen window globals
 * in unusual host environments (e.g. some sandboxed Grafana embeds).
 */
import * as React from 'react';

export interface UseGlobalActiveTabExposureParams {
  activeTabId: string | undefined;
  activeTabCurrentUrl: string | undefined;
  activeTabBaseUrl: string | undefined;
}

export function useGlobalActiveTabExposure({
  activeTabId,
  activeTabCurrentUrl,
  activeTabBaseUrl,
}: UseGlobalActiveTabExposureParams): void {
  React.useLayoutEffect(() => {
    try {
      (window as any).__DocsPluginActiveTabId = activeTabId || '';
      (window as any).__DocsPluginActiveTabUrl = activeTabCurrentUrl || activeTabBaseUrl || '';
    } catch {
      // no-op
    }
  }, [activeTabId, activeTabCurrentUrl, activeTabBaseUrl]);
}
