/**
 * useVerticalOverflow hook — reports whether an element has content below its
 * visible area, i.e. it overflows *and* is not scrolled to the end.
 *
 * Scroll-fade affordances need exactly this. A bottom fade means "there is more
 * below", so applying it whenever the content merely overflows dims the last
 * item once the user reaches the end — and applying it when the content fits
 * dims the last item of a list that never scrolled at all. CSS cannot express
 * either condition, so the measurement happens here.
 *
 * Returns a *callback* ref rather than a ref object: the measured element often
 * mounts after its owner (a list rendered behind a loading skeleton, or after an
 * empty state fills in), and a ref object read once in a mount effect would
 * still be null at that point, leaving the hook permanently dead.
 */

import { useState, useEffect, useCallback } from 'react';

// scrollHeight/clientHeight are rounded independently, so equal heights can
// differ by a fraction of a pixel on fractional-scale displays.
const OVERFLOW_EPSILON = 1;

export function useVerticalOverflow<T extends HTMLElement>(): [(node: T | null) => void, boolean] {
  const [element, setElement] = useState<T | null>(null);
  const [hasOverflow, setHasOverflow] = useState(false);

  // Stable across renders, so attaching it never re-triggers the effect below.
  // Detaching clears the flag here rather than in the effect, so a replacement
  // element never renders once carrying the old element's overflow state.
  const ref = useCallback((node: T | null) => {
    setElement(node);
    if (!node) {
      setHasOverflow(false);
    }
  }, []);

  useEffect(() => {
    if (!element) {
      return;
    }

    const measure = () =>
      setHasOverflow(element.scrollHeight - element.scrollTop - element.clientHeight > OVERFLOW_EPSILON);
    measure();
    element.addEventListener('scroll', measure, { passive: true });

    // Environments without ResizeObserver (jsdom by default) still get the
    // mount-time measurement above rather than a crash.
    if (typeof ResizeObserver === 'undefined') {
      return () => element.removeEventListener('scroll', measure);
    }

    const resizeObserver = new ResizeObserver(measure);

    // The element's own box drives clientHeight; its children drive
    // scrollHeight, and an item expanding in place changes only the latter.
    const observeSubtree = () => {
      resizeObserver.disconnect();
      resizeObserver.observe(element);
      for (const child of Array.from(element.children)) {
        resizeObserver.observe(child);
      }
      measure();
    };

    observeSubtree();
    const mutationObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(observeSubtree);
    mutationObserver?.observe(element, { childList: true });

    return () => {
      element.removeEventListener('scroll', measure);
      resizeObserver.disconnect();
      mutationObserver?.disconnect();
    };
  }, [element]);

  return [ref, hasOverflow];
}
