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
