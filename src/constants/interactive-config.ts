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
      retry: 2000
    },
    // Technical delays for DOM operations
    technical: {
      navigation: 300,
      navigationDock: 200,
      scroll: 500,
      highlight: 1300,
      monacoClear: 100
    }
  },
  // Event-driven settling detection configuration
  settling: {
    useAnimationEvents: true,    // Listen for animationend events
    useTransitionEvents: true,   // Listen for transitionend events  
    useScrollEvents: true,       // Listen for scroll completion
    fallbackTimeouts: true       // Keep timeouts as fallbacks
  }
} as const;

/**
 * Type-safe access to configuration values
 */
export type InteractiveConfig = typeof INTERACTIVE_CONFIG; 
