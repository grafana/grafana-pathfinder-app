export const testIds = {
  appConfig: {
    recommenderServiceUrl: 'data-testid-recommender-service-url',
    tutorialUrl: 'data-testid-tutorial-url',
    submit: 'data-testid-submit-config',
    // Legacy fields for backward compatibility
    apiKey: 'data-testid-api-key',
    apiUrl: 'data-testid-api-url',
    // Interactive Features
    interactiveFeatures: {
      toggle: 'data-testid-auto-detection-toggle',
      debounce: 'data-testid-debounce-input',
      requirementsTimeout: 'data-testid-requirements-timeout-input',
      guidedTimeout: 'data-testid-guided-timeout-input',
      reset: 'data-testid-reset-defaults',
      submit: 'data-testid-submit-interactive-features',
    },
  },
  termsAndConditions: {
    toggle: 'data-testid-recommender-toggle',
    submit: 'data-testid-recommender-submit',
    termsContent: 'data-testid-terms-content',
  },
};
