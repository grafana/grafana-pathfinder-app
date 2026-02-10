import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * Hook for managing section-level requirements checking.
 *
 * Handles:
 * - Initial requirements check on mount
 * - Periodic re-checking (5 second interval)
 * - Re-checking on relevant events (datasources-changed, plugins-changed, popstate)
 * - Fail-open behavior on error (allows section to proceed)
 * - Cleanup of event listeners and intervals on unmount
 */

export interface UseSectionRequirementsParams {
  requirements: string | undefined;
  sectionId: string;
  title: string;
  checkRequirementsFromData: (data: any) => Promise<any>;
}

export interface UseSectionRequirementsResult {
  sectionRequirementsStatus: {
    checking: boolean;
    passed: boolean;
    error?: string;
  };
}

export function useSectionRequirements({
  requirements,
  sectionId,
  title,
  checkRequirementsFromData,
}: UseSectionRequirementsParams): UseSectionRequirementsResult {
  // Section requirements state - tracks whether section-level requirements are met
  const [sectionRequirementsStatus, setSectionRequirementsStatus] = useState<{
    checking: boolean;
    passed: boolean;
    error?: string;
  }>({ checking: !!requirements, passed: !requirements }); // If no requirements, default to passed

  // Track mounted state for section requirements checking
  const sectionMountedRef = useRef(true);
  useEffect(() => {
    sectionMountedRef.current = true;
    return () => {
      sectionMountedRef.current = false;
    };
  }, []);

  // Check section-level requirements on mount and when relevant state changes
  const checkSectionRequirements = useCallback(async () => {
    if (!requirements || !sectionMountedRef.current) {
      setSectionRequirementsStatus({ checking: false, passed: true });
      return;
    }

    setSectionRequirementsStatus((prev) => ({ ...prev, checking: true }));

    try {
      const sectionRequirementsData = {
        requirements: requirements,
        targetaction: 'section',
        reftarget: sectionId,
        targetvalue: undefined,
        textContent: title || 'Interactive section',
        tagName: 'section',
      };

      const result = await checkRequirementsFromData(sectionRequirementsData);

      if (sectionMountedRef.current) {
        setSectionRequirementsStatus({
          checking: false,
          passed: result.pass,
          error: result.error?.[0]?.error || (result.pass ? undefined : 'Requirements not met'),
        });
      }
    } catch (error) {
      console.warn('Section requirements check failed:', error);
      if (sectionMountedRef.current) {
        // On error, allow section to proceed (fail open for better UX)
        setSectionRequirementsStatus({ checking: false, passed: true });
      }
    }
  }, [requirements, sectionId, title, checkRequirementsFromData]);

  // Initial requirements check and re-check on relevant events
  useEffect(() => {
    if (!requirements) {
      return;
    }

    // Initial check
    // eslint-disable-next-line react-hooks/set-state-in-effect
    checkSectionRequirements();

    // Re-check when relevant events occur
    const handleDataSourcesChanged = () => checkSectionRequirements();
    const handlePluginsChanged = () => checkSectionRequirements();
    const handleLocationChanged = () => checkSectionRequirements();

    window.addEventListener('datasources-changed', handleDataSourcesChanged);
    window.addEventListener('plugins-changed', handlePluginsChanged);
    window.addEventListener('popstate', handleLocationChanged);

    // Re-check periodically to catch other state changes
    const intervalId = setInterval(checkSectionRequirements, 5000);

    // REACT: cleanup subscriptions (R1)
    return () => {
      window.removeEventListener('datasources-changed', handleDataSourcesChanged);
      window.removeEventListener('plugins-changed', handlePluginsChanged);
      window.removeEventListener('popstate', handleLocationChanged);
      clearInterval(intervalId);
    };
  }, [requirements, checkSectionRequirements]);

  return {
    sectionRequirementsStatus,
  };
}
