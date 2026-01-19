/**
 * Content panel and tab-related type definitions
 * Centralized types for tab management and panel state
 */

import { SceneObjectState } from '@grafana/scenes';
import { RawContent } from '../docs-retrieval/content.types';
import { DocsPluginConfig } from '../constants';
import { ContextPanel } from '../components/docs-panel/context-panel';

/**
 * Learning Journey or Documentation Tab
 * Represents an open tab in the docs panel
 */
export interface LearningJourneyTab {
  id: string;
  title: string;
  baseUrl: string;
  currentUrl: string; // The specific milestone/page URL currently loaded
  content: RawContent | null; // Unified content type
  isLoading: boolean;
  error: string | null;
  type?: 'learning-journey' | 'docs' | 'devtools' | 'interactive';
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
  type?: 'learning-journey' | 'docs' | 'devtools' | 'interactive';
}

/**
 * Combined panel state for the docs panel scene object
 */
export interface CombinedPanelState extends SceneObjectState {
  tabs: LearningJourneyTab[];
  activeTabId: string;
  contextPanel: ContextPanel;
  pluginConfig: DocsPluginConfig;
}
