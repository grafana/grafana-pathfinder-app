import { config } from '@grafana/runtime';

import { PLUGIN_BASE_URL } from '../constants';
import type { LearningJourneyTab } from '../types/content-panel.types';
import { findDocPage } from './find-doc-page';
import { buildPathfinderShareUrl } from './pathfinder-search-params';

const BACKEND_GUIDE_PREFIX = 'backend-guide:';

/**
 * Build a link to the sidebar guide in `tab` for pasting to a coworker, or
 * null when the tab has no shareable guide (non-content tab, or a URL the
 * receiving `findDocPage` would reject, e.g. a dev-mode localhost guide).
 */
export function buildSidebarGuideLink(tab: Pick<LearningJourneyTab, 'type' | 'baseUrl' | 'currentUrl'>): string | null {
  if (tab.type === 'recommendations' || tab.type === 'devtools' || tab.type === 'editor') {
    return null;
  }
  const rawUrl = tab.currentUrl || tab.baseUrl;
  if (!rawUrl) {
    return null;
  }
  const doc = rawUrl.startsWith(BACKEND_GUIDE_PREFIX) ? `api:${rawUrl.slice(BACKEND_GUIDE_PREFIX.length)}` : rawUrl;
  if (!findDocPage(doc)) {
    return null;
  }
  return buildPathfinderShareUrl({
    base: new URL(`${config.appSubUrl ?? ''}${PLUGIN_BASE_URL}`, window.location.origin),
    doc,
    guideType: tab.type === 'learning-journey' ? 'learning-journey' : 'docs',
    panelMode: 'sidebar',
    source: 'shared_link',
  });
}
