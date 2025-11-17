/**
 * Z-Index constants for interactive overlays and highlights.
 *
 * IMPORTANT: These values are intentionally very high (9999+) because:
 * 1. Pathfinder runs as a Grafana plugin and needs to appear above ALL Grafana UI
 * 2. Grafana's own z-index values (modals, portals, tooltips) range up to ~2000
 * 3. Interactive highlights/comments must be visible above everything for guides to work
 * 4. These elements are appended to document.body, outside the normal stacking context
 */
export const INTERACTIVE_Z_INDEX = {
  /** Overlay that blocks interaction with specific elements during guides */
  BLOCKING_OVERLAY: 9999,
  /** Visual highlight outline around target elements */
  HIGHLIGHT_OUTLINE: 9999,
  /** Comment boxes/tooltips that explain interactive steps */
  COMMENT_BOX: 10002,
} as const;
