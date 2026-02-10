/**
 * useScrollPositionPreservation hook - Manages scroll position across tab/content changes
 *
 * This hook handles:
 * - Saving scroll position when content changes
 * - Restoring scroll position when navigating back to previously viewed content
 * - Tracking scroll continuously for the active content
 *
 * IMPORTANT: This hook depends on a DOM element with id="inner-docs-content"
 * existing in the component tree. Do not remove this element without updating this hook.
 *
 * @param activeTabId - Currently active tab ID (used to trigger restoration)
 * @param activeTabBaseUrl - Base URL of active tab
 * @param activeTabCurrentUrl - Current URL of active tab
 * @returns Scroll management functions
 */

import { useRef, useCallback, useEffect } from 'react';

export interface UseScrollPositionPreservationResult {
  saveScrollPosition: () => void;
  restoreScrollPosition: () => void;
}

export function useScrollPositionPreservation(
  activeTabId: string | undefined,
  activeTabBaseUrl: string | undefined,
  activeTabCurrentUrl: string | undefined
): UseScrollPositionPreservationResult {
  const scrollPositionRef = useRef<Record<string, number>>({});
  const lastContentUrlRef = useRef<string>('');

  // Save scroll position before content changes
  const saveScrollPosition = useCallback(() => {
    // CRITICAL: Depends on DOM element with id="inner-docs-content"
    const scrollableElement = document.getElementById('inner-docs-content');
    if (scrollableElement && lastContentUrlRef.current) {
      scrollPositionRef.current[lastContentUrlRef.current] = scrollableElement.scrollTop;
    }
  }, []);

  // Restore scroll position when content loads
  const restoreScrollPosition = useCallback(() => {
    const contentUrl = activeTabCurrentUrl || activeTabBaseUrl || '';
    if (contentUrl && contentUrl !== lastContentUrlRef.current) {
      lastContentUrlRef.current = contentUrl;

      // Restore saved position if available
      const savedPosition = scrollPositionRef.current[contentUrl];
      // CRITICAL: Depends on DOM element with id="inner-docs-content"
      const scrollableElement = document.getElementById('inner-docs-content');
      if (scrollableElement) {
        if (typeof savedPosition === 'number') {
          // Use requestAnimationFrame to ensure DOM is ready
          requestAnimationFrame(() => {
            scrollableElement.scrollTop = savedPosition;
          });
        } else {
          // New content - scroll to top
          requestAnimationFrame(() => {
            scrollableElement.scrollTop = 0;
          });
        }
      }
    }
  }, [activeTabCurrentUrl, activeTabBaseUrl]);

  // Track scroll position continuously
  useEffect(() => {
    // CRITICAL: Depends on DOM element with id="inner-docs-content"
    const scrollableElement = document.getElementById('inner-docs-content');
    if (!scrollableElement) {
      return;
    }

    const handleScroll = () => {
      saveScrollPosition();
    };

    scrollableElement.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      scrollableElement.removeEventListener('scroll', handleScroll);
      saveScrollPosition();
    };
  }, [saveScrollPosition]);

  return {
    saveScrollPosition,
    restoreScrollPosition,
  };
}
