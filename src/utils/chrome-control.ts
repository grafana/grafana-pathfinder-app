/**
 * Chrome control helpers for the main-area learning view.
 *
 * Pure DOM/state helpers that show/hide Grafana's left nav and right sidebar.
 * Used by MainAreaLearningPanel to provide an immersive learning experience
 * via &nav=false, &sidebar=false, and &fullscreen=true URL parameters.
 */

import { getAppEvents } from '@grafana/runtime';
import { sidebarState } from '../global-state/sidebar';

const NAV_ITEM_SELECTOR = 'a[data-testid="data-testid Nav menu item"]';

/** Returns true if Grafana's left nav menu items are visible in the DOM. */
export function isNavVisible(): boolean {
  return document.querySelectorAll(NAV_ITEM_SELECTOR).length > 0;
}

/**
 * Clicks #mega-menu-toggle to collapse the nav.
 * No-op if nav is already hidden or toggle button is missing.
 */
export function collapseNav(): void {
  if (!isNavVisible()) {
    return;
  }
  const toggle = document.querySelector('#mega-menu-toggle') as HTMLButtonElement | null;
  if (toggle) {
    toggle.click();
  }
}

/**
 * Clicks #mega-menu-toggle to expand the nav.
 * No-op if nav is already visible or toggle button is missing.
 */
export function expandNav(): void {
  if (isNavVisible()) {
    return;
  }
  const toggle = document.querySelector('#mega-menu-toggle') as HTMLButtonElement | null;
  if (toggle) {
    toggle.click();
  }
}

/** Closes the extension sidebar via the Grafana event bus. */
export function closeExtensionSidebar(): void {
  getAppEvents().publish({ type: 'close-extension-sidebar', payload: {} });
}

/** Re-opens the Pathfinder sidebar after chrome control cleanup. */
export function restoreSidebar(): void {
  sidebarState.openSidebar('Interactive learning');
}
