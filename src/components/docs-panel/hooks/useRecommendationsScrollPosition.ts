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
    const animationFrame = requestAnimationFrame(() => {
      const maxScrollTop = container.scrollHeight - container.clientHeight;
      if (scrollTop > 0 && maxScrollTop < scrollTop) {
        return;
      }
      container.scrollTop = scrollTop;
      hasRestoredRef.current = true;
    });

    return () => cancelAnimationFrame(animationFrame);
  }, [isReady]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const handleScroll = () => {
      try {
        sessionStorage.setItem(StorageKeys.RECOMMENDATIONS_SCROLL_POSITION, String(container.scrollTop));
      } catch {}
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, []);

  return containerRef;
}
