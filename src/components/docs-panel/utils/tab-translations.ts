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
  // Handle 'Learning journey' (with lowercase 'j') from tab creation
  if (title === 'Learning journey') {
    return t('docsPanel.learningJourney', 'Learning journey');
  }
  // Handle 'Learning Journey' (with uppercase 'J') from older data or translations
  if (title === 'Learning Journey') {
    return t('docsPanel.learningJourney', 'Learning Journey');
  }
  if (title === 'Documentation') {
    return t('docsPanel.documentation', 'Documentation');
  }
  return title; // Custom titles stay as-is
};
