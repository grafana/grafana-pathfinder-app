/**
 * Persists the Recommended list's scroll position across the navigate-away-and-back
 * cycle (select a guide, view it, return to Recommended). `ContextPanelRenderer` fully
 * unmounts while another tab is active, so an in-memory ref won't survive — this uses
 * sessionStorage (tab-scoped, cleared when the browser tab closes) instead.
 */
import { useEffect, useRef, RefObject } from 'react';
import { StorageKeys } from '../../../lib/storage-keys';

export function useRecommendationsScrollPosition(isReady: boolean): RefObject<HTMLDivElement> {
  const containerRef = useRef<HTMLDivElement>(null);
  const hasRestoredRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isReady || hasRestoredRef.current) {
      return;
    }
    hasRestoredRef.current = true;

    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem(StorageKeys.RECOMMENDATIONS_SCROLL_POSITION);
    } catch {
      return;
    }
    if (saved === null) {
      return;
    }
    const scrollTop = Number(saved);
    if (!Number.isFinite(scrollTop)) {
      return;
    }
    requestAnimationFrame(() => {
      container.scrollTop = scrollTop;
    });
  }, [isReady]);

  // Deliberately independent of `isReady`: this effect attaches once per mount so the
  // teardown it runs on `isReady` transitions can't overwrite the value the restore
  // effect above is about to read.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const handleScroll = () => {
      try {
        sessionStorage.setItem(StorageKeys.RECOMMENDATIONS_SCROLL_POSITION, String(container.scrollTop));
      } catch {
        // Ignore storage errors (quota exceeded, private browsing, etc.)
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      handleScroll();
      container.removeEventListener('scroll', handleScroll);
    };
  }, []);

  return containerRef;
}
