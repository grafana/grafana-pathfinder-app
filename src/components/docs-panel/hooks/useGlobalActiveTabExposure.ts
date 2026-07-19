/**
 * Exposes the active tab's id and URL on `window` for interactive persistence
 * keys (read by `InteractiveSection` during progress restoration), and mirrors
 * the active URL into Faro's view meta.
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
import { setFaroView, setFaroViewName } from '../../../lib/faro';
import { setActiveJourneyContext } from '../../../global-state/journey-context';

export interface UseGlobalActiveTabExposureParams {
  activeTabId: string | undefined;
  activeTabCurrentUrl: string | undefined;
  activeTabBaseUrl: string | undefined;
  journeyMilestone?: number;
  journeyTotalMilestones?: number;
  /** Must be derived with getMilestoneSlug, matching markMilestoneDone's writes, or set membership fails. */
  journeyActiveMilestoneSlug?: string;
  /** Roster of milestone slugs, same derivation; caller must memoize the array reference. */
  journeyMilestoneSlugs?: string[];
}

export function useGlobalActiveTabExposure({
  activeTabId,
  activeTabCurrentUrl,
  activeTabBaseUrl,
  journeyMilestone,
  journeyTotalMilestones,
  journeyActiveMilestoneSlug,
  journeyMilestoneSlugs,
}: UseGlobalActiveTabExposureParams): void {
  React.useLayoutEffect(() => {
    try {
      (window as any).__DocsPluginActiveTabId = activeTabId || '';
      (window as any).__DocsPluginActiveTabUrl = activeTabCurrentUrl || activeTabBaseUrl || '';
    } catch {
      // no-op
    }
    setActiveJourneyContext(
      journeyTotalMilestones !== undefined
        ? {
            journeyUrl: activeTabBaseUrl || '',
            milestoneNumber: journeyMilestone ?? 0,
            totalMilestones: journeyTotalMilestones,
            activeMilestoneSlug: journeyActiveMilestoneSlug,
            milestoneSlugs: journeyMilestoneSlugs,
          }
        : null
    );
    const url = activeTabCurrentUrl || activeTabBaseUrl || '';
    if (url) {
      setFaroView(url);
    } else {
      // No URL to derive a view from — cold start or the recommendations
      // tab (which has no `content.url`). Previously left the view stale.
      setFaroViewName('recommendations');
    }
    return () => setActiveJourneyContext(null);
  }, [
    activeTabId,
    activeTabCurrentUrl,
    activeTabBaseUrl,
    journeyMilestone,
    journeyTotalMilestones,
    journeyActiveMilestoneSlug,
    journeyMilestoneSlugs,
  ]);
}
