/**
 * Analytics tracking utilities for the Grafana Docs Plugin
 *
 * This module handles all user interaction tracking and analytics reporting.
 * It provides structured event reporting to Rudder Stack via Grafana's runtime.
 */

import { reportInteraction } from '@grafana/runtime';
import packageJson from '../../package.json';
import { isInteractiveLearningUrl } from '../security';
import { getExperimentConfig, FeatureFlags } from '../utils/openfeature';

// ============================================================================
// USER INTERACTION TYPES
// ============================================================================

export enum UserInteraction {
  // Core Panel Interactions
  DocsPanelInteraction = 'docs_panel_interaction',
  PanelScroll = 'panel_scroll',

  // Navigation & Tab Management
  CloseTabClick = 'close_tab_click',
  OpenExtraResource = 'open_extra_resource',

  // Content Interactions
  SummaryClick = 'summary_click',
  JumpIntoMilestoneClick = 'jump_into_milestone_click',
  StartLearningJourneyClick = 'start_learning_journey_click',
  OpenResourceClick = 'open_resource_click',
  MilestoneArrowInteractionClick = 'milestone_arrow_interaction_click',

  // Media Interactions
  VideoPlayClick = 'video_play_click',
  VideoViewLength = 'video_view_length',

  // Feedback Systems
  GeneralPluginFeedbackButton = 'general_plugin_feedback_button',
  EnableRecommendationsBanner = 'enable_recommendations_banner',

  // Interactive Elements
  ShowMeButtonClick = 'show_me_button_click',
  DoItButtonClick = 'do_it_button_click',
  DoSectionButtonClick = 'do_section_button_click',
  StepAutoCompleted = 'step_auto_completed',
  StepAutoCompleteFailed = 'step_auto_complete_failed',

  // Global Link Interception
  GlobalDocsLinkIntercepted = 'global_docs_link_intercepted',

  // Assistant Integration
  AssistantCustomizeClick = 'assistant_customize_click',
  AssistantCustomizeSuccess = 'assistant_customize_success',
  AssistantCustomizeError = 'assistant_customize_error',
  AssistantRevertClick = 'assistant_revert_click',
  AssistantTextSelectionMade = 'assistant_text_selection_made',
  AssistantAskButtonClick = 'assistant_ask_button_click',

  // Learning Paths & Gamification
  LearningPathProgress = 'learning_path_progress',
  BadgeUnlocked = 'badge_unlocked',

  // Feature Flag Tracking
  FeatureFlagEvaluated = 'feature_flag_evaluated',
}

// ============================================================================
// CORE ANALYTICS FUNCTIONS
// ============================================================================

/**
 * Creates a properly namespaced interaction name for Grafana analytics
 */
const createInteractionName = (type: UserInteraction): string => {
  return `pathfinder_${type}`;
};

/**
 * Experiment entry for analytics enrichment
 * Each experiment includes its flag name and the raw config from GOFF
 */
interface ExperimentAnalyticsEntry {
  flag: string;
  [key: string]: unknown; // Allow any additional properties from GOFF
}

/**
 * Gets the current experiments state as an array for analytics enrichment
 *
 * This captures all active experiments at the time of the analytics event,
 * enabling analysis of experiment impact on user behavior.
 *
 * Each experiment config is included as-is from GOFF, allowing flexibility for any
 * experiment structure without requiring code changes.
 *
 * @returns Array of experiment configs, or null if experiments cannot be retrieved
 */
function getExperimentsForAnalytics(): ExperimentAnalyticsEntry[] | null {
  try {
    const experiments: ExperimentAnalyticsEntry[] = [];

    // Add experiment variant config
    // Structure comes directly from GOFF - allows any experiment configuration
    const experimentVariantConfig = getExperimentConfig(FeatureFlags.EXPERIMENT_VARIANT);
    experiments.push({
      flag: FeatureFlags.EXPERIMENT_VARIANT,
      ...experimentVariantConfig,
    });

    // Add additional experiments here as needed:
    // const anotherExperiment = getExperimentConfig(FeatureFlags.ANOTHER_EXPERIMENT);
    // experiments.push({ flag: FeatureFlags.ANOTHER_EXPERIMENT, ...anotherExperiment });

    return experiments;
  } catch (error) {
    // Silently fail - feature flags may not be initialized yet
    return null;
  }
}

/**
 * Determines the appropriate content_type for analytics based on URL
 *
 * If the URL is from the interactive-learning CDN (interactive-learning.grafana.net
 * or interactive-learning.grafana-dev.net), returns 'interactive_guide'.
 * Otherwise returns the provided fallback type.
 *
 * @param url - The content URL to check
 * @param fallbackType - The type to use if URL is not from interactive-learning CDN
 * @returns 'interactive_guide' for CDN content, otherwise the fallback type
 *
 * @example
 * ```typescript
 * // Returns 'interactive_guide' for CDN URLs
 * getContentTypeForAnalytics('https://interactive-learning.grafana.net/guide/', 'docs')
 *
 * // Returns 'learning-journey' for non-CDN URLs
 * getContentTypeForAnalytics('https://grafana.com/docs/tutorial/', 'learning-journey')
 * ```
 */
export function getContentTypeForAnalytics(url: string | undefined | null, fallbackType = 'docs'): string {
  if (url && isInteractiveLearningUrl(url)) {
    return 'interactive_guide';
  }
  return fallbackType;
}

/**
 * Reports a user interaction event to Grafana analytics (Rudder Stack)
 *
 * All events automatically include:
 * - plugin_version: The current plugin version from plugin.json
 * - feature_flags: JSON object containing current feature flag state (except for FeatureFlagEvaluated events)
 *
 * @param type - The type of interaction from UserInteraction enum
 * @param properties - Additional properties to attach to the event
 */
export function reportAppInteraction(
  type: UserInteraction,
  properties: Record<string, string | number | boolean> = {}
): void {
  try {
    const interactionName = createInteractionName(type);

    // Skip experiment enrichment for FeatureFlagEvaluated events to avoid recursion
    // (those events already contain the flag info in their properties)
    const shouldEnrichWithExperiments = type !== UserInteraction.FeatureFlagEvaluated;
    const experiments = shouldEnrichWithExperiments ? getExperimentsForAnalytics() : null;

    // Add global attributes to all events
    const enrichedProperties: Record<string, unknown> = {
      plugin_version: packageJson.version,
      ...properties,
      // Include experiments array if available (null check for graceful degradation)
      ...(experiments && { experiments }),
    };

    reportInteraction(interactionName, enrichedProperties);
  } catch (error) {
    console.warn('Analytics reporting failed:', error);
  }
}

// ============================================================================
// SCROLL TRACKING FUNCTIONALITY
// ============================================================================

/**
 * Type definition for tabs compatible with scroll tracking
 */
export interface ScrollTrackingTab {
  type?: 'docs' | 'learning-journey' | 'devtools';
  content?: {
    url?: string;
    metadata?: {
      learningJourney?: {
        currentMilestone?: number;
        totalMilestones?: number;
      };
    };
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
      reportAppInteraction(UserInteraction.PanelScroll, properties);
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

  if (!activeTab) {
    return null;
  }

  // For docs tabs, use the content URL or fallback to currentUrl/baseUrl
  if (activeTab.type === 'docs') {
    return activeTab.content?.url || activeTab.currentUrl || activeTab.baseUrl || 'unknown-docs';
  }

  // For learning journey tabs, use the content URL or fallback to currentUrl/baseUrl
  if (activeTab.type === 'learning-journey' || !activeTab.type) {
    return activeTab.content?.url || activeTab.currentUrl || activeTab.baseUrl || 'unknown-journey';
  }

  // Fallback for any other tab types
  return activeTab.currentUrl || activeTab.baseUrl || 'unknown-tab';
}

/**
 * Builds the properties object for scroll events
 */
function buildScrollEventProperties(
  activeTab: ScrollTrackingTab | null,
  isRecommendationsTab: boolean,
  pageIdentifier: string
): Record<string, string | number | boolean> {
  const pageType = isRecommendationsTab ? 'recommendations' : activeTab?.type || 'learning-journey';

  const properties: Record<string, string | number | boolean> = {
    page_type: pageType,
    content_url: pageIdentifier,
    content_type: isRecommendationsTab ? '' : activeTab?.type || 'learning-journey',
  };

  // Add additional context for learning journeys
  if (activeTab?.type === 'learning-journey' && activeTab?.content?.metadata?.learningJourney) {
    properties.current_milestone = activeTab.content.metadata.learningJourney.currentMilestone || 0;
    properties.total_milestones = activeTab.content.metadata.learningJourney.totalMilestones || 0;
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

// ============================================================================
// LEARNING JOURNEY ANALYTICS HELPERS
// ============================================================================

/**
 * Content interface compatible with journey progress calculations
 * Accepts both RawContent and legacy content formats
 */
export interface JourneyContent {
  type?: 'learning-journey' | 'docs' | 'single-doc'; // Include single-doc for RawContent compatibility
  metadata?: {
    learningJourney?: {
      currentMilestone?: number;
      totalMilestones?: number;
    };
  };
}

/**
 * Calculates the completion percentage for a learning journey
 *
 * @param content - The content object containing journey metadata
 * @returns Completion percentage (0-100) or 0 if not a learning journey
 */
export function calculateJourneyProgress(content: JourneyContent | null | undefined): number {
  if (!content || content.type !== 'learning-journey' || !content.metadata?.learningJourney) {
    return 0;
  }

  const { currentMilestone, totalMilestones } = content.metadata.learningJourney;

  if (!totalMilestones || totalMilestones === 0) {
    return 0;
  }

  return Math.round(((currentMilestone || 0) / totalMilestones) * 100);
}

/**
 * Extracts journey metadata properties for analytics events
 *
 * @param content - The content object containing journey metadata
 * @returns Object with journey properties or empty object if not a journey
 */
export function getJourneyProperties(content: JourneyContent | null | undefined): Record<string, number> {
  if (!content || content.type !== 'learning-journey' || !content.metadata?.learningJourney) {
    return {};
  }

  const { currentMilestone, totalMilestones } = content.metadata.learningJourney;

  return {
    completion_percentage: calculateJourneyProgress(content),
    current_milestone: currentMilestone || 0,
    total_milestones: totalMilestones || 0,
  };
}

/**
 * Enriches analytics properties with journey context if content is a learning journey
 *
 * This is the primary helper for adding journey progress to any analytics event.
 * It conditionally adds journey properties only when the content is a learning journey.
 *
 * @param baseProperties - Base properties for the analytics event
 * @param content - Optional content object to extract journey data from
 * @returns Enriched properties object with journey data if applicable
 *
 * @example
 * ```typescript
 * reportAppInteraction(
 *   UserInteraction.OpenExtraResource,
 *   enrichWithJourneyContext({
 *     content_url: url,
 *     link_type: 'external',
 *   }, activeTab?.content)
 * );
 * ```
 */
export function enrichWithJourneyContext(
  baseProperties: Record<string, string | number | boolean>,
  content: JourneyContent | null | undefined
): Record<string, string | number | boolean> {
  const journeyProps = getJourneyProperties(content);

  // Only add journey properties if they exist (non-empty object)
  if (Object.keys(journeyProps).length > 0) {
    return { ...baseProperties, ...journeyProps };
  }

  return baseProperties;
}

// ============================================================================
// INTERACTIVE STEP ANALYTICS HELPERS
// ============================================================================

/**
 * Gets the current source document and step ID from global window variables
 *
 * This helper extracts document context that's set by the docs panel for
 * analytics tracking purposes. It's used across all interactive components.
 *
 * @param stepId - Optional step identifier to include in the result
 * @returns Object with source_document and step_id for analytics
 */
export function getSourceDocument(stepId?: string): { source_document: string; step_id: string } {
  try {
    const tabUrl = (window as any).__DocsPluginActiveTabUrl as string | undefined;
    const contentKey = (window as any).__DocsPluginContentKey as string | undefined;
    const sourceDocument = tabUrl || contentKey || window.location.pathname || 'unknown';

    return {
      source_document: sourceDocument,
      step_id: stepId || 'unknown',
    };
  } catch {
    return {
      source_document: 'unknown',
      step_id: stepId || 'unknown',
    };
  }
}

/**
 * Calculates completion percentage for an interactive step within a document
 *
 * Converts 0-indexed step position to 1-indexed for analytics and calculates
 * percentage progress through the document's total steps.
 *
 * @param stepIndex - 0-indexed position of the step in the document
 * @param totalSteps - Total number of steps in the document
 * @returns Completion percentage (0-100) or undefined if data is incomplete
 *
 * @example
 * ```typescript
 * calculateStepCompletion(2, 10) // Returns 30 (step 3 of 10 = 30%)
 * calculateStepCompletion(9, 10) // Returns 100 (step 10 of 10 = 100%)
 * ```
 */
export function calculateStepCompletion(stepIndex?: number, totalSteps?: number): number | undefined {
  if (stepIndex === undefined || totalSteps === undefined || totalSteps === 0) {
    return undefined;
  }

  // Convert 0-indexed to 1-indexed and calculate percentage
  return Math.round(((stepIndex + 1) / totalSteps) * 100);
}

/**
 * Interface for step context used in analytics
 */
export interface StepContext {
  stepId?: string;
  stepIndex?: number;
  totalSteps?: number;
  sectionId?: string;
  sectionTitle?: string;
}

/**
 * Builds a complete analytics properties object for interactive step interactions
 *
 * This is the primary helper for all interactive step analytics (Show me, Do it, etc.).
 * Centralizes the property building logic used across all interactive components.
 *
 * @param baseProperties - Base properties specific to the interaction
 * @param stepContext - Step position and section context
 * @returns Complete properties object ready for reportAppInteraction
 *
 * @example
 * ```typescript
 * reportAppInteraction(
 *   UserInteraction.DoItButtonClick,
 *   buildInteractiveStepProperties(
 *     {
 *       target_action: 'button',
 *       ref_target: 'Save',
 *       interaction_location: 'interactive_step',
 *     },
 *     { stepId, stepIndex, totalSteps, sectionId, sectionTitle }
 *   )
 * );
 * ```
 */
export function buildInteractiveStepProperties(
  baseProperties: Record<string, string | number | boolean>,
  stepContext: StepContext
): Record<string, string | number | boolean> {
  const { stepId, stepIndex, totalSteps, sectionId, sectionTitle } = stepContext;

  // Get source document info
  const docInfo = getSourceDocument(stepId);

  // Calculate completion percentage
  const completionPercentage = calculateStepCompletion(stepIndex, totalSteps);

  // Build complete properties object
  return {
    ...docInfo,
    ...baseProperties,
    content_type: 'interactive_guide',
    ...(stepIndex !== undefined && { current_step: stepIndex + 1 }), // 1-indexed for analytics
    ...(totalSteps !== undefined && { total_document_steps: totalSteps }),
    ...(completionPercentage !== undefined && { completion_percentage: completionPercentage }),
    ...(sectionId && { section_id: sectionId }),
    ...(sectionTitle && { section_title: sectionTitle }),
  };
}

/**
 * Gets the current interactive step context from global window variables
 *
 * This extracts step position tracking that's set by interactive sections
 * to provide context about where the user is in an interactive document.
 *
 * @returns Step context properties or empty object if not in an interactive document
 */
export function getCurrentStepContext(): Record<string, number> {
  try {
    const stepIndex = (window as any).__DocsPluginCurrentStepIndex as number | undefined;
    const totalSteps = (window as any).__DocsPluginTotalSteps as number | undefined;

    if (stepIndex === undefined || totalSteps === undefined) {
      return {};
    }

    const completionPercentage = calculateStepCompletion(stepIndex, totalSteps);

    return {
      current_step: stepIndex + 1, // 1-indexed for analytics
      total_document_steps: totalSteps,
      ...(completionPercentage !== undefined && { completion_percentage: completionPercentage }),
    };
  } catch {
    return {};
  }
}

/**
 * Enriches analytics properties with current step context if available
 *
 * This helper adds step position information to events like OpenExtraResource
 * to track what step the user was on when they navigated away or clicked a link.
 *
 * @param baseProperties - Base properties for the analytics event
 * @returns Enriched properties with step context if available
 *
 * @example
 * ```typescript
 * reportAppInteraction(
 *   UserInteraction.OpenExtraResource,
 *   enrichWithStepContext({
 *     content_url: url,
 *     link_type: 'external',
 *   })
 * );
 * ```
 */
export function enrichWithStepContext(
  baseProperties: Record<string, string | number | boolean>
): Record<string, string | number | boolean> {
  const stepContext = getCurrentStepContext();

  // Only add step context if it exists (non-empty object)
  if (Object.keys(stepContext).length > 0) {
    return { ...baseProperties, ...stepContext };
  }

  return baseProperties;
}

// ============================================================================
// ASSISTANT INTEGRATION ANALYTICS HELPERS
// ============================================================================

/**
 * Context information for assistant customizable elements
 */
export interface AssistantCustomizableContext {
  assistantId: string;
  assistantType: string;
  contentKey: string;
  inline: boolean;
}

/**
 * Builds analytics properties for assistant customizable interactions
 *
 * @param context - The customizable element context
 * @param additionalProps - Additional properties to include
 * @returns Properties object ready for reportAppInteraction
 *
 * @example
 * ```typescript
 * reportAppInteraction(
 *   UserInteraction.AssistantCustomizeClick,
 *   buildAssistantCustomizableProperties(
 *     { assistantId, assistantType, contentKey, inline },
 *     { datasource_type: 'prometheus' }
 *   )
 * );
 * ```
 */
export function buildAssistantCustomizableProperties(
  context: AssistantCustomizableContext,
  additionalProps: Record<string, string | number | boolean> = {}
): Record<string, string | number | boolean> {
  const { assistantId, assistantType, contentKey, inline } = context;
  const docInfo = getSourceDocument(assistantId);

  return {
    ...docInfo,
    assistant_id: assistantId,
    assistant_type: assistantType,
    content_key: contentKey,
    display_mode: inline ? 'inline' : 'block',
    ...additionalProps,
  };
}

/**
 * Context information for assistant text selection
 */
export interface AssistantTextSelectionContext {
  selectedText: string;
  selectionLength: number;
  buttonPlacement: 'top' | 'bottom';
}

/**
 * Builds analytics properties for assistant text selection interactions
 *
 * @param context - The text selection context
 * @param additionalProps - Additional properties to include
 * @returns Properties object ready for reportAppInteraction
 *
 * @example
 * ```typescript
 * reportAppInteraction(
 *   UserInteraction.AssistantAskButtonClick,
 *   buildAssistantTextSelectionProperties({
 *     selectedText: 'How do I query metrics?',
 *     selectionLength: 25,
 *     buttonPlacement: 'top'
 *   })
 * );
 * ```
 */
export function buildAssistantTextSelectionProperties(
  context: AssistantTextSelectionContext,
  additionalProps: Record<string, string | number | boolean> = {}
): Record<string, string | number | boolean> {
  const { selectedText, selectionLength, buttonPlacement } = context;
  const docInfo = getSourceDocument();

  // Truncate selected text for analytics (avoid sending very long text)
  const truncatedText = selectedText.length > 100 ? selectedText.substring(0, 100) + '...' : selectedText;

  return {
    ...docInfo,
    selected_text_preview: truncatedText,
    selection_length: selectionLength,
    button_placement: buttonPlacement,
    ...additionalProps,
  };
}
