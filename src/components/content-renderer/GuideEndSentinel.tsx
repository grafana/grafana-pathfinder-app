import React, { useEffect, useRef } from 'react';

/** How close to the bottom of the visible area the end of the content counts as seen. */
export const GUIDE_END_VISIBLE_MARGIN_PX = 50;

interface GuideEndSentinelProps {
  /** Content has settled: rendered, snippets inlined, alignment unpaused. */
  armed: boolean;
  contentRootRef: React.RefObject<HTMLElement | null>;
  onViewed: () => void;
}

function imagesSettled(root: HTMLElement | null): Promise<void> {
  const pending = Array.from(root?.querySelectorAll('img') ?? []).filter((img) => !img.complete);
  return Promise.all(
    pending.map(
      (img) =>
        new Promise<void>((resolve) => {
          img.addEventListener('load', () => resolve(), { once: true });
          img.addEventListener('error', () => resolve(), { once: true });
        })
    )
  ).then(() => undefined);
}

/**
 * Reports, once, that the end of the guide content entered the visible area.
 *
 * `root: null` is deliberate: every ancestor scroll container clips the
 * target, so one observer covers the sidebar, floating panel, full screen and
 * reader overlay alike. `rootMargin` would only widen the viewport, not those
 * containers, so the margin is the sentinel's own upward offset instead.
 */
export function GuideEndSentinel({ armed, contentRootRef, onViewed }: GuideEndSentinelProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const onViewedRef = useRef(onViewed);
  useEffect(() => {
    onViewedRef.current = onViewed;
  }, [onViewed]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!armed || !sentinel || typeof IntersectionObserver === 'undefined') {
      return;
    }
    let done = false;
    let imagesReady = false;
    let frame: number | undefined;
    let observer: IntersectionObserver | undefined;

    const observe = () => {
      if (done || !imagesReady || observer || document.visibilityState !== 'visible') {
        return;
      }
      const current = new IntersectionObserver((entries) => {
        if (done) {
          return;
        }
        // A hidden tab can deliver a stale intersection; re-observe once visible.
        if (document.visibilityState !== 'visible') {
          current.disconnect();
          observer = undefined;
          return;
        }
        if (entries.some((entry) => entry.isIntersecting)) {
          done = true;
          current.disconnect();
          onViewedRef.current();
        }
      });
      observer = current;
      current.observe(sentinel);
    };

    document.addEventListener('visibilitychange', observe);
    void imagesSettled(contentRootRef.current).then(() => {
      if (done) {
        return;
      }
      imagesReady = true;
      // One frame lets a surface's own ready handler restore scroll position first.
      frame = requestAnimationFrame(observe);
    });

    return () => {
      done = true;
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }
      observer?.disconnect();
      document.removeEventListener('visibilitychange', observe);
    };
  }, [armed, contentRootRef]);

  return (
    <div
      ref={sentinelRef}
      aria-hidden="true"
      data-testid="guide-end-sentinel"
      style={{
        position: 'relative',
        top: -GUIDE_END_VISIBLE_MARGIN_PX,
        height: 1,
        marginBottom: -1,
        flexShrink: 0,
        pointerEvents: 'none',
      }}
    />
  );
}
