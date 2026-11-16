import React, { useEffect, useRef } from 'react';
import { subscribeProgress } from '../../global-state/completion-store';

/** How close to the bottom of the visible area the end of the content counts as seen. */
export const GUIDE_END_VISIBLE_MARGIN_PX = 50;

interface GuideEndSentinelProps {
  /** Content has settled: rendered, snippets inlined, alignment unpaused. */
  armed: boolean;
  contentRootRef: React.RefObject<HTMLElement | null>;
  contentKey: string;
  onViewed: () => boolean;
}

function imagesSettled(root: HTMLElement | null, signal: AbortSignal): Promise<void> {
  const pending = Array.from(root?.querySelectorAll('img') ?? []).filter((img) => !img.complete);
  return Promise.all(
    pending.map(
      (img) =>
        new Promise<void>((resolve) => {
          img.addEventListener('load', () => resolve(), { once: true, signal });
          img.addEventListener('error', () => resolve(), { once: true, signal });
        })
    )
  ).then(() => undefined);
}

export function GuideEndSentinel({ armed, contentRootRef, contentKey, onViewed }: GuideEndSentinelProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const acceptedRef = useRef(false);
  const onViewedRef = useRef(onViewed);
  useEffect(() => {
    onViewedRef.current = onViewed;
  }, [onViewed]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!armed || acceptedRef.current || !sentinel || typeof IntersectionObserver === 'undefined') {
      return;
    }
    let done = false;
    let imageWait: AbortController | undefined;
    let imagesReady = false;
    let frame: number | undefined;
    let observer: IntersectionObserver | undefined;

    const observe = () => {
      if (done || !imagesReady || observer || document.visibilityState !== 'visible') {
        return;
      }
      const current = new IntersectionObserver((entries) => {
        if (done || observer !== current) {
          return;
        }
        // A hidden tab can deliver a stale intersection; re-observe once visible.
        if (document.visibilityState !== 'visible') {
          current.disconnect();
          observer = undefined;
          return;
        }
        if (entries.some((entry) => entry.isIntersecting) && onViewedRef.current()) {
          acceptedRef.current = true;
          done = true;
          current.disconnect();
        }
      });
      observer = current;
      current.observe(sentinel);
    };

    const prepareObservation = () => {
      if (done) {
        return;
      }
      imageWait?.abort();
      const controller = new AbortController();
      imageWait = controller;
      observer?.disconnect();
      observer = undefined;
      imagesReady = false;
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }
      void imagesSettled(contentRootRef.current, controller.signal).then(() => {
        if (done || controller.signal.aborted) {
          return;
        }
        imagesReady = true;
        // Wait for layout and scroll restoration before checking the new end position.
        frame = requestAnimationFrame(observe);
      });
    };

    const unsubscribe = subscribeProgress(contentKey, prepareObservation);
    document.addEventListener('visibilitychange', observe);
    prepareObservation();

    return () => {
      done = true;
      unsubscribe();
      imageWait?.abort();
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }
      observer?.disconnect();
      document.removeEventListener('visibilitychange', observe);
    };
  }, [armed, contentRootRef, contentKey]);

  return (
    <div
      ref={sentinelRef}
      aria-hidden="true"
      data-testid="guide-end-sentinel"
      style={{
        position: 'relative',
        // rootMargin cannot widen ancestor scroll containers, so offset the sentinel itself.
        top: -GUIDE_END_VISIBLE_MARGIN_PX,
        height: 1,
        marginBottom: -1,
        flexShrink: 0,
        pointerEvents: 'none',
      }}
    />
  );
}
