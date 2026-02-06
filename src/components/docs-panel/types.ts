/**
 * Type definitions for extracted docs-panel components
 */

import { RefObject } from 'react';
import { GrafanaTheme2 } from '@grafana/data';
import { LearningJourneyTab } from '../../types/content-panel.types';
import { RawContent } from '../../docs-retrieval/content.types';

/**
 * Operations interface for docs-panel model
 *
 * This interface defines the public API that extracted components and hooks
 * should use to interact with the panel's state and behavior.
 *
 * Pattern E: Interface-first approach for decoupling components from Scene class
 */
export interface DocsPanelModelOperations {
  /** Open a learning journey in a new tab */
  openLearningJourney(url: string, title?: string): Promise<string>;

  /** Open a docs page in a new tab */
  openDocsPage(url: string, title?: string, skipReadyToBegin?: boolean): Promise<string>;

  /** Load content for a learning journey tab */
  loadTabContent(tabId: string, url: string): Promise<void>;

  /** Load content for a docs-like tab */
  loadDocsTabContent(tabId: string, url: string, skipReadyToBegin?: boolean): Promise<void>;

  /** Close a tab by ID */
  closeTab(tabId: string): void;

  /** Set the active tab by ID */
  setActiveTab(tabId: string): void;

  /** Navigate to the next milestone in the current learning journey */
  navigateToNextMilestone(): Promise<void>;

  /** Navigate to the previous milestone in the current learning journey */
  navigateToPreviousMilestone(): Promise<void>;

  /** Check if navigation to next milestone is possible */
  canNavigateNext(): boolean;

  /** Check if navigation to previous milestone is possible */
  canNavigatePrevious(): boolean;

  /** Open the dev tools tab (or switch to it if already open) */
  openDevToolsTab(): void;

  /** Get the currently active tab */
  getActiveTab(): LearningJourneyTab | null;
}

/**
 * Props for DocsPanelContent component
 * Groups all inputs needed to render the content area (everything in the content IIFE)
 */
export interface DocsPanelContentProps {
  // Operations interface instead of full model
  operations: DocsPanelModelOperations;

  // Tab state
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
