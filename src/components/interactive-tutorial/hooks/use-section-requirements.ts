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
 * Returns the current status. The recheck function is exposed for
 * callers that want to force a recheck (currently no consumers do
 * this; the runner has its own inline check).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

interface SectionRequirementsResult {
  pass: boolean;
  // Matches `CheckResult` from the requirements-manager: each entry's
  // `error` is `string | undefined`. The hook reads only the first
  // entry's `error` for display, falling back to a generic message.
  error?: Array<{ error?: string; canFix?: boolean }>;
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
}

export interface UseSectionRequirementsArgs {
  requirements: string | undefined;
  sectionId: string;
  title: string | undefined;
  /** Dependency injection: `useInteractiveElements().checkRequirementsFromData`. */
  checkRequirementsFromData: (data: SectionRequirementsData) => Promise<SectionRequirementsResult>;
}

export interface UseSectionRequirementsResult {
  status: SectionRequirementsStatus;
  recheck: () => Promise<void>;
}

/** Polling interval for periodic recheck (timing contract). */
const RECHECK_INTERVAL_MS = 5000;

export function useSectionRequirements({
  requirements,
  sectionId,
  title,
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
        textContent: title || 'Interactive section',
        tagName: 'section',
      };
      const result = await checkRequirementsFromData(data);
      if (sectionMountedRef.current) {
        setStatus({
          checking: false,
          passed: result.pass,
          error: result.error?.[0]?.error || (result.pass ? undefined : 'Requirements not met'),
        });
      }
    } catch (error) {
      console.warn('Section requirements check failed:', error);
      if (sectionMountedRef.current) {
        // On error, allow section to proceed (fail open for better UX).
        setStatus({ checking: false, passed: true });
      }
    }
  }, [requirements, sectionId, title, checkRequirementsFromData]);

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

  return { status, recheck };
}
