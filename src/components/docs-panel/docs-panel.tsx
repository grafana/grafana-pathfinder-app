// Combined Learning Journey and Docs Panel
// Post-refactoring unified component using new content system only

import React, { useEffect, useRef, useCallback, Suspense, lazy } from 'react';
import { SceneObjectBase, SceneComponentProps } from '@grafana/scenes';
import { useStyles2, useTheme2 } from '@grafana/ui';
// (Lazy Coda terminal imports retained below — the renderer still mounts the
//  terminal panel for dev-mode users.)

// Lazy load Coda Terminal to keep it out of production bundles
// Only loaded when dev mode is enabled and terminal feature is enabled
const TerminalPanel = lazy(() =>
  import('../../integrations/coda').then((module) => ({
    default: module.TerminalPanel,
  }))
);
const TerminalProviderLazy = lazy(() =>
  import('../../integrations/coda').then((module) => ({
    default: module.TerminalProvider,
  }))
);
// Lazy so @grafana/assistant stays out of the docs-panel init chain (see AiFixOrchestrator).
const AiFixOrchestrator = lazy(() => import('./AiFixOrchestrator'));
import { usePluginContext } from '@grafana/data';
import { DocsPluginConfig, getConfigWithDefaults } from '../../constants';

import { useInteractiveElements, NavigationManager } from '../../interactive-engine';
import { useKeyboardShortcuts } from './keyboard-shortcuts.hook';
import { useLinkClickHandler } from './link-handler.hook';
import { isDevModeEnabled } from '../../utils/dev-mode';

import {
  reportAppInteraction,
  UserInteraction,
  getContentTypeForAnalytics,
  AnalyticsContentType,
} from '../../lib/analytics';
import { logger } from '../../lib/logging';
import { withGuideOpenAction, type GuideLoadOutcome } from '../../lib/telemetry';
import { usePanelReadyMeasurement } from './hooks/usePanelReadyMeasurement';
import { tabStorage, useUserStorage } from '../../lib/user-storage';
import { useGuideProgressState, useAutoLaunchTutorial, type AutoLaunchTutorialDetail } from '../../hooks';
import {
  fetchContent,
  getNextMilestoneUrlFromContent,
  getPreviousMilestoneUrlFromContent,
  getJourneyProgress,
  setJourneyCompletionPercentage,
  setPackageResolver,
  injectJourneyExtrasIntoJsonGuide,
  fetchPackageInfoFromUrl,
  isPackageContentUrl,
} from '../../docs-retrieval';
import { createCompositeResolver } from '../../package-engine';

import { ContextPanel } from './context-panel';
import { BadgeUnlockedToast } from '../LearningPaths';
import { getBadgeById } from '../../learning-paths';

import { getStyles as getComponentStyles, addGlobalModalStyles } from '../../styles/docs-panel.styles';
import { journeyContentHtml, docsContentHtml } from '../../styles/content-html.styles';
import { getInteractiveStyles } from '../../styles/interactive.styles';
import { getPrismStyles } from '../../styles/prism.styles';
import { config, getAppEvents, locationService } from '@grafana/runtime';
import { evaluateAlignment, resolveStartingLocation, type LaunchSource } from '../../recovery';
import { SessionProvider, useSession, ActionReplaySystem, ActionCaptureSystem } from '../../integrations/workshop';
import { panelModeManager } from '../../global-state/panel-mode';
import { shouldOpenAsLearningJourney } from '../../utils/pathfinder-search-params';
import { testIds } from '../../constants/testIds';

// Import extracted components
import {
  ModalBackdrop,
  LiveSessionTopBar,
  DocsPanelTabBar,
  LiveSessionModals,
  DocsPanelContentArea,
} from './components';
// Import extracted utilities
import {
  shouldUseDocsLoader,
  restoreTabsFromStorage,
  restoreActiveTabFromStorage,
  loadDocsTabContentResult,
  PERMANENT_TAB_IDS,
  findCurrentMilestoneIndex,
} from './utils';
// Import extracted hooks
import {
  useBadgeCelebrationQueue,
  useTabOverflow,
  useScrollPositionPreservation,
  useContentReset,
  useDevModeLogger,
  usePanelMode,
  useSessionJoinUrlCheck,
  useLastMilestoneAutoComplete,
  useScrollTracking,
  useGlobalActiveTabExposure,
  useJourneyStepWeights,
  useAutoOpenListener,
  usePopOutHandoff,
  useFullScreenHandoff,
  usePermanentTabs,
  useTabRestoration,
} from './hooks';

// Import centralized types
import {
  LearningJourneyTab,
  PersistedTabData,
  CombinedPanelState,
  PackageOpenInfo,
} from '../../types/content-panel.types';
import { getPackageRenderType } from '../../types/package.types';
import type { DocsPanelModelOperations, OpenDocsOptions, OpenLearningJourneyOptions } from './types';

class CombinedLearningJourneyPanel extends SceneObjectBase<CombinedPanelState> implements DocsPanelModelOperations {
  public static Component = CombinedPanelRenderer;

  /**
   * Instance-level guard: prevents restoreTabsAsync() from running more than
   * once on the same instance (e.g. React StrictMode double-mount re-fires
   * the effect on the same cached useMemo panel). Because the flag is
   * per-instance, a genuinely new panel (created when the sidebar remounts
   * after toggle off → on) starts with the guard unset and can restore tabs.
   */
  private _hasRestoredTabs = false;

  /**
   * Transient launch-source carrier for the implied-0th-step alignment check.
   *
   * Set immediately before a `loadDocsTabContent` call so the loader can read
   * it after content fetch and classify the launch. There are two ways to
   * populate it:
   *
   *   1. Preferred: pass `{ source }` to `openDocsPage` /
   *      `openLearningJourney`. The wrapper records the source for you,
   *      keeping the contract visible at the call site.
   *   2. Legacy: call `_recordAutoLaunchSource(source)` directly, then call
   *      `openDocsPage` / `openLearningJourney` / `loadDocsTabContent`. Used
   *      where (a) a callback signature can't carry the source (e.g.
   *      `ContextPanel`'s recommender callbacks), or (b) `loadDocsTabContent`
   *      is called without going through the public open methods (e.g.
   *      `useContentReset`'s reload path).
   *
   * Mirrors the consume-once pattern in `sidebarState.consumePendingOpenSource`.
   */
  private _pendingLaunchSource: LaunchSource | null = null;

  public _recordAutoLaunchSource(source: LaunchSource | null): void {
    this._pendingLaunchSource = source;
  }

  private _consumeAutoLaunchSource(): LaunchSource | null {
    const s = this._pendingLaunchSource;
    this._pendingLaunchSource = null;
    return s;
  }

  public get renderBeforeActivation(): boolean {
    return true;
  }

  public constructor(pluginConfig: DocsPluginConfig = {}) {
    // Initialize with default tabs first
    const defaultTabs: LearningJourneyTab[] = [
      {
        id: 'recommendations',
        title: 'Recommendations',
        baseUrl: '',
        currentUrl: '',
        content: null,
        isLoading: false,
        error: null,
      },
    ];

    const contextPanel = new ContextPanel(
      (url: string, title: string) => {
        // Recommender is aligned-by-construction (URL-filtered guide list).
        // Tag the open so the implied-0th-step alignment evaluator skips
        // it; without this the source would consume as null and an
        // unrelated `home_page` source previously stashed could leak
        // through, prompting on a recommender click.
        return this.openLearningJourney(url, title, { source: 'recommender' });
      },
      (url: string, title: string, packageInfo?: PackageOpenInfo) => {
        return this.openDocsPage(url, title, { source: 'recommender', packageInfo });
      },
      () => this.openEditorTab()
    );

    super({
      tabs: defaultTabs,
      activeTabId: 'recommendations',
      contextPanel,
      pluginConfig,
    });

    // Wire the composite PackageResolver into docs-retrieval so that
    // fetchPackageContent() and fetchPackageById() can resolve bundled and
    // remote packages. This is the Tier 3/4 injection point described in Phase 4g.
    setPackageResolver(createCompositeResolver(pluginConfig));

    // Note: Tab restoration now happens from React component after storage is initialized
    // to avoid race condition with useUserStorage hook
  }

  public async restoreTabsAsync(): Promise<void> {
    // Guard: only restore once per model lifetime to prevent double-restore race condition
    // where a second restore (triggered by component remount or React Strict Mode) replaces
    // tabs that already had content loaded, leaving them in {content: null} blank state
    if (this._hasRestoredTabs) {
      return;
    }
    this._hasRestoredTabs = true;

    // Use extracted restore module with dev mode detection
    const currentUserId = config.bootData.user?.id;
    const pluginConfig = this.state.pluginConfig || {};
    const isDevMode = isDevModeEnabled(pluginConfig, currentUserId);

    const restoredTabs = await restoreTabsFromStorage(tabStorage, { isDevMode });
    const activeTabId = await restoreActiveTabFromStorage(tabStorage, restoredTabs);

    this.setState({
      tabs: restoredTabs,
      activeTabId,
    });

    // Initialize the active tab if needed
    this.initializeRestoredActiveTab();
  }

  private generateTabId(): string {
    return `tab-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  private initializeRestoredActiveTab(): void {
    const activeTab = this.state.tabs.find((t) => t.id === this.state.activeTabId);
    if (!activeTab || PERMANENT_TAB_IDS.has(activeTab.id)) {
      return;
    }

    if (!activeTab.content && !activeTab.isLoading && !activeTab.error) {
      // Tag the loader call so the implied-0th-step evaluator sees
      // `browser_restore` (an aligned-by-construction source) instead of an
      // undefined source. Without this, a restored tab whose path no longer
      // matches its guide's `startingLocation` would incorrectly trigger the
      // alignment prompt — second-guessing a user mid-tutorial, which is
      // exactly what `browser_restore` is meant to suppress. The unified
      // `loadTab` routes to the docs pipeline iff the tab needs it
      // (matches the old `shouldUseDocsLoader` branch).
      this._recordAutoLaunchSource('browser_restore');
      this.loadTab(activeTab.id, activeTab.currentUrl || activeTab.baseUrl);
    }
  }

  public async saveTabsToStorage(): Promise<void> {
    try {
      // Save user-opened tabs and devtools tab (devtools persists across refreshes)
      // Recommendations is a permanent tab and doesn't need persistence
      const tabsToSave: PersistedTabData[] = this.state.tabs
        .filter((tab) => tab.id !== 'recommendations')
        .map((tab) => ({
          id: tab.id,
          title: tab.title,
          baseUrl: tab.baseUrl,
          currentUrl: tab.currentUrl,
          type: tab.type,
          packageInfo: tab.packageInfo,
        }));

      // Save both tabs and active tab
      await Promise.all([tabStorage.setTabs(tabsToSave), tabStorage.setActiveTab(this.state.activeTabId)]);
    } catch (error) {
      logger.error('Failed to save tabs to storage', { error });
    }
  }

  public static async clearPersistedTabs(): Promise<void> {
    try {
      await tabStorage.clear();
    } catch (error) {
      logger.error('Failed to clear persisted tabs', { error });
    }
  }

  public async openLearningJourney(url: string, title?: string, options?: OpenLearningJourneyOptions): Promise<string> {
    // Package URLs always route through openDocsPage — that's the canonical
    // path that loads the manifest and chooses the render type from it.
    // Without this redirect, callers using the URL/handoff `?type=learning-journey`
    // hint would land here without the manifest, fetch via plain fetchContent,
    // and render as a "default doc" with no milestone toolbar.
    // See context-panel.tsx ("All packages route through openDocsPage").
    //
    // Forward `options` whole-cloth (rather than picking specific fields) so
    // any future addition to `OpenLearningJourneyOptions` reaches `openDocsPage`
    // automatically. `OpenLearningJourneyOptions` is structurally a subset of
    // `OpenDocsOptions`, so this assignment is type-safe.
    if (isPackageContentUrl(url)) {
      return this.openDocsPage(url, title, options);
    }
    // Honour an explicit options.source by recording it first, so any
    // legacy stash is overwritten and we have a single source of truth for
    // the drain below.
    if (options?.source) {
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- internal bridge to legacy flag (consume-once carrier)
      this._recordAutoLaunchSource(options.source);
    }
    // Drain any auto-launch source that the listener (or options.source above)
    // recorded before branching here. Learning journeys go through
    // `loadTabContent`, which never consumes `_pendingLaunchSource`, so
    // without this the value would leak to the next `loadDocsTabContent`
    // call (e.g. a subsequent recommender or tab-restore open) and
    // contaminate its alignment evaluation. Until learning journeys grow
    // their own implied-0th-step logic, we just drop the value.
    this._consumeAutoLaunchSource();

    const finalTitle = title || 'Learning path';
    const tabId = this.generateTabId();

    const newTab: LearningJourneyTab = {
      id: tabId,
      title: finalTitle,
      baseUrl: url,
      currentUrl: url,
      content: null,
      isLoading: true,
      error: null,
      type: 'learning-journey',
    };

    this.setState({
      tabs: [...this.state.tabs, newTab],
      activeTabId: tabId,
    });

    // Save tabs to storage immediately after creating
    this.saveTabsToStorage();

    // Route through the unified dispatcher so future docs-like or
    // package-backed learning-journey openings pick the docs loader
    // without an extra branch here.
    this.loadTab(tabId, url);

    return tabId;
  }

  private setTabLoading(tabId: string): void {
    const updatedTabs = this.state.tabs.map((t) => (t.id === tabId ? { ...t, isLoading: true, error: null } : t));
    this.setState({ tabs: updatedTabs });
  }

  private finishTabSuccess(
    tabId: string,
    buildPatch: (tab: LearningJourneyTab) => Partial<LearningJourneyTab>
  ): LearningJourneyTab | undefined {
    const finalUpdatedTabs = this.state.tabs.map((t) =>
      t.id === tabId ? { ...t, ...buildPatch(t), isLoading: false, error: null } : t
    );
    this.setState({ tabs: finalUpdatedTabs });
    this.saveTabsToStorage();
    return finalUpdatedTabs.find((t) => t.id === tabId);
  }

  private failTab(tabId: string, message: string): void {
    const errorUpdatedTabs = this.state.tabs.map((t) =>
      t.id === tabId ? { ...t, isLoading: false, error: message } : t
    );
    this.setState({ tabs: errorUpdatedTabs });
    this.saveTabsToStorage();
  }

  /**
   * Unified tab-loader entry point. Dispatches to the docs/package pipeline
   * or the guide pipeline based on the tab's shape and the optional
   * `packageInfo` input.
   */
  public async loadTab(
    tabId: string,
    url: string,
    options?: { skipReadyToBegin?: boolean; packageInfo?: PackageOpenInfo }
  ): Promise<void> {
    // Loaders resolve on failure (failTab stores the error in tab state), so
    // their returned outcome — not promise settlement — stamps the action.
    await withGuideOpenAction(url, async () => {
      const tab = this.state.tabs.find((t) => t.id === tabId);
      const needsDocsLoader = options?.packageInfo != null || (tab ? shouldUseDocsLoader(tab) : false);
      if (needsDocsLoader) {
        return this.loadDocsTabContent(tabId, url, options?.skipReadyToBegin, options?.packageInfo);
      }
      return this.loadTabContent(tabId, url);
    });
  }

  private async loadTabContent(tabId: string, url: string): Promise<GuideLoadOutcome> {
    // Empty/corrupted tab URL — nothing to load, and not a successful open.
    if (!url || url.trim() === '') {
      logger.error(`loadTabContent called with an empty URL for tab ${tabId}`);
      this.failTab(tabId, 'This tab has no content to load.');
      return 'error';
    }

    this.setTabLoading(tabId);

    try {
      const tab = this.state.tabs.find((t) => t.id === tabId);
      const result = await fetchContent(url);

      if (result.content) {
        let content = result.content;

        if (tab?.pathContext) {
          const currentMilestone = findCurrentMilestoneIndex(tab.pathContext.learningJourney.milestones, url);
          const learningJourney = {
            ...tab.pathContext.learningJourney,
            currentMilestone,
          };

          if (currentMilestone === 0) {
            content = {
              ...content,
              content: injectJourneyExtrasIntoJsonGuide(content.content, learningJourney),
            };
          }

          content = {
            ...content,
            type: 'learning-journey',
            metadata: {
              ...content.metadata,
              learningJourney,
              ...(tab.packageInfo?.packageManifest != null && {
                packageManifest: tab.packageInfo.packageManifest,
              }),
            },
          };
        }

        const updatedTab = this.finishTabSuccess(tabId, () => ({ content, currentUrl: url }));

        // Use learningJourney.baseUrl (the path's cover page URL) as the storage
        // key so it matches the key used by context.service.ts when reading
        // completion via getJourneyCompletionPercentageAsync(rec.contentUrl).
        if (updatedTab?.type === 'learning-journey' && updatedTab.content) {
          const progress = getJourneyProgress(updatedTab.content);
          const completionKey = updatedTab.content.metadata.learningJourney?.baseUrl || updatedTab.baseUrl;
          setJourneyCompletionPercentage(completionKey, progress);
        }
        return 'completed';
      } else {
        this.failTab(tabId, result.error || 'Failed to load content');
        return 'error';
      }
    } catch (error) {
      logger.error(`Failed to load journey content for tab ${tabId}`, { error });
      this.failTab(tabId, error instanceof Error ? error.message : 'Failed to load content');
      return 'error';
    }
  }

  public async confirmAlignment(tabId: string): Promise<void> {
    const tab = this.state.tabs.find((t) => t.id === tabId);
    const pending = tab?.pendingAlignment;
    if (!tab || !pending) {
      return;
    }

    reportAppInteraction(UserInteraction.AlignmentPromptConfirmed, {
      guide_url: tab.baseUrl || tab.currentUrl || '',
      guide_title: tab.title,
      launch_source: pending.launchSource,
      current_path: pending.currentPath,
      starting_location: pending.startingLocation,
      latency_ms: Date.now() - pending.decidedAt,
    });

    try {
      locationService.push(pending.startingLocation);
    } finally {
      this.setState({
        tabs: this.state.tabs.map((t) => (t.id === tabId ? { ...t, pendingAlignment: undefined } : t)),
      });
    }
  }

  public dismissAlignment(tabId: string): void {
    const tab = this.state.tabs.find((t) => t.id === tabId);
    const pending = tab?.pendingAlignment;
    if (!tab || !pending) {
      return;
    }

    reportAppInteraction(UserInteraction.AlignmentPromptDismissed, {
      guide_url: tab.baseUrl || tab.currentUrl || '',
      guide_title: tab.title,
      launch_source: pending.launchSource,
      current_path: pending.currentPath,
      starting_location: pending.startingLocation,
      latency_ms: Date.now() - pending.decidedAt,
    });

    this.setState({
      tabs: this.state.tabs.map((t) => (t.id === tabId ? { ...t, pendingAlignment: undefined } : t)),
    });
  }

  public closeTab(tabId: string) {
    if (tabId === 'recommendations') {
      return;
    }

    const currentTabs = this.state.tabs;
    const tabIndex = currentTabs.findIndex((t) => t.id === tabId);
    const newTabs = currentTabs.filter((t) => t.id !== tabId);
    let newActiveTabId = this.state.activeTabId;

    if (this.state.activeTabId === tabId) {
      if (tabIndex > 0 && tabIndex < currentTabs.length - 1) {
        newActiveTabId = currentTabs[tabIndex + 1]!.id;
      } else if (tabIndex > 0) {
        newActiveTabId = currentTabs[tabIndex - 1]!.id;
      } else {
        newActiveTabId = 'recommendations';
      }
    }

    const onlyDefaultTabsRemaining = newTabs.every((t) => PERMANENT_TAB_IDS.has(t.id));
    if (onlyDefaultTabsRemaining && this.state.activeTabId !== 'editor') {
      newActiveTabId = 'recommendations';
    }

    this.setState({
      tabs: newTabs,
      activeTabId: newActiveTabId,
    });

    this.saveTabsToStorage();
  }

  public setActiveTab(tabId: string) {
    this.setState({ activeTabId: tabId });

    // Save active tab to storage
    this.saveTabsToStorage();

    // Permanent tabs (recommendations, devtools, editor) render their own
    // content and have no URL to load — skip the content-loading path.
    if (PERMANENT_TAB_IDS.has(tabId)) {
      return;
    }

    // If switching to a tab that hasn't loaded content yet, load it
    const tab = this.state.tabs.find((t) => t.id === tabId);
    if (tab && !tab.isLoading && !tab.error && !tab.content) {
      this.loadTab(tabId, tab.currentUrl || tab.baseUrl);
    }
  }

  public async navigateToNextMilestone() {
    const activeTab = this.getActiveTab();
    if (activeTab && activeTab.content) {
      const nextUrl = getNextMilestoneUrlFromContent(activeTab.content);
      if (nextUrl) {
        // Unified dispatcher: package-backed journeys need the docs
        // loader so the next milestone re-resolves the manifest.
        this.loadTab(activeTab.id, nextUrl);
      }
    }
  }

  public async navigateToPreviousMilestone() {
    const activeTab = this.getActiveTab();
    if (activeTab && activeTab.content) {
      const prevUrl = getPreviousMilestoneUrlFromContent(activeTab.content);
      if (prevUrl) {
        this.loadTab(activeTab.id, prevUrl);
      }
    }
  }

  public getActiveTab(): LearningJourneyTab | null {
    return this.state.tabs.find((t) => t.id === this.state.activeTabId) || null;
  }

  public canNavigateNext(): boolean {
    const activeTab = this.getActiveTab();
    return activeTab?.content ? getNextMilestoneUrlFromContent(activeTab.content) !== null : false;
  }

  public canNavigatePrevious(): boolean {
    const activeTab = this.getActiveTab();
    return activeTab?.content ? getPreviousMilestoneUrlFromContent(activeTab.content) !== null : false;
  }

  /**
   * Open the Dev Tools tab (or switch to it if already open)
   * The devtools tab is now persisted to storage to survive page refreshes.
   */
  public openDevToolsTab(): void {
    // Check if devtools tab already exists
    const existingTab = this.state.tabs.find((t) => t.id === 'devtools');
    if (existingTab) {
      // Just switch to it
      this.setState({ activeTabId: 'devtools' });
      // Still save to storage to persist the active tab change
      this.saveTabsToStorage();
      return;
    }

    // Create new devtools tab
    const newTab: LearningJourneyTab = {
      id: 'devtools',
      title: 'Dev Tools',
      baseUrl: '',
      currentUrl: '',
      content: null,
      isLoading: false,
      error: null,
      type: 'devtools',
    };

    this.setState({
      tabs: [...this.state.tabs, newTab],
      activeTabId: 'devtools',
    });

    // Save tabs to storage so devtools tab persists across page refreshes
    this.saveTabsToStorage();
  }

  /**
   * Open the Editor tab (or switch to it if already open)
   */
  public openEditorTab(): void {
    const existingTab = this.state.tabs.find((t) => t.id === 'editor');
    if (existingTab) {
      this.setState({ activeTabId: 'editor' });
      this.saveTabsToStorage();
      return;
    }

    const newTab: LearningJourneyTab = {
      id: 'editor',
      title: 'Guide editor',
      baseUrl: '',
      currentUrl: '',
      content: null,
      isLoading: false,
      error: null,
      type: 'editor',
    };

    this.setState({
      tabs: [...this.state.tabs, newTab],
      activeTabId: 'editor',
    });

    this.saveTabsToStorage();
  }

  public async openDocsPage(url: string, title?: string, options?: OpenDocsOptions): Promise<string> {
    const { source, skipReadyToBegin, packageInfo } = options ?? {};

    // Make the launch source explicit at the call site if provided. This
    // narrows the surface area of the legacy `_recordAutoLaunchSource` flag —
    // a bug where a caller forgot to record before invoking this method
    // would now manifest as a missing `options.source` (visible in code
    // review) instead of a silent default-to-"needs-check".
    if (source) {
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- internal bridge to legacy flag (consume-once carrier)
      this._recordAutoLaunchSource(source);
    }

    const finalTitle = title || 'Documentation';
    const tabId = this.generateTabId();

    const newTab: LearningJourneyTab = {
      id: tabId,
      title: finalTitle,
      baseUrl: url,
      currentUrl: url,
      content: null,
      isLoading: true,
      error: null,
      type: packageInfo ? getPackageRenderType(packageInfo.packageManifest) : 'docs',
      packageInfo,
    };

    this.setState({
      tabs: [...this.state.tabs, newTab],
      activeTabId: tabId,
    });

    // Save tabs to storage immediately after creating
    this.saveTabsToStorage();

    this.loadTab(tabId, url, { skipReadyToBegin, packageInfo });

    return tabId;
  }

  private async loadDocsTabContent(
    tabId: string,
    url: string,
    skipReadyToBegin?: boolean,
    packageInfoArg?: PackageOpenInfo
  ): Promise<GuideLoadOutcome> {
    // No early return for empty URLs — loadDocsTabContentResult handles all
    // edge cases (empty URL with packageInfo falls back to fetchPackageById;
    // empty URL without packageInfo returns a visible error). Surfacing errors
    // is preferable to the old silent no-op for corrupted/restored tabs.

    this.setTabLoading(tabId);

    try {
      const launchSource = this._consumeAutoLaunchSource();
      let packageInfo = packageInfoArg ?? this.state.tabs.find((t) => t.id === tabId)?.packageInfo;
      // Auto-derive packageInfo when opening a package URL via deep-link or
      // handoff (no recommender). Without the manifest, downstream rendering
      // falls through to plain fetchContent and the milestone toolbar never
      // appears. See package-info-from-url.ts for the URL pattern.
      if (!packageInfo && isPackageContentUrl(url)) {
        packageInfo = await fetchPackageInfoFromUrl(url);
      }
      const result = await loadDocsTabContentResult(url, { skipReadyToBegin, packageInfo });

      // Check if fetch succeeded or failed
      if (result.content) {
        const fetchedContent = result.content;

        const pathContext = fetchedContent.metadata.learningJourney
          ? { learningJourney: fetchedContent.metadata.learningJourney }
          : undefined;

        // Implied 0th step: decide whether to prompt the user to navigate to
        // the guide's declared starting location before step 1 begins.
        const startingLocation = resolveStartingLocation(url, packageInfo?.packageManifest);
        const currentPath = locationService.getLocation().pathname;
        const evaluation = evaluateAlignment({
          currentPath,
          startingLocation,
          launchSource: launchSource ?? undefined,
        });
        const isFullScreenMode = panelModeManager.getMode() === 'fullscreen';
        const pendingAlignment =
          !isFullScreenMode && evaluation.shouldPrompt && startingLocation
            ? {
                startingLocation,
                currentPath,
                launchSource: launchSource ?? 'unknown',
                decidedAt: Date.now(),
              }
            : undefined;

        const finalTab = this.finishTabSuccess(tabId, (t) => ({
          content: fetchedContent,
          baseUrl: t.baseUrl || fetchedContent.url,
          currentUrl: fetchedContent.url || url,
          type:
            packageInfo != null
              ? getPackageRenderType(packageInfo.packageManifest)
              : fetchedContent.type === 'interactive'
                ? 'interactive'
                : t.type,
          packageInfo: packageInfo ?? t.packageInfo,
          pathContext,
          pendingAlignment,
        }));

        if (pendingAlignment) {
          reportAppInteraction(UserInteraction.AlignmentPromptShown, {
            guide_url: url,
            guide_title: finalTab?.title ?? '',
            launch_source: pendingAlignment.launchSource,
            current_path: pendingAlignment.currentPath,
            starting_location: pendingAlignment.startingLocation,
          });
        }
        return 'completed';
      } else {
        this.failTab(tabId, result.error || 'Failed to load documentation');
        return 'error';
      }
    } catch (error) {
      logger.error(`Failed to load docs content for tab ${tabId}`, { error });
      this.failTab(tabId, error instanceof Error ? error.message : 'Failed to load documentation');
      return 'error';
    }
  }
}

function CombinedPanelRendererInner({ model }: SceneComponentProps<CombinedLearningJourneyPanel>) {
  // Initialize user storage (sets up global storage for standalone helpers)
  // This MUST be called before any storage operations to ensure Grafana user storage is used
  useUserStorage();

  // Get plugin configuration for dev mode check
  const pluginContext = usePluginContext();
  const pluginConfig = React.useMemo(() => {
    return getConfigWithDefaults(pluginContext?.meta?.jsonData || {});
  }, [pluginContext?.meta?.jsonData]);

  // SECURITY: Dev mode - hybrid approach (synchronous check with user ID scoping)
  const currentUserId = config.bootData.user?.id;
  const isDevMode = isDevModeEnabled(pluginConfig, currentUserId);

  const currentUser = config.bootData?.user;
  const isEditorUser =
    currentUser?.orgRole === 'Editor' || currentUser?.orgRole === 'Admin' || currentUser?.isGrafanaAdmin === true;

  // SECURITY: Scoped logger that only emits in dev mode to prevent user data leaking to console.
  // Stable callback identity so effects depending on it do not re-run when isDevMode toggles.
  const logSession = useDevModeLogger(isDevMode);

  // Set global config for utility functions that can't access React context
  React.useEffect(() => {
    (window as any).__pathfinderPluginConfig = pluginConfig;
  }, [pluginConfig]);

  const { tabs, activeTabId, contextPanel } = model.useState();
  const { recommendationsReady = false } = contextPanel.useState();
  React.useEffect(() => {
    addGlobalModalStyles();
  }, []);

  // Track the current panel mode (sidebar / floating / fullscreen) including
  // the fullscreen self-heal that resets stale localStorage state when the
  // pathname is not the full-screen route. Extracted to usePanelMode.
  // See `pathfinder-panel-mode-change` listener docs in BlockEditorHeader for
  // the same pattern, and `docs-panel.panel-mode.test.tsx` for the contract.
  const { panelMode, isFullScreenActive } = usePanelMode();

  // Get plugin configuration to check if live sessions are enabled
  const isLiveSessionsEnabled = pluginConfig.enableLiveSessions;

  // Live session state
  const [showPresenterControls, setShowPresenterControls] = React.useState(false);
  const [showAttendeeJoin, setShowAttendeeJoin] = React.useState(false);
  const [isHandRaised, setIsHandRaised] = React.useState(false);
  const [showHandRaiseQueue, setShowHandRaiseQueue] = React.useState(false);
  const handRaiseIndicatorRef = React.useRef<HTMLDivElement>(null);

  // Global badge celebration queue - shows toasts sequentially when badges are earned
  const {
    currentCelebrationBadge,
    queueCount: badgeCelebrationQueueCount,
    onDismiss: handleDismissGlobalCelebration,
  } = useBadgeCelebrationQueue();

  const {
    isActive: isSessionActive,
    sessionRole,
    sessionInfo,
    sessionManager,
    onEvent,
    endSession,
    attendeeMode,
    attendeeName,
    setAttendeeMode,
    handRaises,
  } = useSession();

  // Check for session join URL on mount and auto-open the attendee-join modal.
  useSessionJoinUrlCheck({
    isLiveSessionsEnabled,
    onShowAttendeeJoin: () => setShowAttendeeJoin(true),
  });

  // Action replay system for attendees
  const [navigationManager] = React.useState(() => new NavigationManager());
  const actionReplayRef = useRef<ActionReplaySystem | null>(null);

  // Action capture system for presenters
  const actionCaptureRef = useRef<ActionCaptureSystem | null>(null);

  // Hand raise handler for attendees
  const handleHandRaiseToggle = useCallback(
    (isRaised: boolean) => {
      if (!sessionManager || !sessionInfo) {
        return;
      }

      setIsHandRaised(isRaised);

      // Send hand raise event to presenter
      sessionManager.sendToPresenter({
        type: 'hand_raise',
        sessionId: sessionInfo.sessionId,
        timestamp: Date.now(),
        senderId: sessionManager.getRole() || 'attendee',
        attendeeName: attendeeName || 'Anonymous',
        isRaised,
      });

      logSession(`[DocsPanel] Hand ${isRaised ? 'raised' : 'lowered'} by ${attendeeName}`);
    },
    [sessionManager, sessionInfo, attendeeName, logSession]
  );

  // Listen for hand raise events (presenter only)
  React.useEffect(() => {
    if (sessionRole !== 'presenter') {
      return;
    }

    logSession('[DocsPanel] Setting up hand raise event listener for presenter');

    const cleanup = onEvent((event) => {
      logSession('[DocsPanel] Presenter received event:', event.type, event);

      if (event.type === 'hand_raise') {
        if (event.isRaised) {
          // Show toast notification when someone raises their hand
          logSession('[DocsPanel] Showing toast for hand raise:', event.attendeeName);
          getAppEvents().publish({
            type: 'alert-success',
            payload: ['Live session', `${event.attendeeName} has raised their hand`],
          });
        }
      }
    });

    return cleanup;
  }, [sessionRole, onEvent, logSession]);

  // Restore tabs after storage is initialized (fixes race condition)
  useTabRestoration({ model, panelMode, tabs });

  // Ensure permanent tabs (devtools, editor) exist when their gate is active.
  usePermanentTabs({ model, isDevMode, isEditorUser, tabs });

  // Listen for auto-open events from global link interceptor
  // Place this HERE (not in ContextPanelRenderer) to avoid component remounting issues
  useAutoOpenListener(model);
  // removed — using restored custom overflow state below

  const activeTab = tabs.find((t) => t.id === activeTabId) || null;
  const isRecommendationsTab = activeTabId === 'recommendations';
  // Detect WYSIWYG preview tab to show "Return to editor" banner
  const isWysiwygPreview =
    activeTab?.baseUrl === 'bundled:wysiwyg-preview' || activeTab?.content?.url === 'bundled:wysiwyg-preview';
  // `useTheme2()` is the canonical hook for grabbing the raw theme;
  // `useStyles2((t) => t)` worked but mis-used the CSS-in-JS hook.
  const theme = useTheme2();

  // STABILITY: Memoize activeTab.content to prevent ContentRenderer from remounting
  // when other tab properties change (isLoading, error, etc.)
  const stableContent = React.useMemo(() => activeTab?.content, [activeTab?.content]);

  usePanelReadyMeasurement({
    hasContent: !!stableContent,
    isRecommendationsTab,
    recommendationsReady,
    surface: panelMode,
  });

  // STABILITY: Memoize the AlignmentPendingContext value keyed on the two
  // underlying primitives so consumers (`useStepChecker` in every interactive
  // section) don't re-render on every parent render. React context uses
  // referential equality, so an inline object literal here cascades into
  // re-evaluating step eligibility, recreating `checkStep`, and
  // re-subscribing event listeners across all steps in long guides.
  const alignmentPendingIsPending = !!activeTab?.pendingAlignment;
  const alignmentPendingStartingLocation = activeTab?.pendingAlignment?.startingLocation ?? null;
  const alignmentPendingValue = React.useMemo(
    () => ({
      isPending: alignmentPendingIsPending,
      startingLocation: alignmentPendingStartingLocation,
    }),
    [alignmentPendingIsPending, alignmentPendingStartingLocation]
  );

  // MUST use currentUrl || baseUrl (not content.url) for the progress key, to match
  // getContentKey() in interactive sections. content.url includes "/content.json"
  // which would mismatch saved progress.
  const { hasInteractiveProgress, progressKey } = useGuideProgressState(activeTab);

  const styles = useStyles2(getComponentStyles);
  const interactiveStyles = useStyles2(getInteractiveStyles);
  const prismStyles = useStyles2(getPrismStyles);
  const journeyStyles = useStyles2(journeyContentHtml);
  const docsStyles = useStyles2(docsContentHtml);

  // Tab overflow management - extracted to hook
  const {
    tabBarRef,
    tabListRef,
    visibleTabs,
    overflowedTabs,
    isDropdownOpen,
    setIsDropdownOpen,
    dropdownRef,
    chevronButtonRef,
    dropdownOpenTimeRef,
  } = useTabOverflow(tabs, activeTabId);

  const overflowGuideTabs = React.useMemo(
    () => overflowedTabs.filter((t) => !PERMANENT_TAB_IDS.has(t.id)),
    [overflowedTabs]
  );

  // Content styles are applied at the component level via CSS classes

  const contentRef = useRef<HTMLDivElement>(null);

  // Scroll position preservation - extracted to hook
  const { restoreScrollPosition } = useScrollPositionPreservation(
    activeTab?.id,
    activeTab?.baseUrl,
    activeTab?.currentUrl
  );

  // Content reset hook - handles complex storage/state/reload orchestration.
  // It dispatches `interactive-progress-cleared`, which `useGuideProgressState`
  // listens for to clear `hasInteractiveProgress` for this content key.
  const handleResetGuide = useContentReset({ model });

  // Helper: Reload active tab content (DRY - was duplicated 3x).
  // Used by error-retry and dev-mode refresh. Tag the loader call as
  // `internal_reload` so the implied-0th-step evaluator doesn't prompt the
  // user on top of content they're already looking at. See
  // `ALIGNED_BY_CONSTRUCTION_SOURCES` for the semantics.
  const reloadActiveTab = useCallback(
    (tab: LearningJourneyTab) => {
      // The unified `loadTab` dispatches on `shouldUseDocsLoader` internally.
      // `_recordAutoLaunchSource` only matters for the docs branch — the
      // plain branch never consumes it, so an unconditional record is a
      // no-op when not needed.
      model._recordAutoLaunchSource('internal_reload');
      model.loadTab(tab.id, tab.currentUrl || tab.baseUrl);
    },
    [model]
  );

  // Expose current active tab id/url on `window` for interactive persistence
  // keys. Uses useLayoutEffect inside the hook (pinned by H4 in the
  // pre-mortem) so children's passive useEffects observe the new URL.
  useGlobalActiveTabExposure({
    activeTabId: activeTab?.id,
    activeTabCurrentUrl: activeTab?.currentUrl,
    activeTabBaseUrl: activeTab?.baseUrl,
  });

  useJourneyStepWeights({
    journeyKey: activeTab?.baseUrl,
    milestones:
      activeTab?.type === 'learning-journey' ? activeTab.content?.metadata?.learningJourney?.milestones : undefined,
  });

  // Auto-complete the final milestone of a learning journey when the rendered
  // content has no interactive steps to drive completion from clicks.
  // Extracted to useLastMilestoneAutoComplete.
  useLastMilestoneAutoComplete({ stableContent, activeTab, contentRef });

  // Initialize interactive elements for the content container (side effects only)
  useInteractiveElements({ containerRef: contentRef });

  // Use custom hooks for cleaner organization
  useKeyboardShortcuts({
    tabs,
    activeTabId,
    activeTab,
    isRecommendationsTab,
    model,
  });

  useLinkClickHandler({
    contentRef,
    activeTab,
    theme,
    model,
  });

  // ============================================================================
  // Live Session Effects (Presenter)
  // ============================================================================

  // Initialize ActionCaptureSystem when creating session as presenter
  useEffect(() => {
    if (sessionRole === 'presenter' && sessionManager && sessionInfo && !actionCaptureRef.current) {
      logSession('[DocsPanel] Initializing ActionCaptureSystem for presenter');
      actionCaptureRef.current = new ActionCaptureSystem(sessionManager, sessionInfo.sessionId);
      actionCaptureRef.current.startCapture();
    }

    // Cleanup when ending session
    if (sessionRole !== 'presenter' && actionCaptureRef.current) {
      logSession('[DocsPanel] Cleaning up ActionCaptureSystem');
      actionCaptureRef.current.stopCapture();
      actionCaptureRef.current = null;
    }
  }, [sessionRole, sessionManager, sessionInfo, logSession]);

  // ============================================================================
  // Live Session Effects (Attendee)
  // ============================================================================

  // Initialize ActionReplaySystem when joining as attendee
  useEffect(() => {
    if (sessionRole === 'attendee' && navigationManager && attendeeMode && !actionReplayRef.current) {
      logSession(`[DocsPanel] Initializing ActionReplaySystem for attendee in ${attendeeMode} mode`);
      actionReplayRef.current = new ActionReplaySystem(attendeeMode, navigationManager);
    }

    // Update mode if it changes
    if (sessionRole === 'attendee' && actionReplayRef.current && attendeeMode) {
      actionReplayRef.current.setMode(attendeeMode);
      logSession(`[DocsPanel] Updated ActionReplaySystem mode to ${attendeeMode}`);
    }

    // Cleanup when leaving session
    if (sessionRole !== 'attendee' && actionReplayRef.current) {
      logSession('[DocsPanel] Cleaning up ActionReplaySystem');
      actionReplayRef.current = null;
    }
  }, [sessionRole, attendeeMode, logSession, navigationManager]);

  // Listen for session events and replay them (attendee only)
  useEffect(() => {
    if (sessionRole !== 'attendee' || !actionReplayRef.current) {
      return;
    }

    logSession('[DocsPanel] Setting up event listener for attendee');

    const cleanup = onEvent((event) => {
      logSession('[DocsPanel] Received event:', event.type);

      // Handle session end
      if (event.type === 'session_end') {
        logSession('[DocsPanel] Presenter ended the session');
        endSession();

        // Show notification to attendee
        getAppEvents().publish({
          type: 'alert-warning',
          payload: ['Session ended', 'The presenter has ended the live session.'],
        });

        return;
      }

      // Replay other events
      actionReplayRef.current?.handleEvent(event);
    });

    return cleanup;
  }, [sessionRole, onEvent, endSession, logSession]);

  // Auto-open tutorial when joining session as attendee
  useEffect(() => {
    if (sessionRole === 'attendee' && sessionInfo?.config.tutorialUrl) {
      logSession('[DocsPanel] Auto-opening tutorial:', sessionInfo.config.tutorialUrl);

      const url = sessionInfo.config.tutorialUrl;
      const title = sessionInfo.config.name;

      // The presenter coordinates location for attendees; treat as
      // aligned-by-construction so the implied-0th-step prompt doesn't
      // second-guess them.
      const opts = { source: 'live_session_attendee' as const };

      // Open the tutorial in a new tab
      if (url.includes('/learning-journeys/') || url.includes('/learning-paths/')) {
        model.openLearningJourney(url, title, opts);
      } else {
        model.openDocsPage(url, title, opts);
      }
    }
  }, [sessionRole, sessionInfo, model, logSession]);

  // Tab persistence is now handled explicitly in the model methods
  // No need for automatic saving here as it's done when tabs are created/modified
  // Note: Click-outside and dropdown positioning now handled by useTabOverflow hook

  const handleAutoLaunchIncoming = useCallback((detail: AutoLaunchTutorialDetail) => {
    const { url, title, type, source } = detail;
    const openAsLearningJourney = shouldOpenAsLearningJourney(type, source);
    reportAppInteraction(UserInteraction.OpenResourceClick, {
      content_title: title,
      content_url: url,
      content_type: getContentTypeForAnalytics(
        url,
        openAsLearningJourney ? AnalyticsContentType.LearningJourney : AnalyticsContentType.Docs
      ),
      trigger_source: 'auto_launch_tutorial',
      interaction_location: 'docs_panel',
      ...(openAsLearningJourney && {
        completion_percentage: 0, // Auto-launch is always starting fresh
      }),
    });
    window.dispatchEvent(new CustomEvent('auto-launch-complete', { detail }));
  }, []);

  useAutoLaunchTutorial(model, { onIncoming: handleAutoLaunchIncoming });

  // Pop-out to floating panel: hand off the active guide before switching modes
  usePopOutHandoff(model);

  // Open active content in the full screen mode page. Mirrors the popout
  // handoff: capturePriorPath, set pendingGuide, switch mode, then push the
  // route. Live sessions block the switch — a fresh SessionProvider on the
  // new page would disconnect the session.
  useFullScreenHandoff(model, isSessionActive);

  // Scroll tracking — wires setupScrollTracking to the `inner-docs-content`
  // scroll container (DOM id pinned by docs-panel.contract.test.tsx).
  useScrollTracking({ activeTab, isRecommendationsTab });

  const handleAiFixPatchApplied = useCallback(
    (tabId: string, newGuideJson: string) => {
      const updatedTabs = model.state.tabs.map((t) =>
        t.id === tabId && t.content ? { ...t, content: { ...t.content, content: newGuideJson } } : t
      );
      model.setState({ tabs: updatedTabs });
    },
    [model]
  );

  // ContentRenderer renders the content with styling applied via CSS classes

  return (
    <div
      id="CombinedLearningJourney"
      className={styles.container}
      data-pathfinder-content="true"
      data-testid={testIds.docsPanel.container}
    >
      <Suspense fallback={null}>
        <AiFixOrchestrator activeTab={activeTab} onPatchApplied={handleAiFixPatchApplied} />
      </Suspense>
      {/* Live session controls - only render when there's session content.
          The component returns null when both flags are off, preserving the
          original surface gate. */}
      <LiveSessionTopBar
        className={styles.topBar}
        liveSessionButtonsClassName={styles.liveSessionButtons}
        isLiveSessionsEnabled={isLiveSessionsEnabled}
        isSessionActive={isSessionActive}
        sessionRole={sessionRole}
        sessionInfo={sessionInfo}
        sessionManager={sessionManager}
        handRaises={handRaises}
        handRaiseIndicatorRef={handRaiseIndicatorRef}
        attendeeMode={attendeeMode}
        setAttendeeMode={setAttendeeMode}
        actionReplayRef={actionReplayRef}
        isHandRaised={isHandRaised}
        onHandRaiseToggle={handleHandRaiseToggle}
        onShowPresenterControls={() => setShowPresenterControls(true)}
        onShowAttendeeJoin={() => setShowAttendeeJoin(true)}
        onShowHandRaiseQueue={() => setShowHandRaiseQueue(true)}
        endSession={endSession}
        logSession={logSession}
      />
      {/* Note: the original markup uses a key-by-condition wrapper; the
          LiveSessionTopBar component returns null when both flags are off
          which is observationally equivalent. */}

      {/* Tab bar — extracted to DocsPanelTabBar. All data-testid values
          preserved; ownership tracked in docs-panel.contract.test.tsx
          SOURCE_CONTRACT. */}
      <DocsPanelTabBar
        styles={styles}
        tabs={tabs}
        activeTabId={activeTabId}
        activeTab={activeTab}
        visibleTabs={visibleTabs}
        overflowGuideTabs={overflowGuideTabs}
        isEditorUser={isEditorUser}
        isDevMode={isDevMode}
        isDropdownOpen={isDropdownOpen}
        setIsDropdownOpen={setIsDropdownOpen}
        tabBarRef={tabBarRef}
        tabListRef={tabListRef}
        dropdownRef={dropdownRef}
        chevronButtonRef={chevronButtonRef}
        dropdownOpenTimeRef={dropdownOpenTimeRef}
        onSetActiveTab={(tabId) => model.setActiveTab(tabId)}
        onCloseTab={(tabId) => model.closeTab(tabId)}
        reloadActiveTab={reloadActiveTab}
      />

      <DocsPanelContentArea
        styles={styles}
        journeyStyles={journeyStyles}
        docsStyles={docsStyles}
        interactiveStyles={interactiveStyles}
        prismStyles={prismStyles}
        model={model}
        contextPanel={contextPanel}
        isFullScreenActive={isFullScreenActive}
        isRecommendationsTab={isRecommendationsTab}
        isEditorUser={isEditorUser}
        isWysiwygPreview={isWysiwygPreview}
        activeTabId={activeTabId}
        activeTab={activeTab}
        stableContent={stableContent}
        hasInteractiveProgress={hasInteractiveProgress}
        progressKey={progressKey}
        alignmentPendingValue={alignmentPendingValue}
        contentRef={contentRef}
        handleResetGuide={handleResetGuide}
        reloadActiveTab={reloadActiveTab}
        restoreScrollPosition={restoreScrollPosition}
      />

      {/* Coda Terminal Panel - only shown in dev mode with terminal feature enabled */}
      {isDevMode && pluginConfig.enableCodaTerminal && (
        <Suspense fallback={null}>
          <TerminalPanel />
        </Suspense>
      )}

      {/* Live Session Modals — extracted cluster (presenter controls,
          attendee join, hand-raise queue). ModalBackdrop stays here as a
          sibling so its z-stacking order vs the badge toast is preserved. */}
      <LiveSessionModals
        theme={theme}
        showPresenterControls={showPresenterControls}
        isSessionActive={isSessionActive}
        sessionRole={sessionRole}
        showAttendeeJoin={showAttendeeJoin}
        showHandRaiseQueue={showHandRaiseQueue}
        handRaises={handRaises}
        handRaiseIndicatorRef={handRaiseIndicatorRef}
        presenterTutorialUrl={activeTab?.currentUrl || activeTab?.baseUrl || ''}
        onClosePresenterControls={() => setShowPresenterControls(false)}
        onCloseAttendeeJoin={() => setShowAttendeeJoin(false)}
        onAttendeeJoined={() => {
          setShowAttendeeJoin(false);
          // TODO: Start listening for presenter events
        }}
        onCloseHandRaiseQueue={() => setShowHandRaiseQueue(false)}
      />

      <ModalBackdrop
        visible={showPresenterControls || showAttendeeJoin}
        onClose={() => {
          setShowPresenterControls(false);
          setShowAttendeeJoin(false);
        }}
      />

      {/* Global Badge Celebration Toast - shows queued toasts sequentially */}
      {currentCelebrationBadge && getBadgeById(currentCelebrationBadge) && (
        <BadgeUnlockedToast
          badge={getBadgeById(currentCelebrationBadge)!}
          onDismiss={handleDismissGlobalCelebration}
          queueCount={badgeCelebrationQueueCount}
        />
      )}
    </div>
  );
}

// Wrap the renderer with SessionProvider and TerminalProvider so it has access to session and terminal context
function CombinedPanelRenderer(props: SceneComponentProps<CombinedLearningJourneyPanel>) {
  return (
    <SessionProvider>
      <Suspense fallback={null}>
        <TerminalProviderLazy>
          <CombinedPanelRendererInner {...props} />
        </TerminalProviderLazy>
      </Suspense>
    </SessionProvider>
  );
}

// Export the main component and keep backward compatibility
export { CombinedLearningJourneyPanel };
export class LearningJourneyPanel extends CombinedLearningJourneyPanel {}
export class DocsPanel extends CombinedLearningJourneyPanel {}
