/**
 * E2E Test Constants
 *
 * Centralized timeout values and configuration for Playwright tests.
 * These values are tuned for reliability across CI and local environments.
 */

/**
 * Standard timeout values for E2E tests.
 * All values in milliseconds.
 */
export const TIMEOUTS = {
  /** Time for Grafana UI to become interactive (30s) */
  UI_READY: 30_000,
  /** Time for modals to appear (10s) */
  MODAL_VISIBLE: 10_000,
  /** Time for dev mode settings to propagate (15s) */
  DEV_MODE_PROPAGATE: 15_000,
  /** Time for auto-save to complete (5s) */
  AUTO_SAVE: 5_000,
} as const;

/**
 * localStorage keys used by the block editor
 */
export const STORAGE_KEYS = {
  /** Block editor state persistence key */
  BLOCK_EDITOR_STATE: 'pathfinder-block-editor-state',
} as const;
