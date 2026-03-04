/**
 * Storage Keys Constants
 *
 * This module contains the localStorage/sessionStorage key constants used by the plugin.
 * It's separated from user-storage.ts to allow importing keys without browser dependencies
 * (e.g., in Playwright E2E tests that need to inject localStorage values).
 *
 * The main user-storage.ts re-exports these keys for backward compatibility.
 */

export const StorageKeys = {
  JOURNEY_COMPLETION: 'grafana-pathfinder-app-journey-completion',
  INTERACTIVE_COMPLETION: 'grafana-pathfinder-app-interactive-completion', // Stores completion percentage by contentKey
  TABS: 'grafana-pathfinder-app-tabs',
  ACTIVE_TAB: 'grafana-pathfinder-app-active-tab',
  INTERACTIVE_STEPS_PREFIX: 'grafana-pathfinder-app-interactive-steps-', // Dynamic: grafana-pathfinder-app-interactive-steps-{contentKey}-{sectionId}
  WYSIWYG_PREVIEW: 'grafana-pathfinder-app-wysiwyg-preview', // HTML content for editor persistence
  WYSIWYG_PREVIEW_JSON: 'grafana-pathfinder-app-wysiwyg-preview-json', // JSON content for test preview
  E2E_TEST_GUIDE: 'grafana-pathfinder-app-e2e-test-guide', // JSON content for E2E test runner
  SECTION_COLLAPSE_PREFIX: 'grafana-pathfinder-app-section-collapse-', // Dynamic: grafana-pathfinder-app-section-collapse-{contentKey}-{sectionId}
  // Full screen mode persistence (for page refreshes during recording)
  FULLSCREEN_MODE_STATE: 'grafana-pathfinder-app-fullscreen-mode-state',
  FULLSCREEN_BUNDLED_STEPS: 'grafana-pathfinder-app-fullscreen-bundled-steps',
  FULLSCREEN_BUNDLING_ACTION: 'grafana-pathfinder-app-fullscreen-bundling-action',
  FULLSCREEN_SECTION_INFO: 'grafana-pathfinder-app-fullscreen-section-info',
  // Learning journey milestone completion (per-milestone tracking for URL-based paths)
  MILESTONE_COMPLETION: 'grafana-pathfinder-app-milestone-completion',
  // Learning paths and badges progress
  LEARNING_PROGRESS: 'grafana-pathfinder-app-learning-progress',
  // Guide responses from input blocks (user-entered values for variables)
  GUIDE_RESPONSES: 'grafana-pathfinder-app-guide-responses',
  // Experiment auto-open state (Grafana user storage key)
  EXPERIMENT_AUTO_OPEN: 'grafana-pathfinder-app-experiment-auto-open',
  // Experiment session storage key prefixes (used with hostname suffix)
  // These are sessionStorage keys, not Grafana user storage
  EXPERIMENT_SESSION_AUTO_OPENED_PREFIX: 'grafana-interactive-learning-panel-auto-opened-',
  EXPERIMENT_TREATMENT_PAGE_PREFIX: 'grafana-pathfinder-treatment-page-',
  EXPERIMENT_RESET_PROCESSED_PREFIX: 'grafana-pathfinder-pop-open-reset-processed-',
} as const;

export type StorageKeyName = keyof typeof StorageKeys;
export type StorageKeyValue = (typeof StorageKeys)[StorageKeyName];
