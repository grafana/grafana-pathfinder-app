/**
 * Computes whether the docs panel should surface the "open read-only in a new
 * tab" button for a tab, and the full-screen route URL to open.
 *
 * Sibling of `pickGrafanaDocsOpenAction`: that one handles public Grafana docs
 * URLs (directly browser-openable); this one handles the complementary case —
 * custom/private guides on the internal `backend-guide:` / `api:` schemes,
 * which are not addressable HTTP resources. They open in the same-origin (so
 * authenticated) read-only full-screen route with step interactivity disabled.
 */

import { PLUGIN_BASE_URL, ROUTES } from '../../../constants';
import { buildFullScreenRouteUrl } from '../../../utils/pathfinder-search-params';

export interface ReadonlyTabOpenAction {
  shouldShow: boolean;
  readonlyUrl?: string;
}

export function pickReadonlyTabOpenAction(url: string | undefined): ReadonlyTabOpenAction {
  if (!url || (!url.startsWith('backend-guide:') && !url.startsWith('api:'))) {
    return { shouldShow: false };
  }
  return {
    shouldShow: true,
    readonlyUrl: buildFullScreenRouteUrl({
      pluginBaseUrl: PLUGIN_BASE_URL,
      fullScreenRoute: ROUTES.FullScreen,
      doc: url,
      guideType: 'docs',
      readonly: true,
    }),
  };
}
