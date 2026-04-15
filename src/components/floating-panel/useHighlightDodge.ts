import { useEffect, useRef } from 'react';
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

  // Candidate positions: four corners of the viewport
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

    // Expand highlight rect by dodge margin for clearance
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

  return null; // No clear position found
}

/**
 * Hook that watches for interactive highlight overlays and auto-repositions
 * the floating panel to avoid overlapping them.
 *
 * Uses a MutationObserver on document.body to detect when highlight elements
 * are added/removed. When a highlight appears and overlaps the panel, it
 * dispatches events to reposition the panel to a clear quadrant.
 *
 * Decoupled from the interactive engine — the engine doesn't know about
 * the floating panel.
 */
export function useHighlightDodge(geometry: FloatingPanelGeometry, isMinimized: boolean) {
  const previousPositionRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (isMinimized) {
      return;
    }

    const checkAndDodge = () => {
      const highlights = document.querySelectorAll(HIGHLIGHT_SELECTOR);
      if (highlights.length === 0) {
        // No highlights — restore previous position if we dodged
        if (previousPositionRef.current) {
          document.dispatchEvent(
            new CustomEvent('pathfinder-floating-dodge', {
              detail: previousPositionRef.current,
            })
          );
          previousPositionRef.current = null;
          document.dispatchEvent(new CustomEvent('pathfinder-floating-restore-full'));
        }
        return;
      }

      // Compute union bounding rect of all highlights
      const highlightArray = Array.from(highlights);
      const rects = highlightArray.map((el) => el.getBoundingClientRect());
      const firstRect = rects[0];
      if (!firstRect) {
        return;
      }
      const union: Rect = {
        left: firstRect.left,
        top: firstRect.top,
        right: firstRect.right,
        bottom: firstRect.bottom,
        width: firstRect.width,
        height: firstRect.height,
      };
      for (let i = 1; i < rects.length; i++) {
        const r = rects[i];
        if (!r) {
          continue;
        }
        union.left = Math.min(union.left, r.left);
        union.top = Math.min(union.top, r.top);
        union.right = Math.max(union.right, r.right);
        union.bottom = Math.max(union.bottom, r.bottom);
      }
      union.width = union.right - union.left;
      union.height = union.bottom - union.top;

      // Check if current panel position overlaps the highlight
      const panelRect: Rect = {
        left: geometry.x,
        top: geometry.y,
        right: geometry.x + geometry.width,
        bottom: geometry.y + geometry.height,
        width: geometry.width,
        height: geometry.height,
      };

      if (!rectsOverlap(panelRect, union)) {
        return; // No overlap, nothing to do
      }

      // Save original position for later restoration
      if (!previousPositionRef.current) {
        previousPositionRef.current = { x: geometry.x, y: geometry.y };
      }

      const dodgePos = findDodgePosition(geometry.width, geometry.height, union, FLOATING_PANEL_DODGE_MARGIN);

      if (dodgePos) {
        document.dispatchEvent(
          new CustomEvent('pathfinder-floating-dodge', {
            detail: dodgePos,
          })
        );
      } else {
        // No clear quadrant — collapse to compact mode
        document.dispatchEvent(new CustomEvent('pathfinder-floating-compact'));
      }
    };

    // Watch for highlight elements being added/removed
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
        // Small delay to let the highlight element finish positioning
        requestAnimationFrame(checkAndDodge);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Initial check in case highlights already exist
    checkAndDodge();

    return () => {
      observer.disconnect();
      previousPositionRef.current = null;
    };
  }, [geometry.x, geometry.y, geometry.width, geometry.height, isMinimized]);
}
