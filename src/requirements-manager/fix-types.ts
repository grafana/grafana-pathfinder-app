/**
 * Fix type constants and value type.
 *
 * Lives in requirements-manager (Tier 2) so the fix-handler registry can
 * reference these values without violating the Tier 2 → Tier 3-4 import
 * boundary. The UI/E2E surface (`src/components/interactive-tutorial/step-states.ts`)
 * re-exports these for `data-test-fix-type` attribute values and contract tests.
 */

export const FIX_TYPES = {
  NONE: 'none',
  NAVIGATION: 'navigation',
  LAZY_SCROLL: 'lazy-scroll',
  LOCATION: 'location',
  EXPAND_PARENT_NAVIGATION: 'expand-parent-navigation',
  EXPAND_OPTIONS_GROUP: 'expand-options-group',
  /**
   * Last-resort recovery: the user clicked the AI-powered "Fix this"
   * variant because no deterministic fix-registry handler matched. The
   * patch is applied via the assistant-integration
   * `pathfinder-ai-fix-patch` event, NOT through `dispatchFix`. Listed
   * here only so the value is available for testIds and analytics.
   */
  AI_FIX: 'ai-fix',
} as const;

export type FixTypeValue = (typeof FIX_TYPES)[keyof typeof FIX_TYPES];
