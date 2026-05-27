/**
 * Tab validation utilities for docs-panel.
 * Pure functions with zero dependencies for easy testing.
 */

/**
 * Helper to check if a tab type should be treated as docs-like content.
 * Both 'docs' and 'interactive' types render the same way (vs 'learning-journey').
 *
 * @param type - The tab type string to check
 * @returns true if the tab should be treated as docs-like content
 */
export const isDocsLikeTab = (type?: string): boolean => type === 'docs' || type === 'interactive';

/**
 * True if `loadTab` should route this tab through the docs/package branch.
 * Package-backed tabs require it for milestone + manifest resolution.
 */
export const shouldUseDocsLoader = (tab: { type?: string; packageInfo?: unknown }): boolean =>
  isDocsLikeTab(tab.type) || tab.packageInfo != null;
