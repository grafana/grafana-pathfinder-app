import { useLayoutEffect, type RefObject } from 'react';
import type { RawContent } from '../../types/content.types';

const lastScrollByReader = new Map<string, { milestone: string; top: number }>();

export function getMilestoneScrollKey(content: RawContent | null | undefined): string | undefined {
  const journey = content?.metadata.learningJourney;
  const course = journey?.baseUrl || content?.metadata.trackMemberBaseUrl;
  return content && course ? JSON.stringify([course, content.url, journey?.currentMilestone]) : undefined;
}

export function useMilestoneScroll(
  contentRef: RefObject<HTMLElement | null>,
  reader: string | undefined,
  milestone: string | undefined,
  hasFragment = false
): void {
  useLayoutEffect(() => {
    if (!reader || !milestone) {
      return;
    }

    const scroller = contentRef.current?.closest<HTMLElement>('[data-milestone-scroll-container]');
    if (!scroller) {
      return;
    }

    const previous = lastScrollByReader.get(reader);
    const top = previous?.milestone === milestone ? previous.top : 0;
    if (!hasFragment) {
      scroller.scrollTop = top;
    }

    const position = { milestone, top: hasFragment ? scroller.scrollTop : top };
    lastScrollByReader.set(reader, position);
    const save = () => {
      const panelState = scroller.parentElement?.dataset.panelState;
      if (lastScrollByReader.get(reader) === position && (!panelState || panelState === 'full')) {
        position.top = scroller.scrollTop;
      }
    };
    scroller.addEventListener('scroll', save, { passive: true });
    return () => scroller.removeEventListener('scroll', save);
  }, [contentRef, reader, milestone, hasFragment]);
}
