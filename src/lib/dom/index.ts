/**
 * DOM manipulation and element selection utilities
 * Centralized barrel export for all DOM-related functionality
 */

// Re-export all DOM utilities
export * from './dom-utils';
export * from './enhanced-selector';
export * from './selector-generator';
export * from './selector-validator';
export * from './element-validator';
export * from './dom-settling.hook';

// Note: docs.utils.ts is NOT exported here to avoid pulling in React components
// that cause IntersectionObserver issues in test environments.
// Import directly from './lib/dom/docs.utils' if needed.
