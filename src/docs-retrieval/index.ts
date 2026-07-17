// Unified docs retrieval module - entry point
// This replaces the separate docs-fetcher.ts and single-docs-fetcher.ts files

// Core content fetching
export * from '../types/content.types';
export * from './content-fetcher';

// Learning journey helpers
export * from './learning-journey-helpers';

// HTML parser for React component conversion
export * from './html-parser';

// JSON guide parser (re-exported for tests + adjacent modules that import via
// the barrel; the runtime entry remains in `./json-parser`).
export { parseJsonGuide, isJsonGuideContent } from './json-parser';

// URL resolver (used by the content-renderer React component, which lives
// in `components/content-renderer/`).
export { resolveRelativeUrls } from './resolve-relative-urls';

// Guide response context — provider + read hooks.
export { GuideResponseProvider, useGuideResponses } from './GuideResponseContext';

// Re-export main functions with clear names for easy migration
export { fetchContent as fetchUnifiedContent } from './content-fetcher';

// Package content integration (Phase 4g)
export {
  fetchPackageContent,
  fetchPackageById,
  setPackageResolver,
  resolvePackageMilestones,
  resolvePackageNavLinks,
  derivePathSlug,
} from './content-fetcher/package-content';

export { fetchPackageInfoFromUrl, isPackageContentUrl } from './package-info-from-url';

export { resolveJourneyStepWeights } from './journey-step-weights';
export { countGuideSteps } from './count-guide-steps';

export {
  getNextMilestoneUrl as getNextMilestoneUrlFromContent,
  getPreviousMilestoneUrl as getPreviousMilestoneUrlFromContent,
  getJourneyCompletionPercentage,
  setJourneyCompletionPercentage,
  clearJourneyCompletion,
} from './learning-journey-helpers';

// The React `ContentRenderer` lives in `components/content-renderer/` after
// the C6 tier-violation move — no re-export here to keep `docs-retrieval`
// as a pure parser tier. Consumers (`BlockPreview`, `FloatingPanelContent`)
// import directly from the new location.

// JSON guide parser
export { parseMarkdownToElements } from './json-parser';

// Docs components
export {
  CodeBlock,
  ExpandableTable,
  ImageRenderer,
  ContentParsingError,
  VideoRenderer,
  YouTubeVideoRenderer,
} from './components/docs';
export type { CodeBlockProps } from './components/docs';

// Guide response context (consumed by components/interactive-tutorial/)
export { useGuideResponsesOptional } from './GuideResponseContext';
