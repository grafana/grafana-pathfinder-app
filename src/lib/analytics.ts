/**
 * Analytics tracking utilities for the Grafana Docs Plugin
 *
 * This module handles all user interaction tracking and analytics reporting.
 * It provides structured event reporting to Rudder Stack via Grafana's runtime.
 */

import { reportInteraction } from '@grafana/runtime';
import packageJson from '../../package.json';
import { isInteractiveLearningUrl } from '../security/url-validator';
// Bridge, not the Faro adapter: analytics is entry-eager and a direct
// adapter import would pull the telemetry package into module.js.
import { pushFaroUserAction } from './telemetry/bridge';
// url.ts is a dependency-free redactor (no Faro SDK import), safe to import
// directly even from this entry-eager module.
import { normalizeTelemetryUrl } from './telemetry/url';
import { logger } from './logging';
import type { ExperimentConfig, ExperimentAnalyticsEntry } from '../utils/openfeature';

type GetActiveExperimentsFn = () => ExperimentAnalyticsEntry[];
let _getActiveExperiments: GetActiveExperimentsFn | null = null;

/**
 * Late-binds the active-experiments provider after OpenFeature initializes.
 * Called from module.tsx to break the static import chain that would otherwise
 * pull the entire OpenFeature SDK into the entry-point bundle.
 */
export function bindExperimentsProvider(fn: GetActiveExperimentsFn): void {
  _getActiveExperiments = fn;
}

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
  ResetProgressClick = 'reset_progress_click',

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

  // Input Block Interactions
  InputBlockSubmit = 'input_block_submit',

  // Floating Panel
  FloatingPanelPopOut = 'floating_panel_pop_out',
  FloatingPanelDock = 'floating_panel_dock',
  FloatingPanelCopyLink = 'floating_panel_copy_link',
  FloatingPanelMoved = 'floating_panel_moved',

  // Full Screen
  FullScreenEnter = 'full_screen_enter',
  FullScreenExit = 'full_screen_exit',
  FullScreenCopyLink = 'full_screen_copy_link',

  // Access Control
  NoAccess = 'no_access',

  // Kiosk Mode
  KioskDemoStarted = 'kiosk_demo_started',

  // Initial-state alignment ("implied 0th step") — Phase 1 auto-recovery
  AlignmentPromptShown = 'alignment_prompt_shown',
  AlignmentPromptConfirmed = 'alignment_prompt_confirmed',
  AlignmentPromptDismissed = 'alignment_prompt_dismissed',

  // AI auto-heal
  AiFixOffered = 'ai_fix_offered',
  AiFixAccepted = 'ai_fix_accepted',
  AiFixApplied = 'ai_fix_applied',
  AiFixFailed = 'ai_fix_failed',
}

// ============================================================================
// STANDARDIZED ATTRIBUTE VALUES
// ============================================================================

export enum AnalyticsContentType {
  Docs = 'docs',
  LearningJourney = 'learning-journey',
  InteractiveGuide = 'interactive-guide',
  Editor = 'editor',
  Devtools = 'devtools',
  PackageNavLink = 'package-nav-link',
}

export enum AnalyticsLinkType {
  BundledInteractive = 'bundled_interactive',
  Tutorial = 'tutorial',
  Docs = 'docs',
  InteractiveLearning = 'interactive_learning',
  ExternalBrowser = 'external_browser',
  SideJourney = 'side_journey',
  SideJourneyExternal = 'side_journey_external',
  RelatedJourney = 'related_journey',
  RelatedJourneyExternal = 'related_journey_external',
}

// ============================================================================
// CORE ANALYTICS FUNCTIONS
// ============================================================================

/**
 * Creates a properly namespaced interaction name for Grafana analytics
 */
export const createInteractionName = (type: UserInteraction): string => {
  return `pathfinder_${type}`;
};

function getExperimentsForAnalytics(): ExperimentAnalyticsEntry[] | null {
  if (!_getActiveExperiments) {
    return null;
  }
  try {
    return _getActiveExperiments();
  } catch {
    return null;
  }
}

function rollUpVariant(experiments: ExperimentAnalyticsEntry[]): ExperimentConfig['variant'] {
  if (experiments.some((experiment) => experiment.variant === 'treatment')) {
    return 'treatment';
  }
  if (experiments.some((experiment) => experiment.variant === 'control')) {
    return 'control';
  }
  return 'excluded';
}

/**
 * Determines the appropriate content_type for analytics based on URL
 *
 * The interactive-learning CDN heuristic only upgrades the default Docs
 * fallback — an explicit tab/manifest-derived type (e.g. learning-journey
 * for `-lj` packages served from the CDN) always wins.
 */
export function getContentTypeForAnalytics(
  url: string | undefined | null,
  fallbackType: AnalyticsContentType = AnalyticsContentType.Docs
): AnalyticsContentType {
  if (fallbackType === AnalyticsContentType.Docs && url && isInteractiveLearningUrl(url)) {
    return AnalyticsContentType.InteractiveGuide;
  }
  return fallbackType;
}

const TAB_TYPE_TO_CONTENT_TYPE: Record<string, AnalyticsContentType> = {
  docs: AnalyticsContentType.Docs,
  'learning-journey': AnalyticsContentType.LearningJourney,
  devtools: AnalyticsContentType.Devtools,
  editor: AnalyticsContentType.Editor,
  interactive: AnalyticsContentType.InteractiveGuide,
};

/**
 * Maps a tab/content `type` string (e.g. `LearningJourneyTab.type`) onto the
 * canonical `AnalyticsContentType` used for the `content_type` property.
 * Centralizes the 'interactive' -> 'interactive-guide' mapping so every call
 * site reports the same content_type for the same kind of tab.
 */
export function tabTypeToContentType(tabType: string | undefined): AnalyticsContentType {
  return (tabType && TAB_TYPE_TO_CONTENT_TYPE[tabType]) || AnalyticsContentType.Docs;
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
    const activeExperiments = shouldEnrichWithExperiments ? getExperimentsForAnalytics() : null;
    const experiments = activeExperiments && activeExperiments.length > 0 ? activeExperiments : null;
    const variant = experiments ? rollUpVariant(experiments) : null;

    const kioskSessionId = (window as any).__pathfinderKioskSessionId as string | undefined;

    const enrichedProperties: Record<string, unknown> = {
      plugin_version: packageJson.version,
      ...properties,
      ...(variant && { variant }),
      ...(experiments && { experiments }),
      ...(kioskSessionId && { kiosk_session_id: kioskSessionId }),
    };

    try {
      reportInteraction(interactionName, enrichedProperties);
    } finally {
      // Mirrors every analytics event into Faro as a User Action (same name,
      // copied properties) so the two pipelines can be cross-checked against
      // each other. The finally keeps the mirror alive when reportInteraction
      // itself throws — a lost RudderStack event is exactly the divergence the
      // mirror exists to surface. pushFaroUserAction never throws.
      // `experiments` is carried once per session (lib/telemetry/session)
      // instead of on every mirrored action; RudderStack keeps it.
      const faroProperties = { ...enrichedProperties };
      delete faroProperties.experiments;
      // RudderStack properties are never redacted (first-party, same policy
      // as identity), but the Faro mirror is the final URL boundary for this
      // path — normalize by the `*_url` naming convention every call site
      // already follows, so query/fragment data never reaches Faro raw.
      for (const key of Object.keys(faroProperties)) {
        const value = faroProperties[key];
        if (typeof value === 'string' && /url$/i.test(key)) {
          faroProperties[key] = normalizeTelemetryUrl(value);
        }
      }
      pushFaroUserAction(interactionName, faroProperties);
    }
  } catch (error) {
    logger.warn('Analytics reporting failed', { error });
  }
}

// ============================================================================
// SCROLL TRACKING FUNCTIONALITY
// ============================================================================

/**
 * Type definition for tabs compatible with scroll tracking
 */
export interface ScrollTrackingTab {
  type?: 'docs' | 'learning-journey' | 'devtools' | 'interactive' | 'editor';
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

// Global tracking sets to prevent duplicate events across all instances
const scrolledPages = new Set<string>();
const bottomReachedPages = new Set<string>();

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

      // Exit early if no valid page identifier
      if (!pageIdentifier) {
        return;
      }

      // Track "started scrolling" - fires once per document with scrolled_to_bottom: false
      if (!scrolledPages.has(pageIdentifier)) {
        scrolledPages.add(pageIdentifier);
        const properties = buildScrollEventProperties(activeTab, isRecommendationsTab, pageIdentifier);
        reportAppInteraction(UserInteraction.PanelScroll, { ...properties, scrolled_to_bottom: false });
      }

      // Track "reached bottom" - fires once per document with scrolled_to_bottom: true
      if (!bottomReachedPages.has(pageIdentifier)) {
        const threshold = 50; // pixels from absolute bottom
        const isAtBottom =
          contentElement.scrollTop + contentElement.clientHeight >= contentElement.scrollHeight - threshold;

        if (isAtBottom) {
          bottomReachedPages.add(pageIdentifier);
          const properties = buildScrollEventProperties(activeTab, isRecommendationsTab, pageIdentifier);
          reportAppInteraction(UserInteraction.PanelScroll, { ...properties, scrolled_to_bottom: true });
        }
      }
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

  // Helper to check if tab is docs-like (docs or interactive)
  const isDocsLike = activeTab.type === 'docs' || activeTab.type === 'interactive';

  // For docs and interactive tabs, use the content URL or fallback to currentUrl/baseUrl
  if (isDocsLike) {
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
  // Matches determinePageIdentifier's treatment of a missing type as a learning journey,
  // so page_type and content_type never diverge for the same tab.
  const tabTypeFallback = activeTab?.type || AnalyticsContentType.LearningJourney;
  const pageType = isRecommendationsTab ? 'recommendations' : tabTypeFallback;

  const properties: Record<string, string | number | boolean> = {
    page_type: pageType,
    content_url: pageIdentifier,
    content_type: isRecommendationsTab ? '' : tabTypeToContentType(tabTypeFallback),
  };

  // Add additional context for learning journeys
  if (activeTab?.type === 'learning-journey' && activeTab?.content?.metadata?.learningJourney) {
    const { currentMilestone, totalMilestones } = activeTab.content.metadata.learningJourney;
    return { ...properties, ...journeyProgressProperties(currentMilestone || 0, totalMilestones || 0) };
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
  bottomReachedPages.clear();
}

// ============================================================================
// LEARNING JOURNEY ANALYTICS HELPERS
// ============================================================================

/**
 * Content interface compatible with journey progress calculations
 * Accepts both RawContent and legacy content formats
 */
export interface JourneyContent {
  type?: 'learning-journey' | 'docs' | 'single-doc' | 'interactive'; // Include single-doc and interactive for RawContent compatibility
  metadata?: {
    learningJourney?: {
      currentMilestone?: number;
      totalMilestones?: number;
    };
  };
}

/**
 * Canonical progress trio shared by learning journeys and interactive guides.
 *
 * `completion_percentage` semantics differ by content kind (journeys:
 * position-based; guides: completed-steps based), so it is always supplied
 * by the caller rather than derived from step/total here.
 */
export function buildProgressProperties(
  step?: number,
  total?: number,
  completionPercentage?: number
): Record<string, number> {
  if (step === undefined || total === undefined) {
    return {};
  }

  return {
    progress_step: step,
    progress_total: total,
    ...(completionPercentage !== undefined && { completion_percentage: completionPercentage }),
  };
}

/** Journey progress trio with position-based completion (milestone N of M). */
export function journeyProgressProperties(currentMilestone: number, totalMilestones: number): Record<string, number> {
  const percentage = totalMilestones > 0 ? Math.round((currentMilestone / totalMilestones) * 100) : 0;
  return buildProgressProperties(currentMilestone, totalMilestones, percentage);
}

/**
 * Extracts journey progress properties for analytics events
 *
 * @param content - The content object containing journey metadata
 * @returns Object with journey properties or empty object if not a journey
 */
export function getJourneyProperties(content: JourneyContent | null | undefined): Record<string, number> {
  if (!content || content.type !== 'learning-journey' || !content.metadata?.learningJourney) {
    return {};
  }

  const { currentMilestone, totalMilestones } = content.metadata.learningJourney;

  return journeyProgressProperties(currentMilestone || 0, totalMilestones || 0);
}

/**
 * Progress properties for a milestone arrow click, computed for the
 * destination milestone so progress_step and completion_percentage agree
 * within the event (a forward click onto the last milestone reports 100).
 */
export function getJourneyNavigationProperties(
  lj: { currentMilestone?: number; totalMilestones?: number } | undefined,
  direction: 'forward' | 'backward'
): Record<string, string | number> {
  const total = lj?.totalMilestones ?? 0;
  const current = lj?.currentMilestone ?? 0;
  const destination = direction === 'forward' ? Math.min(total, current + 1) : Math.max(0, current - 1);

  return { direction, ...journeyProgressProperties(destination, total) };
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
 *     link_type: AnalyticsLinkType.ExternalBrowser,
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
 * Interface for step context used in analytics
 */
export interface StepContext {
  stepId?: string;
  stepIndex?: number;
  totalSteps?: number;
  sectionId?: string;
  sectionTitle?: string;
  /** Completed-steps percentage from the completion store (monotonic), not the clicked step's position. */
  completionPercentage?: number;
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
  const { stepId, stepIndex, totalSteps, sectionId, sectionTitle, completionPercentage } = stepContext;

  const docInfo = getSourceDocument(stepId);

  return {
    ...docInfo,
    ...baseProperties,
    content_type: AnalyticsContentType.InteractiveGuide,
    ...buildProgressProperties(stepIndex !== undefined ? stepIndex + 1 : undefined, totalSteps, completionPercentage),
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

    return buildProgressProperties(stepIndex + 1, totalSteps);
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
 *     link_type: AnalyticsLinkType.ExternalBrowser,
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
