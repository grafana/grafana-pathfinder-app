/**
 * Centralized test identifiers for e2e testing.
 *
 * These IDs provide stable selectors for Playwright tests and conform to
 * Grafana plugin e2e testing best practices.
 *
 * @see https://grafana.com/developers/plugin-tools/e2e-test-a-plugin/selecting-elements
 *
 * Naming Convention:
 * - Use kebab-case (lowercase with hyphens)
 * - Prefix with component/feature name (e.g., "docs-panel-", "config-")
 * - Be descriptive but concise
 * - Group related elements under a namespace
 *
 * @example
 * ```typescript
 * // In tests:
 * await page.getByTestId(testIds.docsPanel.container).click();
 *
 * // In components:
 * <div data-testid={testIds.docsPanel.container}>...</div>
 * ```
 */
export const testIds = {
  // Docs Panel - Main container and shell elements
  docsPanel: {
    container: 'docs-panel-container',
    headerBar: 'docs-panel-header-bar',
    settingsButton: 'docs-panel-settings-button',
    closeButton: 'docs-panel-close-button',
    tabBar: 'docs-panel-tab-bar',
    tabList: 'docs-panel-tab-list',
    tab: (tabId: string) => `docs-panel-tab-${tabId}`,
    tabCloseButton: (tabId: string) => `docs-panel-tab-close-${tabId}`,
    tabOverflowButton: 'docs-panel-tab-overflow-button',
    tabDropdown: 'docs-panel-tab-dropdown',
    tabDropdownItem: (tabId: string) => `docs-panel-tab-dropdown-item-${tabId}`,
    content: 'docs-panel-content',
    recommendationsTab: 'docs-panel-tab-recommendations',
    loadingState: 'docs-panel-loading-state',
    errorState: 'docs-panel-error-state',
  },

  // Context Panel - Recommendations and content
  contextPanel: {
    container: 'context-panel-container',
    heading: 'context-panel-heading',
    recommendationsContainer: 'context-panel-recommendations-container',
    recommendationsGrid: 'context-panel-recommendations-grid',
    recommendationCard: (index: number) => `context-panel-recommendation-card-${index}`,
    recommendationTitle: (index: number) => `context-panel-recommendation-title-${index}`,
    recommendationStartButton: (index: number) => `context-panel-recommendation-start-${index}`,
    recommendationSummaryButton: (index: number) => `context-panel-recommendation-summary-${index}`,
    recommendationSummaryContent: (index: number) => `context-panel-recommendation-summary-content-${index}`,
    recommendationMilestones: (index: number) => `context-panel-recommendation-milestones-${index}`,
    recommendationMilestoneItem: (index: number, milestoneIndex: number) =>
      `context-panel-recommendation-milestone-${index}-${milestoneIndex}`,
    otherDocsSection: 'context-panel-other-docs-section',
    otherDocsToggle: 'context-panel-other-docs-toggle',
    otherDocsList: 'context-panel-other-docs-list',
    otherDocItem: (index: number) => `context-panel-other-doc-item-${index}`,
    emptyState: 'context-panel-empty-state',
    errorAlert: 'context-panel-error-alert',
  },

  // Interactive Tutorial Elements
  interactive: {
    section: (sectionId: string) => `interactive-section-${sectionId}`,
    step: (stepId: string) => `interactive-step-${stepId}`,
    showMeButton: (stepId: string) => `interactive-show-me-${stepId}`,
    doItButton: (stepId: string) => `interactive-do-it-${stepId}`,
    doSectionButton: (sectionId: string) => `interactive-do-section-${sectionId}`,
    requirementCheck: (requirementId: string) => `interactive-requirement-${requirementId}`,
    stepCompleted: (stepId: string) => `interactive-step-completed-${stepId}`,
  },

  // App Configuration
  appConfig: {
    recommenderServiceUrl: 'config-recommender-service-url',
    tutorialUrl: 'config-tutorial-url',
    submit: 'config-submit',
    // Legacy fields for backward compatibility
    apiKey: 'config-api-key',
    apiUrl: 'config-api-url',
    // Interactive Features
    interactiveFeatures: {
      toggle: 'config-interactive-auto-detection-toggle',
      debounce: 'config-interactive-debounce-input',
      requirementsTimeout: 'config-interactive-requirements-timeout',
      guidedTimeout: 'config-interactive-guided-timeout',
      reset: 'config-interactive-reset-defaults',
      submit: 'config-interactive-submit',
    },
  },

  // Terms and Conditions
  termsAndConditions: {
    toggle: 'terms-recommender-toggle',
    submit: 'terms-submit',
    termsContent: 'terms-content',
  },
};
