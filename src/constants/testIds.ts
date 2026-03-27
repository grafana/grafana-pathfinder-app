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
    closeButton: 'docs-panel-close-button',
    tabBar: 'docs-panel-tab-bar',
    tabList: 'docs-panel-tab-list',
    tab: (tabId: string) => `docs-panel-tab-${tabId}`,
    tabCloseButton: (tabId: string) => `docs-panel-tab-close-${tabId}`,
    tabOverflowButton: 'docs-panel-tab-overflow-button',
    tabDropdown: 'docs-panel-tab-dropdown',
    tabDropdownItem: (tabId: string) => `docs-panel-tab-dropdown-item-${tabId}`,
    content: 'docs-panel-content',
    myLearningTab: 'docs-panel-tab-my-learning',
    recommendationsTab: 'docs-panel-tab-recommendations',
    loadingState: 'docs-panel-loading-state',
    errorState: 'docs-panel-error-state',
    retryButton: 'docs-panel-retry-button',
  },

  // Context Panel - Recommendations and content
  contextPanel: {
    container: 'context-panel-container',
    userProfileBar: 'user-profile-bar',
    userProfileBarLoading: 'user-profile-bar-loading',
    userProfileBarNextAction: 'user-profile-bar-next-action',
    userProfileBarAllComplete: 'user-profile-bar-all-complete',
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
    customGuidesSection: 'context-panel-custom-guides-section',
    customGuidesToggle: 'context-panel-custom-guides-toggle',
    customGuidesList: 'context-panel-custom-guides-list',
    customGuideItem: (index: number) => `context-panel-custom-guide-item-${index}`,
    customGuideStartButton: (index: number) => `context-panel-custom-guide-start-${index}`,
    suggestedGuidesToggle: 'context-panel-suggested-guides-toggle',
    otherDocsSection: 'context-panel-other-docs-section',
    otherDocsToggle: 'context-panel-other-docs-toggle',
    otherDocsList: 'context-panel-other-docs-list',
    otherDocItem: (index: number) => `context-panel-other-doc-item-${index}`,
    emptyState: 'context-panel-empty-state',
    emptyStateMyLearningButton: 'context-panel-empty-state-my-learning',
    errorAlert: 'context-panel-error-alert',
    featuredSection: 'context-panel-featured-section',
    featuredCard: (index: number) => `context-panel-featured-card-${index}`,
    featuredStartButton: (index: number) => `context-panel-featured-start-${index}`,
    featuredSummaryButton: (index: number) => `context-panel-featured-summary-${index}`,
  },

  // Dev Tools / Block Editor
  devTools: {
    // Preview banner
    previewBanner: 'dev-tools-preview-banner',
    previewModeIndicator: 'dev-tools-preview-mode-indicator',
    returnToEditorButton: 'dev-tools-return-to-editor',
    // Full screen mode (used by element picker and recording)
    fullScreen: {
      domPathTooltip: 'dev-tools-fullscreen-tooltip',
      minimizedSidebar: {
        container: 'dev-tools-minimized-sidebar',
        button: 'dev-tools-minimized-button',
        badge: 'dev-tools-minimized-badge',
      },
    },
  },

  // Editor Panel (SelectorDebugPanel)
  editorPanel: {
    container: 'editor-panel-container',
    devModeHeader: 'editor-panel-dev-mode-header',
    leaveDevModeButton: 'editor-panel-leave-dev-mode',
    blockEditorSection: 'editor-panel-block-editor-section',
    prTesterSection: 'editor-panel-pr-tester-section',
    urlTesterSection: 'editor-panel-url-tester-section',
  },

  // Interactive guide elements
  interactive: {
    section: (sectionId: string) => `interactive-section-${sectionId}`,
    sectionToggle: (sectionId: string) => `interactive-section-toggle-${sectionId}`,
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
    formChecking: (stepId: string) => `interactive-form-checking-${stepId}`,
    formHintWarning: (stepId: string) => `interactive-form-hint-${stepId}`,
    quiz: (quizId: string) => `interactive-quiz-${quizId}`,
    quizChoice: (quizId: string, choiceId: string) => `interactive-quiz-${quizId}-choice-${choiceId}`,
    quizCheckButton: (quizId: string) => `interactive-quiz-check-${quizId}`,
    quizSkipButton: (quizId: string) => `interactive-quiz-skip-${quizId}`,
    conditional: (conditionalId: string) => `interactive-conditional-${conditionalId}`,
    inputField: (stepId: string) => `interactive-input-${stepId}`,
    inputSaveButton: (stepId: string) => `interactive-input-save-${stepId}`,
    inputResetButton: (stepId: string) => `interactive-input-reset-${stepId}`,
    inputSkipButton: (stepId: string) => `interactive-input-skip-${stepId}`,
    terminalStep: (stepId: string) => `interactive-terminal-${stepId}`,
    terminalConnectStep: (stepId: string) => `interactive-terminal-connect-${stepId}`,
    terminalSkipButton: (stepId: string) => `interactive-terminal-skip-${stepId}`,
    terminalCopyButton: (stepId: string) => `interactive-terminal-copy-${stepId}`,
    lazyScrollRetryButton: (stepId: string) => `interactive-lazy-retry-${stepId}`,
  },

  // Code Block Step - for inserting code into Monaco editors
  codeBlock: {
    step: (stepId: string) => `code-block-step-${stepId}`,
    showMeButton: (stepId: string) => `code-block-show-me-${stepId}`,
    insertButton: (stepId: string) => `code-block-insert-${stepId}`,
  },

  // App Configuration
  appConfig: {
    form: 'config-form',
    recommenderServiceUrl: 'config-recommender-service-url',
    tutorialUrl: 'config-tutorial-url',
    submit: 'config-submit',
    // Legacy fields for backward compatibility
    apiKey: 'config-api-key',
    apiUrl: 'config-api-url',
    devModeToggle: 'config-dev-mode-toggle',
    assistantDevModeToggle: 'config-assistant-dev-mode-toggle',
    globalLinkInterception: 'config-global-link-interception',
    openPanelOnLaunch: 'config-open-panel-on-launch',
    liveSessionsToggle: 'config-live-sessions-toggle',
    peerjsHost: 'config-peerjs-host',
    peerjsPort: 'config-peerjs-port',
    peerjsKey: 'config-peerjs-key',
    codaTerminalToggle: 'config-coda-terminal-toggle',
    codaApiUrl: 'config-coda-api-url',
    codaRelayUrl: 'config-coda-relay-url',
    codaEnrollmentKey: 'config-coda-enrollment-key',
    // Interactive Features
    interactiveFeatures: {
      toggle: 'config-interactive-auto-detection-toggle',
      debounce: 'config-interactive-debounce-input',
      requirementsTimeout: 'config-interactive-requirements-timeout',
      guidedTimeout: 'config-interactive-guided-timeout',
      disableAutoCollapse: 'config-interactive-disable-auto-collapse',
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

  // Block Editor - E2E test selectors for dev tools block editor
  blockEditor: {
    container: 'block-editor-container',
    content: 'block-editor-content',
    palette: 'block-editor-palette',
    jsonEditor: 'block-editor-json-editor',
    // Modals
    addBlockModal: 'block-editor-add-block-modal',
    blockFormModal: 'block-editor-form-modal',
    // Palette
    addBlockButton: 'block-editor-add-block-button',
    // Form controls
    submitButton: 'block-editor-submit-button',
    blockTypeButton: (type: string) => `block-editor-type-${type}`,
    // Markdown form
    rawMarkdownTab: 'block-editor-raw-markdown-tab',
    richMarkdownTab: 'block-editor-rich-markdown-tab',
    markdownTextarea: 'block-editor-markdown-textarea',
    // Section form
    sectionTitleInput: 'block-editor-section-title-input',
    sectionIdInput: 'block-editor-section-id-input',
    sectionAutoCollapseToggle: 'block-editor-section-auto-collapse-toggle',
    addAndRecordButton: 'block-editor-add-and-record-button',
    // Section empty state and nested add button
    sectionEmptyState: 'block-editor-section-empty-state',
    sectionNestedAddButton: 'block-editor-section-add-nested-block',
    editButton: 'block-editor-edit-button',
    duplicateButton: 'block-editor-duplicate-button',
    deleteButton: 'block-editor-delete-button',
    unpublishButton: 'block-editor-unpublish-button',
    copyJsonButton: 'block-editor-copy-json-button',
    saveDraftButton: 'block-editor-save-draft-button',
    publishButton: 'block-editor-publish-button',
    viewModeToggle: 'block-editor-view-mode-toggle',
    moreActionsButton: 'block-editor-more-actions-button',
    newGuideButton: 'block-editor-new-guide-button',
    libraryButton: 'block-editor-library-button',
    blockItem: (blockId: string) => `block-editor-item-${blockId}`,
    form: (formType: string) => `block-editor-form-${formType}`,
    formCancelButton: 'block-editor-form-cancel',
    recordStartButton: 'block-editor-record-start',
    recordStopButton: 'block-editor-record-stop',
    mergeMultistepButton: 'block-editor-merge-multistep',
    mergeGuidedButton: 'block-editor-merge-guided',
    clearSelectionButton: 'block-editor-clear-selection',
    toggleSelectionButton: 'block-editor-toggle-selection',
    loadTemplateButton: 'block-editor-load-template',
    openTourButton: 'block-editor-open-tour',
    importModal: 'block-editor-import-modal',
    importButton: 'block-editor-import-button',
    importCancelButton: 'block-editor-import-cancel',
    importResetButton: 'block-editor-import-reset',
    importDropZone: 'block-editor-import-drop-zone',
    metadataIdInput: 'block-editor-metadata-id',
    metadataTitleInput: 'block-editor-metadata-title',
    metadataSaveButton: 'block-editor-metadata-save',
    previewResetButton: 'block-editor-preview-reset',
  },

  // Learning Paths
  learningPaths: {
    card: (pathId: string) => `learning-path-card-${pathId}`,
    continueButton: (pathId: string) => `learning-path-continue-${pathId}`,
    resetButton: (pathId: string) => `learning-path-reset-${pathId}`,
    confirmResetButton: (pathId: string) => `learning-path-confirm-reset-${pathId}`,
    cancelResetButton: (pathId: string) => `learning-path-cancel-reset-${pathId}`,
    expandButton: (pathId: string) => `learning-path-expand-${pathId}`,
    viewBadgesButton: 'learning-paths-view-badges',
    badgesModal: 'learning-paths-badges-modal',
    badgesModalClose: 'learning-paths-badges-modal-close',
    badgeItem: (badgeId: string) => `learning-paths-badge-${badgeId}`,
    showAllPathsButton: 'learning-paths-show-all',
    showAllBadgesButton: 'learning-paths-show-all-badges',
    resetProgressButton: 'learning-paths-reset-progress',
    badgeToast: 'learning-paths-badge-toast',
    badgeToastDismiss: 'learning-paths-badge-toast-dismiss',
  },

  // Live Session
  liveSession: {
    startButton: 'live-session-start',
    joinButton: 'live-session-join',
    attendeeNameInput: 'live-session-attendee-name',
    attendeeCodeInput: 'live-session-attendee-code',
    attendeeJoinButton: 'live-session-attendee-join',
    backButton: 'live-session-back',
    guidedButton: 'live-session-guided',
    followButton: 'live-session-follow',
    leaveButton: 'live-session-leave',
    presenterCopyCode: 'live-session-presenter-copy-code',
    presenterCopyUrl: 'live-session-presenter-copy-url',
    presenterEndButton: 'live-session-presenter-end',
    presenterModalClose: 'live-session-presenter-modal-close',
    handRaiseButton: 'live-session-hand-raise',
    handRaiseQueue: 'live-session-hand-raise-queue',
    handRaiseQueueClose: 'live-session-hand-raise-queue-close',
    sessionActiveButton: 'live-session-active',
  },

  // PR Tester
  prTester: {
    form: 'pr-tester-form',
    prNumberInput: 'pr-tester-pr-number',
    fileSelect: 'pr-tester-file-select',
    loadButton: 'pr-tester-load',
  },

  // URL Tester
  urlTester: {
    form: 'url-tester-form',
    urlInput: 'url-tester-url-input',
    loadButton: 'url-tester-load',
  },

  // Coda Terminal
  codaTerminal: {
    panel: 'coda-terminal-panel',
    collapsedBar: 'coda-terminal-collapsed-bar',
    expandButton: 'coda-terminal-expand',
    collapseButton: 'coda-terminal-collapse',
    closeButton: 'coda-terminal-close',
    resizeHandle: 'coda-terminal-resize-handle',
    connectButton: 'coda-terminal-connect',
    disconnectButton: 'coda-terminal-disconnect',
    cancelButton: 'coda-terminal-cancel',
    searchToggle: 'coda-terminal-search-toggle',
    searchInput: 'coda-terminal-search-input',
    searchPrev: 'coda-terminal-search-prev',
    searchNext: 'coda-terminal-search-next',
    searchClose: 'coda-terminal-search-close',
  },

  // Home Page
  homePage: {
    container: 'home-page-container',
  },

  // Control Group Popup
  controlGroupPopup: {
    container: 'control-group-popup-container',
    dismissButton: 'control-group-popup-dismiss',
  },

  // Feedback Button
  feedbackButton: {
    trigger: 'feedback-button',
  },

  // Help Footer
  helpFooter: {
    container: 'help-footer-container',
    link: (index: number) => `help-footer-link-${index}`,
  },

  // App Error Fallback
  app: {
    errorTryAgain: 'app-error-try-again',
    errorRefresh: 'app-error-refresh',
  },

  // Enable Recommender Banner
  enableRecommender: {
    configButton: 'enable-recommender-config-button',
  },

  // Kiosk Mode
  kioskMode: {
    button: 'kiosk-mode-button',
    overlay: 'kiosk-mode-overlay',
    closeButton: 'kiosk-mode-close',
    header: 'kiosk-mode-header',
    tileGrid: 'kiosk-mode-tile-grid',
    tile: (index: number) => `kiosk-mode-tile-${index}`,
    tileTitle: (index: number) => `kiosk-mode-tile-title-${index}`,
    loading: 'kiosk-mode-loading',
    warning: 'kiosk-mode-warning',
  },
};
