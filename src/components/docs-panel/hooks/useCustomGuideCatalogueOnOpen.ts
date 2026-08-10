/**
 * Fetches the custom guide catalogue once when the panel opens.
 *
 * The Custom Guides surface fetches it too, but only once its section renders,
 * so opening the panel on any other tab never exercises the App Platform proxy.
 * Firing it here gives the route (and the on-behalf-of token exchange behind it)
 * a deterministic hit on panel open, which is what makes an unhealthy proxy
 * visible on a real stack instead of only when a user happens to look at Custom
 * Guides. Failures are already swallowed by the client, so this never affects
 * what the panel renders — inspect the `/custom-guide-repository` response's
 * `capability.reason` to see why it came back empty.
 */
import * as React from 'react';
import { config } from '@grafana/runtime';

import { fetchCustomGuideRepository } from '../../../lib/custom-guide-repository-client';

export function useCustomGuideCatalogueOnOpen(): void {
  const hasFetchedRef = React.useRef(false);

  React.useEffect(() => {
    if (hasFetchedRef.current) {
      return;
    }
    hasFetchedRef.current = true;
    // The client resolves to [] on every failure path, so this catch only
    // guards against a future contract change becoming an unhandled rejection.
    fetchCustomGuideRepository(config.namespace).catch(() => {});
  }, []);
}
