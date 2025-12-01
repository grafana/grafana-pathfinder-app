import type { DocsPluginConfig } from '../constants';

/**
 * Configuration for interactive delays and timing
 * Replaces magic numbers with named constants for better maintainability
 */
export const INTERACTIVE_CONFIG_DEFAULTS = {
  maxRetries: 3,
  // Feature-level configuration
  requirements: {
    // Scoped heartbeat recheck for fragile prerequisites (optional, off by default)
    heartbeat: {
      enabled: true,
      intervalMs: 2000,
      watchWindowMs: 10000,
      onlyForFragile: true,
    },
  },
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
      reactiveCheck: 50, // Reactive check delay after completions
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
    verificationDelay: 200, // Delay before running post-verification checks (ms)
    feedbackDuration: 1500, // Duration to show auto-completion feedback (ms)
    eventTypes: ['click', 'input', 'change', 'mouseenter'] as const, // DOM events to monitor
  },
  // Position tracking configuration for highlight drift detection
  positionTracking: {
    driftThreshold: 5, // Pixels of center drift before triggering position correction
    checkIntervalMs: 100, // Throttle interval for RAF-based drift checks
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
    requirements: {
      ...defaults.requirements,
      heartbeat: {
        ...defaults.requirements.heartbeat,
        // Provide future override hooks via pluginConfig if needed
        enabled: defaults.requirements.heartbeat.enabled,
        intervalMs: defaults.requirements.heartbeat.intervalMs,
        watchWindowMs: defaults.requirements.heartbeat.watchWindowMs,
        onlyForFragile: defaults.requirements.heartbeat.onlyForFragile,
      },
    },
    autoDetection: {
      ...defaults.autoDetection,
      enabled: pluginConfig?.enableAutoDetection ?? false, // Default FALSE (opt-in)
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
 * Clear command constant for form fill operations
 * Use @@CLEAR@@ at the start of targetvalue to clear before filling
 */
export const CLEAR_COMMAND = '@@CLEAR@@' as const;

/**
 * Type-safe access to configuration values
 */
export type InteractiveConfig = typeof INTERACTIVE_CONFIG_DEFAULTS;

/**
 * HTML data attribute keys
 * Shared between editor and runtime for interactive guides
 */
export const DATA_ATTRIBUTES = {
  TARGET_ACTION: 'data-targetaction',
  REF_TARGET: 'data-reftarget',
  REQUIREMENTS: 'data-requirements',
  DO_IT: 'data-doit',
  TARGET_VALUE: 'data-targetvalue',
} as const;

/**
 * Interactive action types
 * Defines all supported interactive action types for guides
 */
export const ACTION_TYPES = {
  BUTTON: 'button',
  HIGHLIGHT: 'highlight',
  FORM_FILL: 'formfill',
  NAVIGATE: 'navigate',
  HOVER: 'hover',
  MULTISTEP: 'multistep',
  SEQUENCE: 'sequence',
  NOOP: 'noop',
} as const;

/**
 * Action icons - Single source of truth for emoji indicators
 * @deprecated Use ACTION_BADGES for the WYSIWYG editor UI
 * Kept for backward compatibility in other parts of the codebase
 */
export const ACTION_ICONS: Record<string, string> = {
  [ACTION_TYPES.BUTTON]: '🔘',
  [ACTION_TYPES.FORM_FILL]: '📝',
  [ACTION_TYPES.HIGHLIGHT]: '✨',
  [ACTION_TYPES.HOVER]: '👆',
  [ACTION_TYPES.MULTISTEP]: '📋',
  [ACTION_TYPES.NAVIGATE]: '🧭',
  [ACTION_TYPES.NOOP]: '📖',
  [ACTION_TYPES.SEQUENCE]: '📑',
} as const;

/**
 * Action badges - Text labels for WYSIWYG editor display
 * Short, clear labels that fit in small pill badges
 */
export const ACTION_BADGES: Record<string, string> = {
  [ACTION_TYPES.BUTTON]: 'Click',
  [ACTION_TYPES.FORM_FILL]: 'Fill',
  [ACTION_TYPES.HIGHLIGHT]: 'Show',
  [ACTION_TYPES.HOVER]: 'Hover',
  [ACTION_TYPES.MULTISTEP]: 'Multi',
  [ACTION_TYPES.NAVIGATE]: 'Go',
  [ACTION_TYPES.NOOP]: 'Info',
  [ACTION_TYPES.SEQUENCE]: 'Section',
  guided: 'Guide', // Not in ACTION_TYPES but used in editor
} as const;

/**
 * Default icon for unknown action types
 * @deprecated Use DEFAULT_ACTION_BADGE instead
 */
export const DEFAULT_ACTION_ICON = '⚡';

/**
 * Default badge label for unknown action types
 */
export const DEFAULT_ACTION_BADGE = 'Step';

/**
 * Get the emoji icon for an action type
 * @deprecated Use getActionBadge for WYSIWYG editor UI
 * @param actionType - The action type (e.g., 'button', 'highlight')
 * @returns The corresponding emoji, or DEFAULT_ACTION_ICON for unknown types
 */
export function getActionIcon(actionType: string): string {
  return ACTION_ICONS[actionType] ?? DEFAULT_ACTION_ICON;
}

/**
 * Get the text badge label for an action type
 * @param actionType - The action type (e.g., 'button', 'highlight')
 * @returns The corresponding label, or DEFAULT_ACTION_BADGE for unknown types
 */
export function getActionBadge(actionType: string): string {
  return ACTION_BADGES[actionType] ?? DEFAULT_ACTION_BADGE;
}

/**
 * Default attribute values
 */
export const DEFAULT_VALUES = {
  CLASS: 'interactive',
  REQUIREMENT: 'exists-reftarget',
  DO_IT_FALSE: 'false',
} as const;

/**
 * Step ID patterns for identifying step types
 * Used to detect first steps in sections and step dependencies
 */
export const STEP_PATTERNS = {
  FIRST_STEP_SUFFIXES: ['-step-1', '-multistep-1', '-guided-1'],
  SECTION_PREFIX: 'section-',
  STEP_INFIX: '-step-',
} as const;

/**
 * Helper function to check if a stepId represents a first step
 */
export function isFirstStep(stepId: string | undefined): boolean {
  if (!stepId) {
    return false;
  }

  // Check for any first step suffix pattern
  const matchesFirstStepPattern = STEP_PATTERNS.FIRST_STEP_SUFFIXES.some((suffix) => stepId.includes(suffix));

  // Or it's a standalone step (not in a section and not numbered)
  const isStandaloneStep = !stepId.includes(STEP_PATTERNS.SECTION_PREFIX) && !stepId.includes(STEP_PATTERNS.STEP_INFIX);

  return matchesFirstStepPattern || isStandaloneStep;
}

/**
 * Common requirement options available across interactive elements
 */
export const COMMON_REQUIREMENTS = [
  'exists-reftarget',
  'navmenu-open',
  'on-page:',
  'is-admin',
  'has-datasource:',
  'has-plugin:',
  'section-completed:',
] as const;

/**
 * Action metadata for UI display in the editor
 */
export interface ActionMetadata {
  type: string;
  icon: string;
  name: string;
  description: string;
  grafanaIcon?: string; // Grafana UI icon name mapping
}

// Type exports for type safety
export type ActionType = (typeof ACTION_TYPES)[keyof typeof ACTION_TYPES];
export type CommonRequirement = (typeof COMMON_REQUIREMENTS)[number];
export type DataAttribute = (typeof DATA_ATTRIBUTES)[keyof typeof DATA_ATTRIBUTES];
