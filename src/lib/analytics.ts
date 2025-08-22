/**
 * Analytics tracking utilities for the Grafana Docs Plugin
 *
 * This module handles all user interaction tracking and analytics reporting.
 * It provides structured event reporting to Rudder Stack via Grafana's runtime.
 */

import { reportInteraction } from '@grafana/runtime';
import pluginJson from '../plugin.json';

// ============================================================================
// USER INTERACTION TYPES
// ============================================================================

export enum UserInteraction {
  // Core Panel Interactions
  DocsPanelInteraction = 'docs_panel_interaction',
  DocsPanelScroll = 'docs_panel_scroll',
  DismissDocsPanel = 'dismiss_docs_panel',

  // Navigation & Tab Management
  CloseTabClick = 'close_tab_click',
  OpenSidepathView = 'open_sidepath_view',
  OpenExtraResourceTab = 'open_extra_resource_tab',

  // Content Interactions
  LearningJourneySummaryClick = 'learning_journey_summary_click',
  JumpIntoMilestoneClick = 'jump_into_milestone_click',
  StartLearningJourneyClick = 'start_learning_journey_click',
  ViewDocumentationClick = 'view_documentation_click',
  MilestoneArrowInteractionClick = 'milestone_arrow_interaction_click',
  OpenDocumentationButton = 'open_documentation_button',

  // Recommendations
  ClickSidepathRecommendation = 'click_sidepath_recommendation',

  // Media Interactions
  VideoPlayClick = 'video_play_click',
  VideoViewLength = 'video_view_length',

  // Feedback Systems
  GeneralPluginFeedbackButton = 'general_plugin_feedback_button',
  SpecificLearningJourneyFeedbackButton = 'specific_learning_journey_feedback_button',

  // Interactive Elements (Future Features)
  ShowMeButtonClick = 'show_me_button_click',
  ClickedHighlightedContentButton = 'clicked_highlighted_content_button',
  DoItButtonClick = 'do_it_button_click',
  DoSectionButtonClick = 'do_section_button_click',
}

// ============================================================================
// CORE ANALYTICS FUNCTIONS
// ============================================================================

/**
 * Creates a properly namespaced interaction name for Grafana analytics
 */
const createInteractionName = (type: UserInteraction): string => {
  return `${pluginJson.id.replace(/-/g, '_')}_${type}`;
};

/**
 * Reports a user interaction event to Grafana analytics (Rudder Stack)
 *
 * @param type - The type of interaction from UserInteraction enum
 * @param properties - Additional properties to attach to the event
 */
export function reportAppInteraction(
  type: UserInteraction,
  properties: Record<string, string | number | boolean> = {}
): void {
  reportInteraction(createInteractionName(type), properties);
}

// ============================================================================
// SCROLL TRACKING FUNCTIONALITY
// ============================================================================

/**
 * Type definition for tabs compatible with scroll tracking
 */
export interface ScrollTrackingTab {
  type?: 'docs' | 'learning-journey';
  docsContent?: { url?: string } | null;
  content?: {
    url?: string;
    currentMilestone?: number;
    totalMilestones?: number;
  } | null;
  currentUrl?: string;
  baseUrl?: string;
}

// Global tracking set to prevent duplicate events across all instances
const scrolledPages = new Set<string>();

/**
 * Sets up scroll tracking for a content element that fires analytics once per unique page
 *
 * This function attaches a scroll event listener with debouncing and deduplication
 * to track when users scroll on different documentation pages. Each unique page
 * will only fire the analytics event once per session to prevent spam.
 *
 * @param contentElement - The scrollable content element to track
 * @param activeTab - The currently active tab object containing content info
 * @param isRecommendationsTab - Whether the recommendations tab is currently active
 * @returns Cleanup function to remove event listeners and clear timers
 */
export function setupScrollTracking(
  contentElement: HTMLElement | null,
  activeTab: ScrollTrackingTab | null,
  isRecommendationsTab: boolean
): () => void {
  if (!contentElement) {
    return () => {}; // Return no-op cleanup if no element provided
  }

  let scrollTimer: NodeJS.Timeout;

  const handleScroll = (): void => {
    // Debounce scroll events to avoid excessive firing during rapid scrolling
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const pageIdentifier = determinePageIdentifier(activeTab, isRecommendationsTab);

      // Exit early if no valid page identifier or already tracked
      if (!pageIdentifier || scrolledPages.has(pageIdentifier)) {
        return;
      }

      // Mark page as tracked and fire analytics
      scrolledPages.add(pageIdentifier);

      const properties = buildScrollEventProperties(activeTab, isRecommendationsTab, pageIdentifier);
      reportAppInteraction(UserInteraction.DocsPanelScroll, properties);
    }, 150); // 150ms debounce to balance responsiveness and performance
  };

  // Attach scroll listener with passive flag for better performance
  contentElement.addEventListener('scroll', handleScroll, { passive: true });

  // Return cleanup function
  return (): void => {
    contentElement.removeEventListener('scroll', handleScroll);
    clearTimeout(scrollTimer);
  };
}

/**
 * Determines a unique identifier for the current page/content
 */
function determinePageIdentifier(activeTab: ScrollTrackingTab | null, isRecommendationsTab: boolean): string | null {
  if (isRecommendationsTab) {
    return 'recommendations';
  }

  if (activeTab?.type === 'docs' && activeTab.docsContent) {
    return activeTab.docsContent.url || activeTab.currentUrl || activeTab.baseUrl || 'unknown-docs';
  }

  if (activeTab?.type !== 'docs' && activeTab?.content) {
    return activeTab.content.url || activeTab.currentUrl || activeTab.baseUrl || 'unknown-journey';
  }

  return null; // No valid content to track
}

/**
 * Builds the properties object for scroll events
 */
function buildScrollEventProperties(
  activeTab: ScrollTrackingTab | null,
  isRecommendationsTab: boolean,
  pageIdentifier: string
): Record<string, string | number | boolean> {
  const properties: Record<string, string | number | boolean> = {
    page_type: isRecommendationsTab ? 'recommendations' : activeTab?.type || 'learning-journey',
    page_url: pageIdentifier,
  };

  // Add additional context for learning journeys
  if (activeTab?.type !== 'docs' && activeTab?.content) {
    properties.current_milestone = activeTab.content.currentMilestone || 0;
    properties.total_milestones = activeTab.content.totalMilestones || 0;
  }

  return properties;
}

/**
 * Clears the scroll tracking cache
 *
 * Useful for testing scenarios or when you need to reset the tracking state
 * to allow events to fire again for previously tracked pages.
 */
export function clearScrollTrackingCache(): void {
  scrolledPages.clear();
}
