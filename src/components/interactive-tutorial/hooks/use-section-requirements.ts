/**
 * `useSectionRequirements` — owns section-level requirements polling.
 *
 * Pattern F (imperative resource manager) with a Pattern G-flavoured
 * timing contract per the High-Risk Refactor Guidelines. The hook
 * owns:
 *   - `sectionRequirementsStatus` state ({ checking, passed, error }).
 *   - `sectionMountedRef` lifecycle guard for async setState safety.
 *   - The `checkSectionRequirements` async callback.
 *   - The effect that wires up four event listeners + a 5-second
 *     `setInterval` polling loop. **The 5-second cadence is a
 *     timing contract** — preserved literally.
 *
 * Listeners (registered only when `requirements` is set):
 *   - `window` 'datasources-changed' → recheck
 *   - `window` 'plugins-changed' → recheck
 *   - `window` 'popstate' → recheck
 *   - `document` 'section-completed' → recheck
 *
 * Returns the current status, a recheck function, and a fix function.
 * The recheck function is exposed for callers that want to force a
 * recheck (currently no consumers do this; the runner has its own
 * inline check). The fix function navigates to satisfy a fixable
 * requirement and triggers a recheck afterwards.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getRequirementExplanation, dispatchFix } from '../../../requirements-manager';
import { DEFAULT_INTERACTIVE_SECTION_TITLE } from '../interactive-section';

interface SectionRequirementsResult {
  pass: boolean;
  // Matches `CheckResult` from the requirements-manager: each entry's
  // `error` is `string | undefined`. The hook reads only the first
  // entry's `error` for display, falling back to a generic message.
  error?: Array<{
    error?: string;
    canFix?: boolean;
    fixType?: string;
    targetHref?: string;
    scrollContainer?: string;
    requirement?: string;
  }>;
}

interface SectionRequirementsData {
  requirements: string;
  targetaction: string;
  reftarget: string;
  targetvalue: string | undefined;
  textContent: string;
  tagName: string;
}

export interface SectionRequirementsStatus {
  checking: boolean;
  passed: boolean;
  error?: string;
  canFix?: boolean;
  fixType?: string;
  targetHref?: string;
  scrollContainer?: string;
  explanation?: string;
}

export interface UseSectionRequirementsArgs {
  requirements: string | undefined;
  sectionId: string;
  title: string | undefined;
  hints?: string;
  /** Dependency injection: `useInteractiveElements().checkRequirementsFromData`. */
  checkRequirementsFromData: (data: SectionRequirementsData) => Promise<SectionRequirementsResult>;
}

export interface UseSectionRequirementsResult {
  status: SectionRequirementsStatus;
  recheck: () => Promise<void>;
  fix: () => Promise<void>;
}

/** Polling interval for periodic recheck (timing contract). */
const RECHECK_INTERVAL_MS = 5000;

export function useSectionRequirements({
  requirements,
  sectionId,
  title,
  hints,
  checkRequirementsFromData,
}: UseSectionRequirementsArgs): UseSectionRequirementsResult {
  const [status, setStatus] = useState<SectionRequirementsStatus>({
    checking: !!requirements,
    passed: !requirements,
  });

  const sectionMountedRef = useRef(true);
  useEffect(() => {
    sectionMountedRef.current = true;
    return () => {
      sectionMountedRef.current = false;
    };
  }, []);

  const recheck = useCallback(async () => {
    if (!requirements || !sectionMountedRef.current) {
      setStatus({ checking: false, passed: true });
      return;
    }
    setStatus((prev) => ({ ...prev, checking: true }));

    try {
      const data: SectionRequirementsData = {
        requirements,
        targetaction: 'section',
        reftarget: sectionId,
        targetvalue: undefined,
        textContent: title || DEFAULT_INTERACTIVE_SECTION_TITLE,
        tagName: 'section',
      };
      const result = await checkRequirementsFromData(data);
      if (sectionMountedRef.current) {
        const fixableError = result.error?.find((e) => e.canFix);
        // Use the fixable error for explanation when one exists, so the
        // message matches the issue the Fix button will actually resolve.
        const explanationSource = fixableError ?? result.error?.[0];
        setStatus({
          checking: false,
          passed: result.pass,
          error: result.error?.[0]?.error || (result.pass ? undefined : 'Requirements not met'),
          canFix: !!fixableError,
          fixType: fixableError?.fixType,
          targetHref: fixableError?.targetHref,
          scrollContainer: fixableError?.scrollContainer,
          explanation: result.pass
            ? undefined
            : getRequirementExplanation(explanationSource?.requirement, hints, explanationSource?.error),
        });
      }
    } catch (error) {
      console.warn('Section requirements check failed:', error);
      if (sectionMountedRef.current) {
        // On error, allow section to proceed (fail open for better UX).
        setStatus({ checking: false, passed: true });
      }
    }
  }, [requirements, sectionId, title, hints, checkRequirementsFromData]);

  // Keep a ref so `fix` closes over current status without recreating on
  // every polling tick (status.checking flips true/false every 5 seconds).
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const fix = useCallback(async () => {
    const { canFix, fixType, targetHref, scrollContainer } = statusRef.current;
    if (!canFix) {
      return;
    }
    try {
      const { NavigationManager } = await import('../../../interactive-engine');
      const navigationManager = new NavigationManager();
      const result = await dispatchFix({
        fixType,
        targetHref,
        scrollContainer,
        requirements,
        stepId: sectionId,
        navigationManager,
        fixNavigationRequirements: () => navigationManager.fixNavigationRequirements(),
      });
      if (!result.ok) {
        console.warn('useSectionRequirements: fix failed:', result.error);
      }
      await recheck();
    } catch (fixError) {
      console.warn('Failed to fix section requirements:', fixError);
    }
  }, [requirements, sectionId, recheck]);

  // Initial requirements check and re-check on relevant events.
  useEffect(() => {
    if (!requirements) {
      return;
    }

    // Initial check on mount / when requirements change. The setState
    // inside recheck is guarded by `sectionMountedRef` so it cannot
    // run after unmount; the rule's heuristic flags it anyway.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    recheck();

    const handleDataSourcesChanged = () => recheck();
    const handlePluginsChanged = () => recheck();
    const handleLocationChanged = () => recheck();
    const handleSectionCompleted = () => recheck();

    window.addEventListener('datasources-changed', handleDataSourcesChanged);
    window.addEventListener('plugins-changed', handlePluginsChanged);
    window.addEventListener('popstate', handleLocationChanged);
    document.addEventListener('section-completed', handleSectionCompleted);

    const intervalId = setInterval(recheck, RECHECK_INTERVAL_MS);

    return () => {
      window.removeEventListener('datasources-changed', handleDataSourcesChanged);
      window.removeEventListener('plugins-changed', handlePluginsChanged);
      window.removeEventListener('popstate', handleLocationChanged);
      document.removeEventListener('section-completed', handleSectionCompleted);
      clearInterval(intervalId);
    };
  }, [requirements, recheck]);

  return { status, recheck, fix };
}
