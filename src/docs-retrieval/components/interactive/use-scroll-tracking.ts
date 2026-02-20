import { useRef, useEffect, useCallback } from 'react';

/**
 * Hook for tracking user scroll and managing auto-scroll coordination.
 *
 * Handles:
 * - Detecting user scroll vs programmatic scroll
 * - Disabling auto-scroll when user manually scrolls
 * - Auto-scrolling to executing steps
 * - Cleanup of scroll listeners on unmount
 */

export interface UseScrollTrackingParams {
  isRunning: boolean;
}

export interface UseScrollTrackingResult {
  userScrolledRef: React.MutableRefObject<boolean>;
  isProgrammaticScrollRef: React.MutableRefObject<boolean>;
  scrollToStep: (stepId: string) => void;
}

export function useScrollTracking({ isRunning }: UseScrollTrackingParams): UseScrollTrackingResult {
  // Track if user has manually scrolled to avoid fighting with auto-scroll
  const userScrolledRef = useRef(false);
  // Track if we're currently doing a programmatic scroll (to ignore it in listener)
  const isProgrammaticScrollRef = useRef(false);

  // Track user scroll to disable auto-scroll for the rest of section execution
  useEffect(() => {
    if (!isRunning) {
      return;
    }

    // Target the docs panel scrollable container directly (inner-docs-content)
    const scrollContainer = document.getElementById('inner-docs-content');

    if (!scrollContainer) {
      return;
    }

    const handleScroll = () => {
      // Ignore programmatic scrolls (our own auto-scroll)
      if (isProgrammaticScrollRef.current) {
        return;
      }
      userScrolledRef.current = true; // Permanently disable for this section run
    };

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll);
    };
  }, [isRunning]);

  // Auto-scroll to current executing step
  const scrollToStep = useCallback((stepId: string) => {
    if (userScrolledRef.current) {
      return; // User has scrolled, don't fight them
    }

    // Find the step element by data-step-id
    const stepElement = document.querySelector(`[data-step-id="${stepId}"]`);
    if (stepElement) {
      // isProgrammaticScrollRef is already true during section execution
      // so we don't need to set/reset it here
      stepElement.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, []);

  return {
    userScrolledRef,
    isProgrammaticScrollRef,
    scrollToStep,
  };
}
