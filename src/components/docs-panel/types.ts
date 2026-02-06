/**
 * Type definitions for extracted docs-panel components
 */

import { RefObject } from 'react';
import { GrafanaTheme2 } from '@grafana/data';
import { LearningJourneyTab } from '../../types/content-panel.types';
import { RawContent } from '../../docs-retrieval/content.types';
import { CombinedLearningJourneyPanel } from './docs-panel';

/**
 * Props for DocsPanelContent component
 * Groups all inputs needed to render the content area (everything in the content IIFE)
 */
export interface DocsPanelContentProps {
  // Model and tab state
  model: CombinedLearningJourneyPanel;
  activeTab: LearningJourneyTab | null;
  activeTabId: string;
  isRecommendationsTab: boolean;
  isWysiwygPreview: boolean;

  // Content and rendering
  stableContent: RawContent | null;
  contentRef: RefObject<HTMLDivElement>;

  // Interactive progress state
  progressKey: string;
  hasInteractiveProgress: boolean;
  setHasInteractiveProgress: (has: boolean) => void;
  checkProgress: () => void;

  // Scroll restoration
  restoreScrollPosition: () => void;

  // Styles
  theme: GrafanaTheme2;
  styles: Record<string, string>;
  interactiveStyles: string;
  prismStyles: string;
  journeyStyles: string;
  docsStyles: string;

  // Dev mode flag
  isDevMode: boolean;
}
