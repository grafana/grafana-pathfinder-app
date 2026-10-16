import { useCallback, useEffect, useRef, useState } from 'react';
import { panelModeManager } from '../../global-state/panel-mode';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import { FloatingPanelEvents } from '../../lib/event-names';
import {
  type FloatingPanelGeometry,
  FLOATING_PANEL_MIN_WIDTH,
  FLOATING_PANEL_MIN_HEIGHT,
} from '../../constants/floating-panel';

/** Clamp a value between min and max inclusive. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getViewportSize(): { width: number; height: number } {
  return {
    width: document.documentElement.clientWidth || window.innerWidth,
    height: document.documentElement.clientHeight || window.innerHeight,
  };
}

function clampToViewport(x: number, y: number, width: number, height: number): { x: number; y: number } {
  const viewport = getViewportSize();
  return {
    x: Math.max(0, clamp(x, 0, viewport.width - width)),
    y: Math.max(0, clamp(y, 0, viewport.height - height)),
  };
}

// Automatic clamps must not overwrite the user's preferred geometry.
function clampGeometryToViewport(g: FloatingPanelGeometry): FloatingPanelGeometry {
  const viewport = getViewportSize();
  const width = Math.min(g.width, viewport.width);
  const height = Math.min(g.height, viewport.height);
  const { x, y } = clampToViewport(g.x, g.y, width, height);
  return { ...g, x, y, width, height };
}

/**
 * Hook for dragging the floating panel by its header.
 *
 * Uses pointer capture for smooth cross-element tracking.
 * Persists final position to PanelModeManager on release.
 */
function useDrag(
  geometry: FloatingPanelGeometry,
  setGeometry: React.Dispatch<React.SetStateAction<FloatingPanelGeometry>>
) {
  const dragStartRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Only primary button
      if (e.button !== 0) {
        return;
      }
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragStartRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        originX: geometry.x,
        originY: geometry.y,
      };
    },
    [geometry.x, geometry.y]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragStartRef.current) {
        return;
      }
      const dx = e.clientX - dragStartRef.current.startX;
      const dy = e.clientY - dragStartRef.current.startY;
      const rawX = dragStartRef.current.originX + dx;
      const rawY = dragStartRef.current.originY + dy;
      const clamped = clampToViewport(rawX, rawY, geometry.width, geometry.height);
      setGeometry((prev) => ({ ...prev, x: clamped.x, y: clamped.y }));
    },
    [geometry.width, geometry.height, setGeometry]
  );

  const onPointerUp = useCallback(() => {
    if (!dragStartRef.current) {
      return;
    }
    const { originX, originY } = dragStartRef.current;
    dragStartRef.current = null;
    setGeometry((prev) => {
      panelModeManager.setPanelGeometry(prev);
      if (prev.x !== originX || prev.y !== originY) {
        document.dispatchEvent(new CustomEvent(FloatingPanelEvents.ManualMove, { detail: { x: prev.x, y: prev.y } }));
      }
      reportAppInteraction(UserInteraction.FloatingPanelMoved, {
        trigger: 'manual_drag',
        x: prev.x,
        y: prev.y,
      });
      return prev;
    });
  }, [setGeometry]);

  return { onPointerDown, onPointerMove, onPointerUp };
}

function useResize(
  geometry: FloatingPanelGeometry,
  setGeometry: React.Dispatch<React.SetStateAction<FloatingPanelGeometry>>
) {
  const resizeStartRef = useRef<{
    startX: number;
    startY: number;
    originWidth: number;
    originHeight: number;
  } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      resizeStartRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        originWidth: geometry.width,
        originHeight: geometry.height,
      };
    },
    [geometry.width, geometry.height]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!resizeStartRef.current) {
        return;
      }
      const { startX, startY, originWidth, originHeight } = resizeStartRef.current;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const viewport = getViewportSize();
      setGeometry((prev) => ({
        ...prev,
        width: clamp(originWidth + dx, FLOATING_PANEL_MIN_WIDTH, viewport.width - prev.x),
        height: clamp(originHeight + dy, FLOATING_PANEL_MIN_HEIGHT, viewport.height - prev.y),
      }));
    },
    [setGeometry]
  );

  const onPointerUp = useCallback(() => {
    if (!resizeStartRef.current) {
      return;
    }
    resizeStartRef.current = null;
    setGeometry((prev) => {
      panelModeManager.setPanelGeometry(prev);
      return prev;
    });
  }, [setGeometry]);

  return { onPointerDown, onPointerMove, onPointerUp };
}

/**
 * Combined hook that manages floating panel geometry state,
 * initializing from persisted values and exposing drag + resize handlers.
 */
export function useDragResize() {
  // Initial geometry is the persisted user preference clamped to the
  // current viewport — a position saved on a 30" monitor must never
  // leave the panel stranded off-screen on a 13" laptop.
  const [geometry, setGeometry] = useState<FloatingPanelGeometry>(() =>
    clampGeometryToViewport(panelModeManager.getPanelGeometry())
  );

  // Re-clamp whenever the browser is resized. We re-read from the
  // manager (the user's preferred geometry) and clamp that, rather than
  // clamping the current rendered geometry — that way, growing the
  // browser back restores the original size, instead of leaving us
  // stuck with an earlier shrink.
  useEffect(() => {
    const handler = () => {
      setGeometry(clampGeometryToViewport(panelModeManager.getPanelGeometry()));
    };
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const drag = useDrag(geometry, setGeometry);
  const resize = useResize(geometry, setGeometry);

  /** Programmatically reposition the panel (e.g. from dodge logic). */
  const setPosition = useCallback(
    (x: number, y: number) => {
      setGeometry((prev) => {
        const clamped = clampToViewport(x, y, prev.width, prev.height);
        const next = { ...prev, ...clamped };
        panelModeManager.setPanelGeometry(next);
        return next;
      });
    },
    [setGeometry]
  );

  return { geometry, setGeometry, setPosition, drag, resize };
}
