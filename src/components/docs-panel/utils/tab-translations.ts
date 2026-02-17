/**
 * Tab translation utilities for docs-panel.
 * Pure mapping functions for translating tab titles.
 */

import { t } from '@grafana/i18n';

/**
 * Get the translated title for a tab.
 * Translates known system titles while preserving custom titles as-is.
 *
 * @param title - The original tab title
 * @returns The translated title or the original if no translation exists
 */
export const getTranslatedTitle = (title: string): string => {
  // Handle 'Learning path' (with lowercase 'p') from tab creation
  if (title === 'Learning path') {
    return t('docsPanel.learningJourney', 'Learning path');
  }
  // Handle 'Learning Path' (with uppercase 'P') from older data or translations
  if (title === 'Learning Path') {
    return t('docsPanel.learningJourney', 'Learning Path');
  }
  // Handle old 'Learning journey' (with lowercase 'j') for backwards compatibility
  if (title === 'Learning journey') {
    return t('docsPanel.learningJourney', 'Learning path');
  }
  // Handle old 'Learning Journey' (with uppercase 'J') for backwards compatibility
  if (title === 'Learning Journey') {
    return t('docsPanel.learningJourney', 'Learning Path');
  }
  if (title === 'Documentation') {
    return t('docsPanel.documentation', 'Documentation');
  }
  return title; // Custom titles stay as-is
};
