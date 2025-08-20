// Unified docs retrieval module - entry point
// This replaces the separate docs-fetcher.ts and single-docs-fetcher.ts files

// Core content fetching
export * from './content.types';
export * from './content-fetcher';

// Learning journey helpers
export * from './learning-journey-helpers';

// React content renderer
export * from './content-renderer';

// HTML parser for React component conversion
export * from './html-parser';

// Re-export main functions with clear names for easy migration
export { fetchContent as fetchUnifiedContent } from './content-fetcher';

export {
  getNextMilestoneUrl as getNextMilestoneUrlFromContent,
  getPreviousMilestoneUrl as getPreviousMilestoneUrlFromContent,
  getJourneyCompletionPercentage,
  setJourneyCompletionPercentage,
  clearJourneyCompletion,
} from './learning-journey-helpers';

export { ContentRenderer, useContentRenderer } from './content-renderer';

// Compatibility layer removed - migration complete!
