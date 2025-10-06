import type { DocsPluginConfig } from '../constants';

/**
 * Configuration for interactive delays and timing
 * Replaces magic numbers with named constants for better maintainability
 */
export const INTERACTIVE_CONFIG_DEFAULTS = {
  maxRetries: 3,
  delays: {
    // Perceptual delays for human-readable timing
    perceptual: {
      base: 800,
      button: 1500,
      hover: 2000, // Duration to maintain hover state (2 seconds)
      retry: 2000,
    },
    // Technical delays for DOM operations
    technical: {
      navigation: 300,
      navigationDock: 200,
      scroll: 500,
      highlight: 2500, // Increased from 1300ms to 2500ms for better readability
      monacoClear: 200, // Increased from 100ms to 200ms to prevent recursive decoration errors
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
      domSettlingDelay: 300, // Delay after scroll before highlight positioning for DOM stability
    },
    // Form filling timing (for typing simulation)
    formFill: {
      keystrokeDelay: 50, // Delay between individual keystrokes for realistic typing
      monacoEventDelay: 150, // Delay between Monaco editor events to prevent recursive decoration updates
      monacoKeyEventDelay: 50, // Delay between Monaco keydown/keyup events
    },
    // Requirements checking timing
    requirements: {
      checkTimeout: 3000, // PERFORMANCE FIX: Reduced from 5000ms to 3000ms for faster UX
      retryDelay: 300, // Delay between retry attempts (reduced from 1000ms for faster UX)
      maxRetries: 3, // Maximum number of retry attempts
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
    // Element validation timing
    elementValidation: {
      visibilityCheckTimeout: 100, // Timeout for visibility checks
      scrollContainerDetectionDepth: 10, // Max parent levels to check for scroll containers
    },
  },
  // Smart auto-cleanup configuration for highlights
  cleanup: {
    viewportThreshold: 0.1, // Clear when <10% of element is visible
    viewportMargin: '50px', // Buffer zone before clearing (prevents premature clearing)
    clickOutsideDelay: 500, // Delay before enabling click-outside detection (ms)
  },
  // Event-driven settling detection configuration
  settling: {
    useAnimationEvents: true, // Listen for animationend events
    useTransitionEvents: true, // Listen for transitionend events
    useScrollEvents: true, // Listen for scroll completion
    fallbackTimeouts: true, // Keep timeouts as fallbacks
  },
  // Auto-detection configuration for step completion
  autoDetection: {
    enabled: false, // Global toggle for auto-detection feature (opt-in, disabled by default)
    debounceDelay: 100, // Debounce detected actions to prevent rapid-fire matches (ms)
    verificationDelay: 200, // Delay before running post-verification checks (ms)
    feedbackDuration: 1500, // Duration to show auto-completion feedback (ms)
    eventTypes: ['click', 'input', 'change', 'mouseenter'] as const, // DOM events to monitor
  },
} as const;

/**
 * Get interactive configuration with plugin overrides applied
 *
 * @param pluginConfig - Optional plugin configuration to override defaults
 * @returns Complete interactive configuration with user preferences applied
 */
export function getInteractiveConfig(pluginConfig?: DocsPluginConfig) {
  const defaults = INTERACTIVE_CONFIG_DEFAULTS;

  return {
    ...defaults,
    autoDetection: {
      ...defaults.autoDetection,
      enabled: pluginConfig?.enableAutoDetection ?? false, // Default FALSE (opt-in)
      debounceDelay: pluginConfig?.autoDetectionDebounce ?? defaults.autoDetection.debounceDelay,
    },
    delays: {
      ...defaults.delays,
      requirements: {
        ...defaults.delays.requirements,
        checkTimeout: pluginConfig?.requirementsCheckTimeout ?? defaults.delays.requirements.checkTimeout,
      },
    },
    // Note: guidedStepTimeout is used directly in components, not here
  };
}

/**
 * Backward compatibility: Export defaults as INTERACTIVE_CONFIG
 * Components can migrate to getInteractiveConfig() over time
 */
export const INTERACTIVE_CONFIG = INTERACTIVE_CONFIG_DEFAULTS;

/**
 * Type-safe access to configuration values
 */
export type InteractiveConfig = typeof INTERACTIVE_CONFIG_DEFAULTS;
