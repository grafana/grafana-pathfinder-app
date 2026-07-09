import { useEffect, useLayoutEffect, useRef } from 'react';
import { FLOATING_PANEL_DODGE_MARGIN, type FloatingPanelGeometry } from '../../constants/floating-panel';

/** Selectors for interactive overlay elements that the panel should dodge. */
const HIGHLIGHT_SELECTOR = '.interactive-highlight-outline, .interactive-comment-box';

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * Find the best corner position that avoids the highlight rect.
 * Returns null if no corner provides enough clearance.
 */
function findDodgePosition(
  panelWidth: number,
  panelHeight: number,
  highlightRect: Rect,
  margin: number
): { x: number; y: number } | null {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const candidates = [
    { x: vw - panelWidth - margin, y: vh - panelHeight - margin }, // bottom-right
    { x: margin, y: vh - panelHeight - margin }, // bottom-left
    { x: vw - panelWidth - margin, y: margin }, // top-right
    { x: margin, y: margin }, // top-left
  ];

  for (const pos of candidates) {
    const panelRect: Rect = {
      left: pos.x,
      top: pos.y,
      right: pos.x + panelWidth,
      bottom: pos.y + panelHeight,
      width: panelWidth,
      height: panelHeight,
    };

    const expandedHighlight: Rect = {
      left: highlightRect.left - margin,
      top: highlightRect.top - margin,
      right: highlightRect.right + margin,
      bottom: highlightRect.bottom + margin,
      width: highlightRect.width + margin * 2,
      height: highlightRect.height + margin * 2,
    };

    if (!rectsOverlap(panelRect, expandedHighlight)) {
      return pos;
    }
  }

  return null;
}

function toRect(r: DOMRect): Rect {
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
}

function unionOfRects(rects: Rect[]): Rect {
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.right));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

/** Largest visible native modal rect, excluding Pathfinder's own floating panel. */
function largestVisibleModalRect(): Rect | null {
  let best: Rect | null = null;
  let bestArea = 0;
  for (const el of Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'))) {
    if (el.closest('[data-pathfinder-content="true"]')) {
      continue;
    }
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
      continue;
    }
    const r = el.getBoundingClientRect();
    const area = r.width * r.height;
    if (area > bestArea) {
      bestArea = area;
      best = toRect(r);
    }
  }
  return best;
}

/**
 * Hook that watches for interactive highlight overlays and auto-repositions
 * the floating panel to avoid overlapping them.
 *
 * Uses a MutationObserver on document.body to detect when highlight elements
 * are added/removed. Geometry is read from a ref so the observer doesn't
 * need to be recreated when the panel moves.
 */
export function useHighlightDodge(geometry: FloatingPanelGeometry, isMinimized: boolean, dodgeModal = false) {
  const previousPositionRef = useRef<{ x: number; y: number } | null>(null);
  // Store geometry in a ref so the observer callback always reads current values
  // without the effect needing to depend on geometry (which changes during drag)
  const geometryRef = useRef(geometry);
  const dodgeModalRef = useRef(dodgeModal);
  useLayoutEffect(() => {
    geometryRef.current = geometry;
    dodgeModalRef.current = dodgeModal;
  });

  useEffect(() => {
    if (isMinimized) {
      return;
    }

    const checkAndDodge = () => {
      const geo = geometryRef.current;
      const obstacles: Rect[] = Array.from(document.querySelectorAll(HIGHLIGHT_SELECTOR)).map((el) =>
        toRect(el.getBoundingClientRect())
      );
      if (dodgeModalRef.current) {
        const modalRect = largestVisibleModalRect();
        if (modalRect) {
          obstacles.push(modalRect);
        }
      }
      if (obstacles.length === 0) {
        if (previousPositionRef.current) {
          document.dispatchEvent(
            new CustomEvent('pathfinder-floating-restore-position', {
              detail: previousPositionRef.current,
            })
          );
          previousPositionRef.current = null;
          document.dispatchEvent(new CustomEvent('pathfinder-floating-restore-full'));
        }
        return;
      }

      const union = unionOfRects(obstacles);

      const panelRect: Rect = {
        left: geo.x,
        top: geo.y,
        right: geo.x + geo.width,
        bottom: geo.y + geo.height,
        width: geo.width,
        height: geo.height,
      };

      if (!rectsOverlap(panelRect, union)) {
        return;
      }

      if (!previousPositionRef.current) {
        previousPositionRef.current = { x: geo.x, y: geo.y };
      }

      const dodgePos = findDodgePosition(geo.width, geo.height, union, FLOATING_PANEL_DODGE_MARGIN);

      if (dodgePos) {
        document.dispatchEvent(
          new CustomEvent('pathfinder-floating-dodge', {
            detail: dodgePos,
          })
        );
      } else {
        document.dispatchEvent(new CustomEvent('pathfinder-floating-compact'));
      }
    };

    const observer = new MutationObserver((mutations) => {
      let relevant = false;
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          const check = (nodes: NodeList) => {
            for (const node of nodes) {
              if (node instanceof HTMLElement) {
                if (
                  node.classList.contains('interactive-highlight-outline') ||
                  node.classList.contains('interactive-comment-box')
                ) {
                  relevant = true;
                  return;
                }
              }
            }
          };
          check(mutation.addedNodes);
          check(mutation.removedNodes);
        }
      }
      if (relevant) {
        requestAnimationFrame(checkAndDodge);
      }
    });

    const handleModalStateChange = () => requestAnimationFrame(checkAndDodge);

    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('pathfinder-modal-state-changed', handleModalStateChange);
    checkAndDodge();

    return () => {
      observer.disconnect();
      document.removeEventListener('pathfinder-modal-state-changed', handleModalStateChange);
      previousPositionRef.current = null;
    };
  }, [isMinimized]); // Stable deps — geometry read from ref
}
