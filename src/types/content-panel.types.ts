/**
 * Content panel and tab-related type definitions
 * Centralized types for tab management and panel state
 */

import { SceneObject, SceneObjectState } from '@grafana/scenes';
import { RawContent, LearningJourneyMetadata, Milestone } from './content.types';
import { DocsPluginConfig } from '../constants';

/**
 * Resolved milestone context for path-type packages.
 * Stored on the tab so milestone arrow navigation can rebuild
 * learningJourney metadata after fetching each milestone's content.
 */
export interface PathContext {
  learningJourney: LearningJourneyMetadata;
}

/**
 * Captured at decision time so the implied-0th-step prompt is stable across
 * subsequent location changes. Set on the tab when the alignment evaluator
 * decides a prompt is needed; cleared on confirm or dismiss.
 *
 * The renderer shows `<AlignmentPrompt>` as a banner above `<ContentRenderer>`
 * so the user can see the guide they're about to start. While present, the
 * renderer wraps content in `AlignmentPendingContext.Provider` (Tier 1) which
 * gates `useStepChecker.isEligibleForChecking` — preventing step 1 from
 * racing the redirect decision and showing a redundant "Fix this".
 *
 * @see src/recovery/alignment-evaluator.ts
 * @see src/global-state/alignment-pending-context.ts
 */
export interface PendingAlignment {
  startingLocation: string;
  currentPath: string;
  launchSource: string;
  /** ms epoch — used to compute prompt latency in telemetry */
  decidedAt: number;
}

/**
 * Learning Path or Documentation Tab
 * Represents an open tab in the docs panel
 */
export interface LearningJourneyTab {
  id: string;
  title: string;
  baseUrl: string;
  currentUrl: string;
  content: RawContent | null;
  isLoading: boolean;
  error: string | null;
  type?: 'learning-journey' | 'docs' | 'devtools' | 'interactive' | 'editor';
  packageInfo?: PackageOpenInfo;
  /** Cached milestone data from initial path package load, used to persist
   *  learningJourney metadata across milestone arrow navigation. */
  pathContext?: PathContext;
  /** Set when the implied-0th-step alignment check decides a prompt is needed. */
  pendingAlignment?: PendingAlignment;
}

/**
 * Persisted tab data for storage
 * Used to restore tabs across sessions
 */
export interface PersistedTabData {
  id: string;
  title: string;
  baseUrl: string;
  currentUrl?: string; // The specific milestone/page URL user was viewing (optional for backward compatibility)
  type?: 'learning-journey' | 'docs' | 'devtools' | 'interactive' | 'editor';
  packageInfo?: PackageOpenInfo;
}

export interface PackageOpenInfo {
  packageId?: string;
  packageManifest?: Record<string, unknown>;
  /** Pre-resolved milestones from context panel to avoid redundant resolution in fetchPackageContent */
  resolvedMilestones?: Milestone[];
}

export interface ContextPanelState extends SceneObjectState {
  onOpenLearningJourney?: (url: string, title: string) => void;
  onOpenDocsPage?: (url: string, title: string, packageInfo?: PackageOpenInfo) => void;
  onOpenEditor?: () => void;
}

/**
 * Combined panel state for the docs panel scene object
 */
export interface CombinedPanelState extends SceneObjectState {
  tabs: LearningJourneyTab[];
  activeTabId: string;
  contextPanel: SceneObject<ContextPanelState>;
  pluginConfig: DocsPluginConfig;
}
