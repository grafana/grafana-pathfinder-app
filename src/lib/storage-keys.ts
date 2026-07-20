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
  SECTION_ACKNOWLEDGED_PREFIX: 'grafana-pathfinder-app-section-acknowledged-', // Dynamic: grafana-pathfinder-app-section-acknowledged-{contentKey}-{sectionId} (issue #842 gate)
  SECTION_DONE_PREFIX: 'grafana-pathfinder-app-section-done-', // Dynamic: grafana-pathfinder-app-section-done-{contentKey}-{sectionId} (mount-free `section-completed:` check)
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
  // Persistent dedup for experiment exposure events. Used with `{hostname}:{flagKey}:{variant}`
  // suffix so the analytics event fires at most once per arm assignment per browser. Variant
  // reassignment (e.g. control → treatment) yields a new key and re-fires, which is what
  // downstream A/B tools expect.
  EXPERIMENT_EXPOSURE_REPORTED_PREFIX: 'grafana-pathfinder-experiment-exposure-reported-',
  // Highlighted-guide experiment markers (used with hostname + guideId suffix). LocalStorage,
  // not session — auto-open fires once per browser, not once per session.
  HIGHLIGHTED_GUIDE_AUTO_OPEN_PREFIX: 'grafana-pathfinder-highlighted-guide-auto-open-',
  HIGHLIGHTED_GUIDE_RESET_PROCESSED_PREFIX: 'grafana-pathfinder-highlighted-guide-reset-processed-',
  // Dev/debug feature-flag overrides (localStorage). Read before the MTFF client.
  FLAG_OVERRIDES: 'grafana-pathfinder-flag-overrides',
  // External app suggestions for the featured zone (sessionStorage)
  SUGGESTIONS: 'grafana-pathfinder-app-suggestions',
  // Recommended list scroll position, restored on return from a guide (sessionStorage)
  RECOMMENDATIONS_SCROLL_POSITION: 'grafana-pathfinder-app-recommendations-scroll-position',
  // Floating panel mode preference (sidebar vs floating)
  PANEL_MODE: 'grafana-pathfinder-app-panel-mode',
  // Floating panel position and size
  FLOATING_PANEL_GEOMETRY: 'grafana-pathfinder-app-floating-panel-geometry',

  // ==========================================================================
  // Block editor (centralized here from block-editor/constants.ts and the
  // block-editor UI components, which re-export / reference these values).
  // ==========================================================================
  BLOCK_EDITOR_STATE: 'pathfinder-block-editor-state',
  BLOCK_EDITOR_RECORDING_STATE: 'pathfinder-block-editor-recording-state',
  BLOCK_EDITOR_BACKEND_TRACKING: 'pathfinder-block-editor-backend-tracking',
  BLOCK_EDITOR_HEALTH_PANEL_OPEN: 'pathfinder.blockEditor.healthPanel.open',
  BLOCK_EDITOR_CONDITION_RAW_MODE: 'pathfinder.blockEditor.conditionField.rawMode',

  // ==========================================================================
  // Coda terminal (centralized from integrations/coda/terminal-storage.ts).
  // is-open / height are localStorage; the rest are sessionStorage.
  // ==========================================================================
  CODA_TERMINAL_IS_OPEN: 'pathfinder-coda-terminal-is-open',
  CODA_TERMINAL_HEIGHT: 'pathfinder-coda-terminal-height',
  CODA_TERMINAL_WAS_CONNECTED: 'pathfinder-coda-terminal-was-connected',
  CODA_TERMINAL_SCROLLBACK: 'pathfinder-coda-terminal-scrollback',
  CODA_TERMINAL_LAST_VM_OPTS: 'pathfinder-coda-terminal-last-vm-opts',

  // ==========================================================================
  // Assistant customization. Dynamic key: `{PREFIX}{contentKey}-{assistantId}`.
  // Use `buildAssistantStorageKey()` rather than concatenating inline.
  // ==========================================================================
  ASSISTANT_CUSTOMIZATION_PREFIX: 'pathfinder-assistant-',

  // ==========================================================================
  // Devtools (dev-only panels: PR tester, URL tester, debug panel expansion).
  // ==========================================================================
  DEVTOOLS_PR_TESTER_URL: 'pathfinder-pr-tester-url',
  DEVTOOLS_PR_TESTER_SELECTED_FILE: 'pathfinder-pr-tester-selected',
  DEVTOOLS_PR_TESTER_SELECTED_PATH: 'pathfinder-pr-tester-selected-path',
  DEVTOOLS_PR_TESTER_MODE: 'pathfinder-pr-tester-mode',
  DEVTOOLS_PR_TESTER_FETCHED_FILES: 'pathfinder-pr-tester-files',
  DEVTOOLS_PR_TESTER_FETCHED_URL: 'pathfinder-pr-tester-fetched-url',
  DEVTOOLS_URL_TESTER_URL: 'pathfinder-url-tester-url',
  DEVTOOLS_PR_TESTER_EXPANDED: 'pathfinder-devtools-pr-tester-expanded',
  DEVTOOLS_URL_TESTER_EXPANDED: 'pathfinder-devtools-url-tester-expanded',
} as const;

export type StorageKeyName = keyof typeof StorageKeys;
export type StorageKeyValue = (typeof StorageKeys)[StorageKeyName];

/**
 * Builds the dynamic localStorage key used to persist a user's assistant-block
 * customization. Centralized so the key shape lives in exactly one place.
 */
export function buildAssistantStorageKey(contentKey: string, assistantId: string): string {
  return `${StorageKeys.ASSISTANT_CUSTOMIZATION_PREFIX}${contentKey}-${assistantId}`;
}
