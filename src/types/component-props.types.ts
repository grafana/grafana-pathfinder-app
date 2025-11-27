/**
 * Component prop type definitions
 * Centralized prop interfaces for components used across the application
 */

import React from 'react';

// ============================================================================
// INTERACTIVE COMPONENT PROPS
// ============================================================================

/**
 * Base props shared by all interactive components
 */
export interface BaseInteractiveProps {
  requirements?: string;
  objectives?: string;
  hints?: string;
  onComplete?: () => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Props for InteractiveStep component
 * Single interactive step with show/do buttons
 */
export interface InteractiveStepProps extends BaseInteractiveProps {
  targetAction: 'button' | 'highlight' | 'formfill' | 'navigate' | 'sequence' | 'hover' | 'noop';
  refTarget: string;
  targetValue?: string;
  postVerify?: string;
  targetComment?: string;
  doIt?: boolean; // Control whether "Do it" button appears (defaults to true)
  showMe?: boolean; // Control whether "Show me" button appears (defaults to true)
  showMeText?: string; // Optional text override for the "Show me" button
  skippable?: boolean; // Whether this step can be skipped if requirements fail
  completeEarly?: boolean; // Whether to mark complete before action execution (for navigation steps)
  title?: string;
  description?: string;
  children?: React.ReactNode;

  // Unified state management props (added by parent)
  stepId?: string;
  isEligibleForChecking?: boolean;
  isCompleted?: boolean;
  isCurrentlyExecuting?: boolean;
  onStepComplete?: (stepId: string) => void;
  onStepReset?: (stepId: string) => void; // Signal to parent that step should be reset
  resetTrigger?: number; // Signal from parent to reset local completion state

  // Step position tracking for analytics (added by section)
  stepIndex?: number; // 0-indexed position in section (0, 1, 2, etc.)
  totalSteps?: number; // Total number of steps in the section
  sectionId?: string; // Section identifier for analytics
  sectionTitle?: string; // Human-readable section title for analytics
}

/**
 * Props for InteractiveSection component
 * Container for multiple interactive steps
 */
export interface InteractiveSectionProps extends BaseInteractiveProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  isSequence?: boolean;
  id?: string; // HTML id attribute for section identification
  skippable?: boolean; // Whether this section can be skipped if requirements fail
}

/**
 * Step info for unified state management
 * Internal type used by InteractiveSection to track steps
 */
export interface StepInfo {
  stepId: string;
  element: React.ReactElement<InteractiveStepProps> | React.ReactElement<any>;
  index: number;
  targetAction?: string; // Optional for multi-step and guided
  refTarget?: string; // Optional for multi-step and guided
  targetValue?: string;
  targetComment?: string; // Optional comment to show during execution
  requirements?: string;
  postVerify?: string;
  skippable?: boolean; // Whether this step can be skipped
  showMe?: boolean; // Whether to show the "Show me" button and phase
  isMultiStep: boolean; // Flag to identify component type
  isGuided: boolean; // Flag to identify guided (user-performed) steps
}

// ============================================================================
// DOCS COMPONENT PROPS
// ============================================================================

/**
 * Props for CodeBlock component
 */
export interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
  showLineNumbers?: boolean;
  highlightLines?: number[];
  className?: string;
}

/**
 * Props for ImageRenderer component
 */
export interface ImageRendererProps {
  src: string;
  alt?: string;
  title?: string;
  width?: number;
  height?: number;
  className?: string;
}

/**
 * Props for VideoRenderer component
 */
export interface VideoRendererProps {
  src: string;
  title?: string;
  className?: string;
}

/**
 * Props for YouTubeVideoRenderer component
 */
export interface YouTubeVideoRendererProps {
  videoId: string;
  title?: string;
  className?: string;
}

/**
 * Props for ExpandableTable component
 */
export interface ExpandableTableProps {
  headers: string[];
  rows: string[][];
  className?: string;
}

/**
 * Props for SideJourneyLink component
 */
export interface SideJourneyLinkProps {
  link: string;
  title: string;
  className?: string;
}

/**
 * Props for ContentParsingError component
 */
export interface ContentParsingErrorProps {
  error: string;
  details?: string;
  onRetry?: () => void;
  className?: string;
}

// ============================================================================
// UTILITY COMPONENT PROPS
// ============================================================================

/**
 * Props for URLTester component
 */
export interface URLTesterProps {
  className?: string;
}

/**
 * Props for SkeletonLoader component
 */
export interface SkeletonLoaderProps {
  type?: 'learning-journey' | 'documentation' | 'generic';
  className?: string;
}

/**
 * Props for SelectorDebugPanel component
 */
export interface SelectorDebugPanelProps {
  className?: string;
}

/**
 * Props for FeedbackButton component
 */
export interface FeedbackButtonProps {
  contentUrl: string;
  contentType: 'learning-journey' | 'docs';
  interactionLocation: string;
  currentMilestone?: number;
  totalMilestones?: number;
  variant?: 'primary' | 'secondary';
  className?: string;
}

/**
 * Props for EnableRecommenderBanner component
 */
export interface EnableRecommenderBannerProps {
  onDismiss?: () => void;
  className?: string;
}

/**
 * Props for HelpFooter component
 */
export interface HelpFooterProps {
  className?: string;
}

// ============================================================================
// CONFIG COMPONENT PROPS
// ============================================================================

/**
 * Base type for AppConfig prop types
 * These extend PluginConfigPageProps from @grafana/data
 */
export interface AppConfigProps {
  // Extends PluginConfigPageProps<AppPluginMeta<JsonData>>
  // Actual definition kept in component file for Grafana dependency
}

export interface ConfigurationFormProps {
  // Extends PluginConfigPageProps<AppPluginMeta<JsonData>>
  // Actual definition kept in component file for Grafana dependency
}

export interface InteractiveFeaturesProps {
  // Extends PluginConfigPageProps<AppPluginMeta<JsonData>>
  // Actual definition kept in component file for Grafana dependency
}

export interface TermsAndConditionsProps {
  // Extends PluginConfigPageProps<AppPluginMeta<JsonData>>
  // Actual definition kept in component file for Grafana dependency
}
