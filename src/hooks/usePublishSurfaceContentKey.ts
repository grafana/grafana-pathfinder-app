import { useLayoutEffect } from 'react';

import { getActiveTabUrl, setActiveTabUrl } from '../global-state/content-key';

/**
 * Publish the rendered guide's content key into the ambient content-key state
 * for as long as this surface is mounted, so progress written while it renders
 * lands under that guide rather than under whatever the sidebar last published.
 *
 * Pass the sidebar's spelling (`currentUrl || baseUrl`). A layout effect, for
 * the same reason as `useGlobalActiveTabExposure`: children restore progress in
 * passive effects and must see this key.
 */
export function usePublishSurfaceContentKey(contentKey: string | undefined): void {
  useLayoutEffect(() => {
    if (!contentKey) {
      return;
    }
    try {
      setActiveTabUrl(contentKey);
      window.__DocsPluginActiveTabUrl = contentKey;
    } catch {
      // frozen window globals in sandboxed embeds
    }
    return () => {
      try {
        if (getActiveTabUrl() === contentKey) {
          setActiveTabUrl(undefined);
          window.__DocsPluginActiveTabUrl = '';
        }
      } catch {
        // frozen window globals in sandboxed embeds
      }
    };
  }, [contentKey]);
}
