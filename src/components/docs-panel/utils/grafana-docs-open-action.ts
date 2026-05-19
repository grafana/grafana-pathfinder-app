/**
 * Computes whether the docs panel should surface the "Open this page in a
 * new tab" button for a docs-like tab, and what URL to send the user to.
 *
 * Extracted from the inline IIFE in `docs-panel.tsx`'s content-meta JSX so
 * the predicate is unit-testable independently of the rendering branch.
 *
 * The button is only shown when the active tab's URL points at an
 * allow-listed Grafana docs hostname; otherwise the descriptor returns
 * `shouldShow: false` and the caller renders nothing.
 */

import { cleanDocsUrl, isGrafanaDocsUrl } from './url-validation';

export interface GrafanaDocsOpenAction {
  shouldShow: boolean;
  cleanUrl?: string;
}

/**
 * Decide whether to render the "Open" button for a tab and compute the
 * cleaned URL to open.
 *
 * The input is the URL resolved at the call site: prefer `content.url`
 * (the resolved fetch URL) and fall back to `baseUrl` (the tab's
 * originally-opened URL) — same precedence as the original inline IIFE.
 */
export function pickGrafanaDocsOpenAction(url: string | undefined): GrafanaDocsOpenAction {
  if (!isGrafanaDocsUrl(url)) {
    return { shouldShow: false };
  }
  return { shouldShow: true, cleanUrl: cleanDocsUrl(url!) };
}
