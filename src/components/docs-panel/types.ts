/**
 * Type definitions for extracted docs-panel components
 */

import { RefObject } from 'react';
import { GrafanaTheme2 } from '@grafana/data';
import { LearningJourneyTab, PackageOpenInfo } from '../../types/content-panel.types';
import { RawContent } from '../../types/content.types';
import type { LaunchSource } from '../../recovery';

/**
 * Options for opening a guide or docs page in a tab.
 *
 * `source` should be supplied by every call site so the implied-0th-step
 * alignment evaluator can classify the launch correctly. Omitting it means
 * the evaluator falls through to "needs check" — which is safe by default
 * (it only surfaces a prompt the user can dismiss) but tends to mask bugs:
 * a missed source produces spurious prompts that are hard to reproduce.
 *
 * Prefer `options.source` over the legacy `_recordAutoLaunchSource()` flag
 * for new code. The flag is retained for callers that cross a callback
 * boundary (e.g. `ContextPanel`'s callbacks have a fixed signature owned by
 * a third party) and for events whose `source` is supplied by a remote
 * dispatcher. `loadTab` accepts `source` too, so callers that bypass the
 * public open methods no longer need the flag.
 */
export interface OpenDocsOptions {
  source?: LaunchSource;
  /** Skip the "Ready to begin?" gate (devtools / dev-mode preview). */
  skipReadyToBegin?: boolean;
  /** Optional package context for bundled or remote package guides. */
  packageInfo?: PackageOpenInfo;
  /**
   * Content already fetched + snippet-expanded by `prepareGuideLaunch`. When
   * present the loader skips its network fetch (one-fetch launch) but runs the
   * identical finalization, so alignment / journey / package parity holds.
   * One-shot memory state — never persisted to tab storage.
   */
  preparedContent?: RawContent;
}

/** @see OpenDocsOptions */
export interface OpenLearningJourneyOptions {
  source?: LaunchSource;
  /** @see OpenDocsOptions.preparedContent */
  preparedContent?: RawContent;
  /** @see OpenDocsOptions.packageInfo */
  packageInfo?: PackageOpenInfo;
}

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
  openLearningJourney(url: string, title?: string, options?: OpenLearningJourneyOptions): Promise<string>;

  /** Open a docs page in a new tab */
  openDocsPage(url: string, title?: string, options?: OpenDocsOptions): Promise<string>;

  /**
   * Unified tab loader. Dispatches to the docs/package pipeline or the guide
   * pipeline based on the tab's shape and the optional `packageInfo` input.
   *
   * `source` classifies the launch for the implied-0th-step alignment
   * evaluator, the same way `openDocsPage`'s `source` does. Only the docs
   * branch consumes it; the guide branch ignores it.
   */
  loadTab(
    tabId: string,
    url: string,
    options?: {
      skipReadyToBegin?: boolean;
      packageInfo?: PackageOpenInfo;
      prefetched?: RawContent;
      source?: LaunchSource;
    }
  ): Promise<void>;

  /** Close a tab by ID */
  closeTab(tabId: string): void;

  /** Set the active tab by ID */
  setActiveTab(tabId: string): void;

  /** Navigate to the next milestone in the current learning path */
  navigateToNextMilestone(): Promise<void>;

  /** Navigate to the previous milestone in the current learning path */
  navigateToPreviousMilestone(): Promise<void>;

  /** Check if navigation to next milestone is possible */
  canNavigateNext(): boolean;

  /** Check if navigation to previous milestone is possible */
  canNavigatePrevious(): boolean;

  /** Open the dev tools tab (or switch to it if already open) */
  openDevToolsTab(): void;

  /** Open the editor tab (or switch to it if already open) */
  openEditorTab(): void;

  /** Update the editor tab's strip title from the working guide */
  updateEditorTabTitle(title: string): void;

  /** Get the currently active tab */
  getActiveTab(): LearningJourneyTab | null;

  /** Accept the implied-0th-step alignment prompt for a tab */
  confirmAlignment(tabId: string): Promise<void>;

  /** Dismiss the implied-0th-step alignment prompt for a tab */
  dismissAlignment(tabId: string): void;

  /**
   * Record the launch source for the next `loadDocsTabContent` call so the
   * implied-0th-step evaluator classifies it correctly. Consumed once by the
   * loader; leaving it unset risks a spurious alignment prompt.
   *
   * @deprecated Prefer the `source` option on `openDocsPage`,
   * `openLearningJourney`, or `loadTab`. Retained only for callers that cross
   * a callback boundary owned elsewhere (e.g. `ContextPanel`'s recommender
   * callbacks), where no signature can carry the source.
   */
  _recordAutoLaunchSource(source: LaunchSource | null): void;
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
  contentRef: RefObject<HTMLDivElement | null>;

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
