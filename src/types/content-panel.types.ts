/**
 * Content panel and tab-related type definitions
 * Centralized types for tab management and panel state
 */

import { SceneObject, SceneObjectState } from '@grafana/scenes';
import { RawContent, LearningJourneyMetadata, Milestone } from './content.types';
import { PathfinderPluginConfig } from '../constants';

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
export type LearningJourneyTabType =
  'recommendations' | 'learning-journey' | 'docs' | 'devtools' | 'interactive' | 'editor';

export interface LearningJourneyTab {
  id: string;
  type: LearningJourneyTabType;
  title: string;
  baseUrl: string;
  currentUrl: string;
  content: RawContent | null;
  isLoading: boolean;
  error: string | null;
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
  /** Optional for records written before tab kind became a required runtime invariant. */
  type?: LearningJourneyTabType;
  packageInfo?: PackageOpenInfo;
}

export interface PackageOpenInfo {
  packageId?: string;
  packageManifest?: Record<string, unknown>;
  /** Recommendation-level repository (sibling of manifest in the V1 wire shape;
   *  V1PackageManifest carries no repository of its own). Threaded to the durable
   *  completion key so real V1 / online-cdn guides persist under their true source. */
  repository?: string;
  /** Pre-resolved milestones from context panel to avoid redundant resolution in fetchPackageContent */
  resolvedMilestones?: Milestone[];
  /** Launching surface, for context-panel sections that are not the recommender.
   *  Narrowed with `coerceLaunchSource` at the launch boundary (Tier 0 cannot import it). */
  launchSource?: string;
}

export interface ContextPanelState extends SceneObjectState {
  onOpenLearningJourney?: (url: string, title: string) => void;
  onOpenDocsPage?: (url: string, title: string, packageInfo?: PackageOpenInfo) => void;
  onOpenEditor?: () => void;
  recommendationsReady?: boolean;
}

/**
 * Combined panel state for the docs panel scene object
 */
export interface CombinedPanelState extends SceneObjectState {
  tabs: LearningJourneyTab[];
  activeTabId: string;
  contextPanel: SceneObject<ContextPanelState>;
  pluginConfig: PathfinderPluginConfig;
}
