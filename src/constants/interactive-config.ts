/**
 * Configuration for interactive delays and timing
 * Replaces magic numbers with named constants for better maintainability
 */
export const INTERACTIVE_CONFIG = {
  maxRetries: 3,
  delays: {
    // Perceptual delays for human-readable timing
    perceptual: {
      base: 800,
      button: 1500,
      retry: 2000,
    },
    // Technical delays for DOM operations
    technical: {
      navigation: 300,
      navigationDock: 200,
      scroll: 500,
      highlight: 2500, // Increased from 1300ms to 2500ms for better readability
      monacoClear: 100,
    },
    // Section sequence timing
    section: {
      showPhaseIterations: 30, // 30 * 100ms = 3000ms wait for highlight/comment visibility
      betweenStepsIterations: 18, // 18 * 100ms = 1800ms delay between "do it" actions
      baseInterval: 100, // Base 100ms interval for all iteration-based delays
    },
    // Multi-step sequence timing
    multiStep: {
      defaultStepDelay: 1800, // Default delay between internal actions in multi-step
      showToDoIterations: 18, // 18 * 100ms = 1800ms delay between show and do
      baseInterval: 100, // Base 100ms interval for cancellation-safe delays
    },
    // Navigation manager timing
    navigation: {
      scrollTimeout: 200, // Scroll completion detection timeout
      scrollFallbackTimeout: 500, // Fallback timeout for scroll operations
      commentExitAnimation: 200, // Comment box exit animation duration
    },
    // Form filling timing (for typing simulation)
    formFill: {
      keystrokeDelay: 50, // Delay between individual keystrokes for realistic typing
    },
    // Requirements checking timing
    requirements: {
      checkTimeout: 5000, // Maximum time to wait for requirements check
    },
    // Debouncing and state management timing
    debouncing: {
      contextRefresh: 500, // Main context refresh debounce
      uiUpdates: 25, // UI re-render debounce
      modalDetection: 50, // Modal state change debounce
      requirementsRetry: 10000, // Auto-retry for failed requirements
      stateSettling: 100, // General state settling delay
      reactiveCheck: 150, // Reactive check delay after completions
    },
  },
  // Event-driven settling detection configuration
  settling: {
    useAnimationEvents: true, // Listen for animationend events
    useTransitionEvents: true, // Listen for transitionend events
    useScrollEvents: true, // Listen for scroll completion
    fallbackTimeouts: true, // Keep timeouts as fallbacks
  },
} as const;

/**
 * Type-safe access to configuration values
 */
export type InteractiveConfig = typeof INTERACTIVE_CONFIG;
