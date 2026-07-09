import { useEffect, useLayoutEffect, useRef } from 'react';
import {
  FLOATING_PANEL_DODGE_MARGIN,
  FLOATING_PANEL_MIN_HEIGHT,
  type FloatingPanelGeometry,
} from '../../constants/floating-panel';
import { getVisibleModalRects } from '../../interactive-engine';

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

function expandRect(r: Rect, margin: number): Rect {
  return {
    left: r.left - margin,
    top: r.top - margin,
    right: r.right + margin,
    bottom: r.bottom + margin,
    width: r.width + margin * 2,
    height: r.height + margin * 2,
  };
}

/**
 * Find the best corner position where the panel clears every obstacle.
 * Obstacles are tested individually (not as a union) so free space between
 * far-apart obstacles remains usable. Returns null if no corner clears.
 */
function findDodgePosition(
  panelWidth: number,
  panelHeight: number,
  obstacles: Rect[],
  margin: number
): { x: number; y: number } | null {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const expanded = obstacles.map((o) => expandRect(o, margin));

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

    if (expanded.every((o) => !rectsOverlap(panelRect, o))) {
      return pos;
    }
  }

  return null;
}

function toRect(r: DOMRect): Rect {
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
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
        for (const r of getVisibleModalRects()) {
          obstacles.push(toRect(r));
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

      const panelRect: Rect = {
        left: geo.x,
        top: geo.y,
        right: geo.x + geo.width,
        bottom: geo.y + geo.height,
        width: geo.width,
        height: geo.height,
      };

      if (!obstacles.some((o) => rectsOverlap(panelRect, o))) {
        return;
      }

      if (!previousPositionRef.current) {
        previousPositionRef.current = { x: geo.x, y: geo.y };
      }

      const dodgePos = findDodgePosition(geo.width, geo.height, obstacles, FLOATING_PANEL_DODGE_MARGIN);

      if (dodgePos) {
        document.dispatchEvent(
          new CustomEvent('pathfinder-floating-dodge', {
            detail: dodgePos,
          })
        );
        return;
      }

      // No corner fits the full panel: compact, and if a corner can hold the
      // compacted panel (min height as its best-known lower bound), move there
      // too — compacting in place alone often uncovers nothing.
      document.dispatchEvent(new CustomEvent('pathfinder-floating-compact'));
      const compactPos = findDodgePosition(geo.width, FLOATING_PANEL_MIN_HEIGHT, obstacles, FLOATING_PANEL_DODGE_MARGIN);
      if (compactPos) {
        document.dispatchEvent(
          new CustomEvent('pathfinder-floating-dodge', {
            detail: compactPos,
          })
        );
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

    // A manual drag while a dodge is active overrides the saved position:
    // restoring would otherwise teleport the panel to a stale pre-dodge spot,
    // discarding the user's placement.
    const handleManualMove = (e: Event) => {
      if (previousPositionRef.current) {
        previousPositionRef.current = (e as CustomEvent<{ x: number; y: number }>).detail;
      }
    };

    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('pathfinder-modal-state-changed', handleModalStateChange);
    document.addEventListener('pathfinder-floating-manual-move', handleManualMove);
    checkAndDodge();

    return () => {
      observer.disconnect();
      document.removeEventListener('pathfinder-modal-state-changed', handleModalStateChange);
      document.removeEventListener('pathfinder-floating-manual-move', handleManualMove);
      previousPositionRef.current = null;
    };
  }, [isMinimized]); // Stable deps — geometry read from ref
}
