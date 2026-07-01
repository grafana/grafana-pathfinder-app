/**
 * Contract / stability test for the centralized storage key registry.
 *
 * These exact string values are a load-bearing contract: Playwright E2E tests
 * inject localStorage by key, `experiment-debug` sweeps by prefix, and existing
 * user data in the wild is addressed by these strings. A rename is a silent,
 * data-orphaning breaking change — this test makes any change to a key VALUE
 * fail loudly so it must be a deliberate, reviewed decision (with a migration).
 *
 * When ADDING a new key, add it here too. When CHANGING an existing value, stop
 * and consider the migration implications before updating this test.
 */
import { StorageKeys, buildAssistantStorageKey } from './storage-keys';

describe('StorageKeys — stable string contract', () => {
  it('matches the locked key values exactly', () => {
    expect(StorageKeys).toEqual({
      // Core learner / progress state
      JOURNEY_COMPLETION: 'grafana-pathfinder-app-journey-completion',
      INTERACTIVE_COMPLETION: 'grafana-pathfinder-app-interactive-completion',
      TABS: 'grafana-pathfinder-app-tabs',
      ACTIVE_TAB: 'grafana-pathfinder-app-active-tab',
      INTERACTIVE_STEPS_PREFIX: 'grafana-pathfinder-app-interactive-steps-',
      WYSIWYG_PREVIEW: 'grafana-pathfinder-app-wysiwyg-preview',
      WYSIWYG_PREVIEW_JSON: 'grafana-pathfinder-app-wysiwyg-preview-json',
      E2E_TEST_GUIDE: 'grafana-pathfinder-app-e2e-test-guide',
      SECTION_COLLAPSE_PREFIX: 'grafana-pathfinder-app-section-collapse-',
      SECTION_ACKNOWLEDGED_PREFIX: 'grafana-pathfinder-app-section-acknowledged-',
      SECTION_DONE_PREFIX: 'grafana-pathfinder-app-section-done-',
      FULLSCREEN_MODE_STATE: 'grafana-pathfinder-app-fullscreen-mode-state',
      FULLSCREEN_BUNDLED_STEPS: 'grafana-pathfinder-app-fullscreen-bundled-steps',
      FULLSCREEN_BUNDLING_ACTION: 'grafana-pathfinder-app-fullscreen-bundling-action',
      FULLSCREEN_SECTION_INFO: 'grafana-pathfinder-app-fullscreen-section-info',
      MILESTONE_COMPLETION: 'grafana-pathfinder-app-milestone-completion',
      LEARNING_PROGRESS: 'grafana-pathfinder-app-learning-progress',
      GUIDE_RESPONSES: 'grafana-pathfinder-app-guide-responses',

      // Experiment / feature-flag state
      EXPERIMENT_EXPOSURE_REPORTED_PREFIX: 'grafana-pathfinder-experiment-exposure-reported-',
      HIGHLIGHTED_GUIDE_AUTO_OPEN_PREFIX: 'grafana-pathfinder-highlighted-guide-auto-open-',
      HIGHLIGHTED_GUIDE_RESET_PROCESSED_PREFIX: 'grafana-pathfinder-highlighted-guide-reset-processed-',
      FLAG_OVERRIDES: 'grafana-pathfinder-flag-overrides',

      // UI / panel state
      SUGGESTIONS: 'grafana-pathfinder-app-suggestions',
      PANEL_MODE: 'grafana-pathfinder-app-panel-mode',
      FLOATING_PANEL_GEOMETRY: 'grafana-pathfinder-app-floating-panel-geometry',

      // Block editor (centralized from block-editor/constants.ts + UI prefs)
      BLOCK_EDITOR_STATE: 'pathfinder-block-editor-state',
      BLOCK_EDITOR_RECORDING_STATE: 'pathfinder-block-editor-recording-state',
      BLOCK_EDITOR_BACKEND_TRACKING: 'pathfinder-block-editor-backend-tracking',
      BLOCK_EDITOR_HEALTH_PANEL_OPEN: 'pathfinder.blockEditor.healthPanel.open',
      BLOCK_EDITOR_CONDITION_RAW_MODE: 'pathfinder.blockEditor.conditionField.rawMode',

      // Coda terminal (centralized from integrations/coda/terminal-storage.ts)
      CODA_TERMINAL_IS_OPEN: 'pathfinder-coda-terminal-is-open',
      CODA_TERMINAL_HEIGHT: 'pathfinder-coda-terminal-height',
      CODA_TERMINAL_WAS_CONNECTED: 'pathfinder-coda-terminal-was-connected',
      CODA_TERMINAL_SCROLLBACK: 'pathfinder-coda-terminal-scrollback',
      CODA_TERMINAL_LAST_VM_OPTS: 'pathfinder-coda-terminal-last-vm-opts',

      // Assistant customization (dynamic suffix: `{contentKey}-{assistantId}`)
      ASSISTANT_CUSTOMIZATION_PREFIX: 'pathfinder-assistant-',

      // Devtools (dev-only panels)
      DEVTOOLS_PR_TESTER_URL: 'pathfinder-pr-tester-url',
      DEVTOOLS_PR_TESTER_SELECTED_FILE: 'pathfinder-pr-tester-selected',
      DEVTOOLS_PR_TESTER_SELECTED_PATH: 'pathfinder-pr-tester-selected-path',
      DEVTOOLS_PR_TESTER_MODE: 'pathfinder-pr-tester-mode',
      DEVTOOLS_PR_TESTER_FETCHED_FILES: 'pathfinder-pr-tester-files',
      DEVTOOLS_PR_TESTER_FETCHED_URL: 'pathfinder-pr-tester-fetched-url',
      DEVTOOLS_URL_TESTER_URL: 'pathfinder-url-tester-url',
      DEVTOOLS_PR_TESTER_EXPANDED: 'pathfinder-devtools-pr-tester-expanded',
      DEVTOOLS_URL_TESTER_EXPANDED: 'pathfinder-devtools-url-tester-expanded',
    });
  });

  it('builds the assistant customization key from the prefix', () => {
    expect(buildAssistantStorageKey('my-content', 'asst-1')).toBe('pathfinder-assistant-my-content-asst-1');
  });
});
