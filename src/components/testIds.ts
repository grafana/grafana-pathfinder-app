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

  // WYSIWYG Preview Banner
  wysiwygPreview: {
    banner: 'wysiwyg-preview-banner',
    modeIndicator: 'wysiwyg-preview-mode-indicator',
    returnToEditorButton: 'wysiwyg-preview-return-to-editor',
  },

  // WYSIWYG Editor
  wysiwygEditor: {
    // Main container
    container: 'wysiwyg-editor-container',
    editorContent: 'wysiwyg-editor-content',

    // Toolbar
    toolbar: {
      container: 'wysiwyg-toolbar',
      undoButton: 'wysiwyg-toolbar-undo',
      redoButton: 'wysiwyg-toolbar-redo',
      styleDropdown: 'wysiwyg-toolbar-style-dropdown',
      boldButton: 'wysiwyg-toolbar-bold',
      codeButton: 'wysiwyg-toolbar-code',
      bulletListButton: 'wysiwyg-toolbar-bullet-list',
      orderedListButton: 'wysiwyg-toolbar-ordered-list',
      addActionButton: 'wysiwyg-toolbar-add-action',
      addSectionButton: 'wysiwyg-toolbar-add-section',
      addCommentButton: 'wysiwyg-toolbar-add-comment',
      fullScreenButton: 'wysiwyg-toolbar-fullscreen',
      clearFormattingButton: 'wysiwyg-toolbar-clear-formatting',
      copyButton: 'wysiwyg-toolbar-copy',
      downloadButton: 'wysiwyg-toolbar-download',
      testButton: 'wysiwyg-toolbar-test',
      resetButton: 'wysiwyg-toolbar-reset',
    },

    // Bubble menu (floating selection toolbar)
    bubbleMenu: {
      container: 'wysiwyg-bubble-menu',
      boldButton: 'wysiwyg-bubble-bold',
      codeButton: 'wysiwyg-bubble-code',
      linkButton: 'wysiwyg-bubble-link',
      clearButton: 'wysiwyg-bubble-clear',
    },

    // Link dialog
    linkDialog: {
      modal: 'wysiwyg-link-dialog',
      urlInput: 'wysiwyg-link-url-input',
      applyButton: 'wysiwyg-link-apply',
      removeButton: 'wysiwyg-link-remove',
      cancelButton: 'wysiwyg-link-cancel',
    },

    // Comment dialog
    commentDialog: {
      modal: 'wysiwyg-comment-dialog',
      textArea: 'wysiwyg-comment-textarea',
      insertButton: 'wysiwyg-comment-insert',
      cancelButton: 'wysiwyg-comment-cancel',
    },

    // Export dialog
    exportDialog: {
      modal: 'wysiwyg-export-dialog',
      titleInput: 'wysiwyg-export-title',
      idInput: 'wysiwyg-export-id',
      exportButton: 'wysiwyg-export-confirm',
      cancelButton: 'wysiwyg-export-cancel',
    },

    // Form panel (action editor)
    formPanel: {
      container: 'wysiwyg-form-panel',
      title: 'wysiwyg-form-title',
      actionSelector: 'wysiwyg-action-selector',
      actionCard: (actionType: string) => `wysiwyg-action-card-${actionType}`,
      selectorInput: 'wysiwyg-form-selector-input',
      selectorCaptureButton: 'wysiwyg-form-selector-capture',
      descriptionInput: 'wysiwyg-form-description',
      requirementsInput: 'wysiwyg-form-requirements',
      applyButton: 'wysiwyg-form-apply',
      cancelButton: 'wysiwyg-form-cancel',
      switchTypeButton: 'wysiwyg-form-switch-type',
    },

    // Full screen mode
    fullScreen: {
      overlay: 'wysiwyg-fullscreen-overlay',
      domPathTooltip: 'wysiwyg-fullscreen-tooltip',
      stepEditor: {
        modal: 'wysiwyg-step-editor',
        selectorDisplay: 'wysiwyg-step-selector',
        actionTypeSelect: 'wysiwyg-step-action-type',
        descriptionInput: 'wysiwyg-step-description',
        requirementsInput: 'wysiwyg-step-requirements',
        commentInput: 'wysiwyg-step-comment',
        sectionSelect: 'wysiwyg-step-section',
        skipButton: 'wysiwyg-step-skip',
        cancelButton: 'wysiwyg-step-cancel',
        saveButton: 'wysiwyg-step-save',
      },
      bundlingIndicator: 'wysiwyg-bundling-indicator',
      bundlingStepEditor: {
        modal: 'wysiwyg-bundling-step-editor',
        commentInput: 'wysiwyg-bundling-comment',
        requirementsInput: 'wysiwyg-bundling-requirements',
        saveButton: 'wysiwyg-bundling-save',
        skipButton: 'wysiwyg-bundling-skip',
        cancelButton: 'wysiwyg-bundling-cancel',
      },
      minimizedSidebar: {
        container: 'wysiwyg-minimized-sidebar',
        button: 'wysiwyg-minimized-button',
        badge: 'wysiwyg-minimized-badge',
      },
    },
  },

  // interactive guide Elements
  interactive: {
    section: (sectionId: string) => `interactive-section-${sectionId}`,
    step: (stepId: string) => `interactive-step-${stepId}`,
    showMeButton: (stepId: string) => `interactive-show-me-${stepId}`,
    doItButton: (stepId: string) => `interactive-do-it-${stepId}`,
    skipButton: (stepId: string) => `interactive-skip-${stepId}`,
    redoButton: (stepId: string) => `interactive-redo-${stepId}`,
    doSectionButton: (sectionId: string) => `interactive-do-section-${sectionId}`,
    resetSectionButton: (sectionId: string) => `interactive-reset-section-${sectionId}`,
    requirementCheck: (requirementId: string) => `interactive-requirement-${requirementId}`,
    requirementFixButton: (stepId: string) => `interactive-requirement-fix-${stepId}`,
    requirementRetryButton: (stepId: string) => `interactive-requirement-retry-${stepId}`,
    requirementSkipButton: (stepId: string) => `interactive-requirement-skip-${stepId}`,
    stepCompleted: (stepId: string) => `interactive-step-completed-${stepId}`,
    errorMessage: (stepId: string) => `interactive-error-${stepId}`,
    quiz: (quizId: string) => `interactive-quiz-${quizId}`,
    quizChoice: (quizId: string, choiceId: string) => `interactive-quiz-${quizId}-choice-${choiceId}`,
    quizCheckButton: (quizId: string) => `interactive-quiz-check-${quizId}`,
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
