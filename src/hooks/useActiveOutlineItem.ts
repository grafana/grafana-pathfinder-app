import { useCallback, useEffect, useRef, useState } from 'react';
import type { OutlineItem } from './useDocumentOutline';

const SUPPRESS_AFTER_JUMP_MS = 1000;
const TOP_BAND_FRACTION = 0.25;

export interface ActiveOutlineItem {
  activeId: string | null;
  notifyJump: (id: string) => void;
}

export function useActiveOutlineItem(
  items: OutlineItem[],
  containerRef: React.RefObject<HTMLDivElement>,
  scrollRootRef: React.RefObject<HTMLDivElement>
): ActiveOutlineItem {
  const [activeId, setActiveId] = useState<string | null>(null);
  const suppressedUntilRef = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    const root = scrollRootRef.current;
    if (!container || !root || items.length === 0) {
      setActiveId(null);
      return;
    }

    const tracked = items
      .map((item) => ({ item, el: container.querySelector<HTMLElement>('#' + CSS.escape(item.id)) }))
      .filter((entry): entry is { item: OutlineItem; el: HTMLElement } => entry.el !== null);

    if (tracked.length === 0) {
      setActiveId(null);
      return;
    }

    const recompute = () => {
      if (Date.now() < suppressedUntilRef.current) {
        return;
      }
      const rootRect = root.getBoundingClientRect();
      const rootTop = rootRect.top;
      const bandHeight = rootRect.height * TOP_BAND_FRACTION;

      // The active item is the last one whose top has scrolled above the
      // top-quarter band — iterating in document order means a later match
      // naturally overrides an earlier one, which is the tie-break we want.
      let current = tracked[0]!.item;
      for (const { item, el } of tracked) {
        if (el.getBoundingClientRect().top - rootTop <= bandHeight) {
          current = item;
        }
      }
      setActiveId(current.id);
    };

    const observer = new IntersectionObserver(recompute, {
      root,
      rootMargin: `0% 0% -${(1 - TOP_BAND_FRACTION) * 100}% 0%`,
    });
    tracked.forEach(({ el }) => observer.observe(el));
    recompute();

    return () => observer.disconnect();
  }, [items, containerRef, scrollRootRef]);

  const notifyJump = useCallback((id: string) => {
    suppressedUntilRef.current = Date.now() + SUPPRESS_AFTER_JUMP_MS;
    setActiveId(id);
  }, []);

  return { activeId, notifyJump };
}
