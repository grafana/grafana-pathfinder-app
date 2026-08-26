/**
 * Z-Index constants for interactive overlays and highlights.
 *
 * IMPORTANT: The interactive overlays are intentionally very high (9999+) because:
 * 1. Pathfinder runs as a Grafana plugin and needs to appear above ALL Grafana UI
 * 2. Grafana's own z-index values (modals, portals, tooltips) range up to ~2000
 * 3. Interactive highlights/comments must be visible above everything for guides to work
 * 4. These elements are appended to document.body, outside the normal stacking context
 *
 * FLOATING_PANEL is the deliberate exception — see its note below.
 */
export const INTERACTIVE_Z_INDEX = {
  /**
   * Floating panel for guide content. Unlike the other constants, this must sit
   * BELOW Grafana's overlay layer, not above it. The panel portals into the
   * shared `#grafana-portal-container`, so it becomes a stacking-context sibling
   * of every Grafana Dropdown/Menu/Tooltip/Modal — which portal at
   * `theme.zIndex.portal` (1061) and `modal` (1060) / `modalBackdrop` (1050).
   * A high value here (the old 9990) made overlays opened from within the panel —
   * the header kebab, tooltips, the editor's own modals — render *behind* it and
   * become unusable (#1439). 1045 keeps the panel above all Grafana app chrome
   * (the container is already `position: fixed; z-index: 1061`) while letting any
   * overlay it spawns stack above it.
   */
  FLOATING_PANEL: 1045,
  /** Overlay that blocks interaction with specific elements during guides */
  BLOCKING_OVERLAY: 9999,
  /** Visual highlight outline around target elements */
  HIGHLIGHT_OUTLINE: 9999,
  /** Comment boxes/tooltips that explain interactive steps */
  COMMENT_BOX: 10002,
  /** DOM path tooltip for element inspector (same as highlight to avoid stacking context issues) */
  DOM_PATH_TOOLTIP: 9999,
} as const;
