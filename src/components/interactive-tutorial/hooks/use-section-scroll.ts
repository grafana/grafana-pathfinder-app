/**
 * `useSectionScroll` — owns auto-scroll coordination for a running
 * section.
 *
 * Pattern F (imperative resource manager) per the High-Risk Refactor
 * Guidelines: owns a scroll listener on `#inner-docs-content`, two
 * refs (`userScrolledRef`, `isProgrammaticScrollRef`), and the
 * `scrollToStep(stepId)` helper that drives `scrollIntoView`.
 *
 * Interaction with the section runner (`handleDoSection`):
 *   - `beginProgrammaticScroll()` is called at the start of a run.
 *     Resets `userScrolled=false` (fresh run) and sets
 *     `isProgrammaticScroll=true` (subsequent scrolls in this run
 *     are ours; ignore them in the listener).
 *   - `scrollToStep(stepId)` is called per step. Bails out if
 *     `userScrolled` is set.
 *   - `endProgrammaticScroll()` is called in the runner's `finally`.
 *     Clears `isProgrammaticScroll`.
 *
 * The listener attach/detach is gated by `isRunning`. The hook
 * does NOT own the docs-panel container; it queries
 * `#inner-docs-content` by id, matching the pre-extraction
 * behaviour exactly.
 */

import { useCallback, useEffect, useRef } from 'react';

export interface UseSectionScrollArgs {
  /** Whether the section is currently in its Do Section run. The
   *  scroll listener is attached only while running. */
  isRunning: boolean;
}

export interface UseSectionScrollResult {
  /** Auto-scroll the matching `[data-step-id="..."]` element into
   *  view. No-op if the user has already scrolled this run. */
  scrollToStep: (stepId: string) => void;
  /** Called at the start of a section run. Resets
   *  `userScrolled=false` and sets `isProgrammaticScroll=true`. */
  beginProgrammaticScroll: () => void;
  /** Called at the end of a section run (typically in `finally`).
   *  Clears `isProgrammaticScroll`. */
  endProgrammaticScroll: () => void;
}

export function useSectionScroll({ isRunning }: UseSectionScrollArgs): UseSectionScrollResult {
  // Track if user has manually scrolled to avoid fighting with auto-scroll.
  const userScrolledRef = useRef(false);
  // Track if we're currently doing a programmatic scroll (to ignore it in listener).
  const isProgrammaticScrollRef = useRef(false);

  // Track user scroll to disable auto-scroll for the rest of section execution.
  useEffect(() => {
    if (!isRunning) {
      return;
    }
    // Target the docs panel scrollable container directly.
    const scrollContainer = document.getElementById('inner-docs-content');
    if (!scrollContainer) {
      return;
    }
    const handleScroll = () => {
      // Ignore programmatic scrolls (our own auto-scroll).
      if (isProgrammaticScrollRef.current) {
        return;
      }
      userScrolledRef.current = true; // Permanently disable for this section run.
    };
    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll);
    };
  }, [isRunning]);

  const scrollToStep = useCallback((stepId: string) => {
    if (userScrolledRef.current) {
      return; // User has scrolled, don't fight them.
    }
    const stepElement = document.querySelector(`[data-step-id="${stepId}"]`);
    if (stepElement) {
      // isProgrammaticScrollRef is already true during section
      // execution; the listener will see and ignore the scroll.
      stepElement.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, []);

  const beginProgrammaticScroll = useCallback(() => {
    userScrolledRef.current = false;
    isProgrammaticScrollRef.current = true;
  }, []);

  const endProgrammaticScroll = useCallback(() => {
    isProgrammaticScrollRef.current = false;
  }, []);

  return { scrollToStep, beginProgrammaticScroll, endProgrammaticScroll };
}
