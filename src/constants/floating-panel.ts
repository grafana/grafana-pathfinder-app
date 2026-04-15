/**
 * Constants for the floating panel mode.
 *
 * The floating panel is an alternative to the sidebar that renders guide content
 * in a draggable, resizable overlay. These constants define its size constraints
 * and default geometry.
 */

/** Minimum panel dimensions (pixels) */
export const FLOATING_PANEL_MIN_WIDTH = 320;
export const FLOATING_PANEL_MIN_HEIGHT = 280;

/** Maximum panel dimensions (pixels) */
export const FLOATING_PANEL_MAX_WIDTH = 600;
export const FLOATING_PANEL_MAX_HEIGHT = 700;

/** Default panel dimensions (pixels) */
export const FLOATING_PANEL_DEFAULT_WIDTH = 400;
export const FLOATING_PANEL_DEFAULT_HEIGHT = 400;

/** Margin from viewport edge when computing default position (pixels) */
export const FLOATING_PANEL_EDGE_MARGIN = 20;

/** Clearance margin for highlight dodge repositioning (pixels) */
export const FLOATING_PANEL_DODGE_MARGIN = 32;

export interface FloatingPanelGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Compute default position: bottom-right corner with edge margin */
export function getDefaultFloatingPanelGeometry(): FloatingPanelGeometry {
  return {
    x: window.innerWidth - FLOATING_PANEL_DEFAULT_WIDTH - FLOATING_PANEL_EDGE_MARGIN,
    y: window.innerHeight - FLOATING_PANEL_DEFAULT_HEIGHT - FLOATING_PANEL_EDGE_MARGIN,
    width: FLOATING_PANEL_DEFAULT_WIDTH,
    height: FLOATING_PANEL_DEFAULT_HEIGHT,
  };
}
