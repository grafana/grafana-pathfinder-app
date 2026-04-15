import { useCallback, useRef, useState } from 'react';
import { panelModeManager } from '../../global-state/panel-mode';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import {
  type FloatingPanelGeometry,
  FLOATING_PANEL_MIN_WIDTH,
  FLOATING_PANEL_MIN_HEIGHT,
  FLOATING_PANEL_MAX_WIDTH,
  FLOATING_PANEL_MAX_HEIGHT,
} from '../../constants/floating-panel';

/** Clamp a value between min and max inclusive. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Clamp position so the panel stays within the viewport. */
function clampToViewport(x: number, y: number, width: number, height: number): { x: number; y: number } {
  return {
    x: clamp(x, 0, window.innerWidth - width),
    y: clamp(y, 0, window.innerHeight - height),
  };
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
    dragStartRef.current = null;
    setGeometry((prev) => {
      panelModeManager.setPanelGeometry(prev);
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

/**
 * Hook for resizing the floating panel via a corner handle.
 *
 * Enforces min/max dimension constraints from constants.
 * Persists final geometry to PanelModeManager on release.
 */
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
      const dx = e.clientX - resizeStartRef.current.startX;
      const dy = e.clientY - resizeStartRef.current.startY;
      const newWidth = clamp(
        resizeStartRef.current.originWidth + dx,
        FLOATING_PANEL_MIN_WIDTH,
        FLOATING_PANEL_MAX_WIDTH
      );
      const newHeight = clamp(
        resizeStartRef.current.originHeight + dy,
        FLOATING_PANEL_MIN_HEIGHT,
        FLOATING_PANEL_MAX_HEIGHT
      );
      setGeometry((prev) => ({ ...prev, width: newWidth, height: newHeight }));
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
  const [geometry, setGeometry] = useState<FloatingPanelGeometry>(() => panelModeManager.getPanelGeometry());

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
