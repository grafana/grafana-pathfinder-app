import { isLearningJourneyUrl } from './utils/url-validation';
import type { ReaderPosition } from '../../types/cross-tab.types';
import type { GuideLoadContext } from '../../types/guide-diagnostics.types';
import {
  beginGuideLoad,
  finishGuideLoad,
  pauseGuideLoad,
  resumeGuideLoad,
  markGuideLoadStage,
} from '../../lib/telemetry/guide-load';
import { diagnoseGuideError } from '../../lib/guide-diagnostics';
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
import { useBooleanFlag } from '../../utils/openfeature';
import { PathfinderPluginConfig } from '../../constants';

import { useInteractiveElements, NavigationManager } from '../../interactive-engine';
import { useKeyboardShortcuts } from './keyboard-shortcuts.hook';
import { useLinkClickHandler } from './link-handler.hook';
import { isDevModeEnabled } from '../../utils/dev-mode';
import { isCodaTerminalEnabled } from '../../utils/coda-enablement';
import { useCodaPluginAvailable } from '../../integrations/coda/useCodaAvailability.hook';

import {
  reportAppInteraction,
  UserInteraction,
  getContentTypeForAnalytics,
  AnalyticsContentType,
} from '../../lib/analytics';
import { rewriteGuideTrees } from '../../lib/guide-counting-source';
import { logger } from '../../lib/logging';
import type { GuideLoadOutcome } from '../../lib/telemetry';
import { usePanelReadyMeasurement } from './hooks/usePanelReadyMeasurement';
import { tabStorage, useUserStorage } from '../../lib/user-storage';
import {
  useGuideProgressState,
  useAutoLaunchTutorial,
  usePathfinderPluginConfig,
  type AutoLaunchTutorialDetail,
} from '../../hooks';
import {
  fetchContent,
  resolveActiveMilestoneSequence,
  getNextMilestoneUrlFromContent,
  getPreviousMilestoneUrlFromContent,
  getNextMilestoneIdFromContent,
  getPreviousMilestoneIdFromContent,
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
import { coerceLaunchSource, type LaunchSource } from '../../recovery';
import { currentUserIsAdmin } from '../../utils/current-user-role';
import { SessionProvider, useSession, ActionReplaySystem, ActionCaptureSystem } from '../../integrations/workshop';
import { panelModeManager } from '../../global-state/panel-mode';
import { cancelCatalogActivation } from '../../global-state/package-browser';
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
  mergeRestoredTabsWithExisting,
  loadDocsTabContentResult,
  RECOMMENDATIONS_TAB_ID,
  createBrowseTab,
  BROWSE_TAB_ID,
  DEVTOOLS_TAB_ID,
  EDITOR_TAB_ID,
  isNonContentTab,
  findCurrentMilestoneIndex,
  isCurrentUserEditor,
  resolveTabGates,
  didGateClose,
  closeTabState,
  pruneGatedTabState,
  projectPersistedTabs,
  resolveDocsLoadAlignment,
  buildDocsLoadSuccessPatch,
  type TabGates,
} from './utils';
import { DEFAULT_GUIDE_TITLE } from '../block-editor/editor-chrome-status';
// Import extracted hooks
import {
  useBadgeCelebrationQueue,
  useTabOverflow,
  useScrollPositionPreservation,
  useContentReset,
  useE2EResetGuideCapability,
  useCustomGuideCatalogueOnOpen,
  useDevModeLogger,
  usePanelMode,
  useSessionJoinUrlCheck,
  useScrollTracking,
  useGlobalActiveTabExposure,
  useAutoOpenListener,
  useCatalogBrowserListener,
  usePopOutHandoff,
  useFullScreenHandoff,
  useTabRestoration,
} from './hooks';

// Import centralized types
import { LearningJourneyTab, CombinedPanelState, PackageOpenInfo } from '../../types/content-panel.types';
import { getPackageRenderType } from '../../types/package.types';
import type { Milestone, RawContent } from '../../types/content.types';
import type { DocsPanelModelOperations, OpenDocsOptions, OpenLearningJourneyOptions } from './types';

/**
 * Newest in-flight `saveTabsToStorage`, shared across panel models.
 *
 * Explicit handoffs await their own save before flipping mode. This barrier
 * only covers the fire-and-forget return paths that cannot (sidebar
 * "Return to sidebar" notice; auto-dock on navigation): restore waits for
 * the newest write already pending when the await starts — not for a save
 * issued after that.
 */
let pendingTabStorageWrite: Promise<void> | null = null;

class CombinedLearningJourneyPanel extends SceneObjectBase<CombinedPanelState> implements DocsPanelModelOperations {
  public static Component = CombinedPanelRenderer;

  private _hasRestoredTabs = false;
  private _tabRestorePromise: Promise<void> | null = null;

  /**
   * Last tab gates this instance observed, or null before the first
   * observation. Only a null → open → closed transition justifies persisting
   * a prune; see `didGateClose`.
   */
  private _tabGates: TabGates | null = null;

  /**
   * Transient launch-source carrier for the implied-0th-step alignment check.
   *
   * Set immediately before a `loadDocsTabContent` call so the loader can read
   * it after content fetch and classify the launch. There are two ways to
   * populate it:
   *
   *   1. Preferred: pass `{ source }` to `openDocsPage`,
   *      `openLearningJourney`, or `loadTab`. Each records the source for you,
   *      keeping the contract visible at the call site.
   *   2. Legacy: call `_recordAutoLaunchSource(source)` directly, then call
   *      one of those. Only needed where a callback signature can't carry the
   *      source (e.g. `ContextPanel`'s recommender callbacks).
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

  public constructor(pluginConfig: PathfinderPluginConfig = {}) {
    // Initialize with the recommendations home tab
    const defaultTabs: LearningJourneyTab[] = [
      {
        id: RECOMMENDATIONS_TAB_ID,
        type: 'recommendations',
        title: 'Recommendations',
        baseUrl: '',
        currentUrl: '',
        content: null,
        isLoading: false,
        error: null,
      },
    ];

    if (resolveTabGates(pluginConfig).allowBrowse) {
      defaultTabs.push(createBrowseTab());
    }

    const contextPanel = new ContextPanel(
      (url: string, title: string) => this.openRecommendation(url, title, 'recommender', undefined, true),
      (url: string, title: string, packageInfo?: PackageOpenInfo) =>
        this.openRecommendation(
          url,
          title,
          coerceLaunchSource(packageInfo?.launchSource) ?? 'recommender',
          packageInfo,
          Boolean(packageInfo?.packageManifest) ||
            url.startsWith('bundled:') ||
            url.startsWith('backend-guide:') ||
            isPackageContentUrl(url)
        ),
      () => this.openEditorTab()
    );

    super({
      tabs: defaultTabs,
      activeTabId: RECOMMENDATIONS_TAB_ID,
      contextPanel,
      pluginConfig,
    });

    // Wire the composite PackageResolver into docs-retrieval so that
    // fetchPackageContent() and fetchPackageById() can resolve bundled and
    // remote packages — the Tier 3/4 injection point.
    //
    // Seed from the published global, not this surface's snapshot — the resolver is one app-wide singleton.
    const resolverConfig = window.__pathfinderPluginConfig;
    setPackageResolver(createCompositeResolver(resolverConfig ?? pluginConfig));

    // Note: Tab restoration now happens from React component after storage is initialized
    // to avoid race condition with useUserStorage hook
  }

  public async restoreTabsAsync(options?: { force?: boolean }): Promise<void> {
    if (this._tabRestorePromise) {
      return this._tabRestorePromise;
    }
    if (this._hasRestoredTabs && !options?.force) {
      return;
    }
    this._hasRestoredTabs = true;
    this._tabRestorePromise = this.restoreTabWorkspace();
    try {
      await this._tabRestorePromise;
    } catch (error) {
      this._hasRestoredTabs = false;
      throw error;
    } finally {
      this._tabRestorePromise = null;
    }
  }

  private async restoreTabWorkspace(): Promise<void> {
    await pendingTabStorageWrite;
    const { allowDevTools: isDevMode } = resolveTabGates(this.state.pluginConfig);

    let restoredTabs = await restoreTabsFromStorage(tabStorage, { isDevMode });
    restoredTabs = [...restoredTabs.filter((tab) => tab.type !== 'browse'), createBrowseTab()];
    let activeTabId = await restoreActiveTabFromStorage(tabStorage, restoredTabs);

    const pruned = this.pruneUnauthorizedGatedTabs(restoredTabs, activeTabId);
    restoredTabs = pruned.tabs;
    activeTabId = pruned.activeTabId;
    restoredTabs = mergeRestoredTabsWithExisting(restoredTabs, this.state.tabs);

    this.setState({
      tabs: restoredTabs,
      activeTabId,
    });

    this.initializeRestoredActiveTab();
  }

  /**
   * Adopt the plugin config React resolved, then re-apply the tab gates.
   *
   * Pass `null` when the plugin context has not resolved. The model keeps its
   * construction snapshot in that case, because an unresolved config is
   * indistinguishable from "dev mode off" and would strip an authorized Dev
   * Tools tab.
   */
  public syncPluginConfig(pluginConfig: PathfinderPluginConfig | null): void {
    if (pluginConfig && pluginConfig !== this.state.pluginConfig) {
      this.setState({ pluginConfig });
    }
    this.pruneGatedTabs();
  }

  public pruneGatedTabs(): void {
    const tabs =
      resolveTabGates(this.state.pluginConfig).allowBrowse && !this.state.tabs.some((tab) => tab.type === 'browse')
        ? [...this.state.tabs, createBrowseTab()]
        : this.state.tabs;
    const pruned = this.pruneUnauthorizedGatedTabs(tabs, this.state.activeTabId);
    if (!pruned.changed && tabs === this.state.tabs) {
      return;
    }
    this.setState({ tabs: pruned.tabs, activeTabId: pruned.activeTabId });
    if (pruned.gateClosed) {
      void this.saveTabsToStorage();
    }
  }

  private pruneUnauthorizedGatedTabs(tabs: LearningJourneyTab[], activeTabId: string) {
    const gates = resolveTabGates(this.state.pluginConfig);
    const gateClosed = didGateClose(this._tabGates, gates);
    this._tabGates = gates;

    const pruned = pruneGatedTabState({ tabs, activeTabId }, gates);
    return { ...pruned, gateClosed };
  }

  private generateTabId(): string {
    return `tab-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  private initializeRestoredActiveTab(): void {
    const activeTab = this.state.tabs.find((t) => t.id === this.state.activeTabId);
    if (!activeTab || isNonContentTab(activeTab)) {
      return;
    }

    if (!activeTab.content && !activeTab.isLoading && !activeTab.error) {
      // `browser_restore` is aligned-by-construction. Without it, a restored
      // tab whose path no longer matches its guide's `startingLocation` would
      // incorrectly trigger the alignment prompt — second-guessing a user
      // mid-tutorial, which is exactly what `browser_restore` suppresses.
      this.loadTab(activeTab.id, activeTab.currentUrl || activeTab.baseUrl, { source: 'browser_restore' });
    }
  }

  public saveTabsToStorage(): Promise<void> {
    const write = this.writeTabsToStorage();
    pendingTabStorageWrite = write;
    // Only the newest write clears the barrier; an older one settling late must
    // not retire a save that is still in flight.
    void write.finally(() => {
      if (pendingTabStorageWrite === write) {
        pendingTabStorageWrite = null;
      }
    });
    return write;
  }

  private async writeTabsToStorage(): Promise<void> {
    try {
      const tabsToSave = projectPersistedTabs(this.state.tabs);
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

  private async openRecommendation(
    url: string,
    title: string,
    source: LaunchSource,
    packageInfo: PackageOpenInfo | undefined,
    prepare: boolean
  ): Promise<void> {
    const { openGuideInSidebar } = await import('./utils/open-prepared-guide');
    if (!prepare) {
      if (panelModeManager.getMode() !== 'sidebar') {
        openGuideInSidebar({ url, title, source, packageInfo });
      } else {
        await this.openDocsPage(url, title, { source, packageInfo });
      }
      return;
    }
    const scope = `${config.namespace || ''}:${config.bootData?.user?.orgId ?? ''}:${config.bootData?.user?.id ?? ''}`;
    const { prepareGuideLaunch } = await import('./utils/prepare-guide-launch');
    const loadContext = beginGuideLoad(url);
    const result = await prepareGuideLaunch(url, { title, source, packageInfo, loadContext });
    if (
      scope !== `${config.namespace || ''}:${config.bootData?.user?.orgId ?? ''}:${config.bootData?.user?.id ?? ''}`
    ) {
      finishGuideLoad(loadContext, 'cancelled');
      return;
    }
    if (!result.ok) {
      throw new Error('unavailable');
    }
    openGuideInSidebar(result.launch);
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
      this._pendingLaunchSource = options.source;
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
    this.loadTab(tabId, url, { prefetched: options?.preparedContent });

    return tabId;
  }

  private readonly guideLoads = new Map<string, GuideLoadContext>();

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

  public async loadTab(
    tabId: string,
    url: string,
    options?: {
      skipReadyToBegin?: boolean;
      packageInfo?: PackageOpenInfo;
      prefetched?: RawContent;
      source?: LaunchSource;
      // Keeps existing content mounted; the caller owns loading and error UI.
      rejectOnError?: boolean;
      explicitGuideId?: string;
    }
  ): Promise<void> {
    finishGuideLoad(this.guideLoads.get(tabId), 'cancelled');
    const loadContext = options?.prefetched?.loadContext ?? beginGuideLoad(url);
    this.guideLoads.set(tabId, loadContext);
    if (options?.source) {
      this._pendingLaunchSource = options.source;
    }
    const tab = this.state.tabs.find((t) => t.id === tabId);
    const needsDocsLoader =
      isPackageContentUrl(url) || options?.packageInfo != null || (tab ? shouldUseDocsLoader(tab) : false);
    const keepContentVisible = options?.rejectOnError === true && tab?.content != null;
    let outcome: GuideLoadOutcome;
    if (needsDocsLoader) {
      outcome = await this.loadDocsTabContent(
        tabId,
        url,
        options?.skipReadyToBegin,
        options?.packageInfo,
        options?.prefetched,
        options?.explicitGuideId,
        loadContext,
        keepContentVisible
      );
    } else {
      outcome = await this.loadTabContent(tabId, url, options?.prefetched, loadContext, keepContentVisible);
    }
    if (options?.rejectOnError && outcome === 'error') {
      throw new Error('Failed to load the next module. Please try again.');
    }
  }

  private async loadTabContent(
    tabId: string,
    url: string,
    prefetched?: RawContent,
    loadContext?: GuideLoadContext,
    keepContentVisible = false
  ): Promise<GuideLoadOutcome> {
    if (!url || url.trim() === '') {
      logger.error(`loadTabContent called with an empty URL for tab ${tabId}`);
      finishGuideLoad(loadContext, 'error', { source: 'other', stage: 'resolve', reason: 'invalid-url' });
      if (!keepContentVisible) {
        this.failTab(tabId, 'This tab has no content to load.');
      }
      return 'error';
    }

    if (!keepContentVisible) {
      this.setTabLoading(tabId);
    }

    try {
      const tab = this.state.tabs.find((t) => t.id === tabId);
      const result = prefetched ? { content: prefetched } : await fetchContent(url, { loadContext });

      if (this.guideLoads.get(tabId) !== loadContext) {
        return 'error';
      }
      if (result.content) {
        markGuideLoadStage(loadContext, 'render');
        let content: RawContent = { ...result.content, loadContext };

        if (tab?.pathContext) {
          const currentMilestone = findCurrentMilestoneIndex(tab.pathContext.learningJourney.milestones, url);
          const learningJourney = {
            ...tab.pathContext.learningJourney,
            currentMilestone,
          };

          if (currentMilestone === 0) {
            // The cover-page component owns the start/continue CTA.
            content = rewriteGuideTrees(content, (guideJson) =>
              injectJourneyExtrasIntoJsonGuide(guideJson, learningJourney, true)
            );
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
              ...(tab.packageInfo?.repository != null && {
                repository: tab.packageInfo.repository,
              }),
            },
          };
        }

        const updatedTab = this.finishTabSuccess(tabId, () => ({ content, currentUrl: url }));

        // Completion readers key journey progress by the cover URL.
        if (updatedTab?.type === 'learning-journey' && updatedTab.content) {
          const progress = getJourneyProgress(updatedTab.content);
          const completionKey = updatedTab.content.metadata.learningJourney?.baseUrl || updatedTab.baseUrl;
          setJourneyCompletionPercentage(
            completionKey,
            progress,
            {
              packageManifest: updatedTab.content.metadata.packageManifest,
              repository: updatedTab.content.metadata.repository,
              guideTitle: updatedTab.title,
            },
            { attemptEligible: false }
          );
        }
        if (this.state.activeTabId !== tabId) {
          pauseGuideLoad(loadContext);
        }
        return 'completed';
      } else {
        finishGuideLoad(
          loadContext,
          'error',
          result.diagnostic ?? { source: loadContext?.source ?? 'other', stage: 'fetch', reason: 'unexpected-error' }
        );
        if (!keepContentVisible) {
          this.failTab(tabId, result.error || 'Failed to load content');
        }
        return 'error';
      }
    } catch (error) {
      if (this.guideLoads.get(tabId) !== loadContext) {
        return 'error';
      }
      finishGuideLoad(loadContext, 'error', diagnoseGuideError(error, loadContext?.source ?? 'other', 'prepare'));
      logger.error('Failed to load journey content');
      if (!keepContentVisible) {
        this.failTab(tabId, error instanceof Error ? error.message : 'Failed to load content');
      }
      return 'error';
    }
  }

  public async confirmAlignment(tabId: string): Promise<void> {
    const tab = this.state.tabs.find((t) => t.id === tabId);
    const pending = tab?.pendingAlignment;
    if (!tab || !pending) {
      return;
    }

    resumeGuideLoad(this.guideLoads.get(tabId));
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

    resumeGuideLoad(this.guideLoads.get(tabId));
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
    finishGuideLoad(this.guideLoads.get(tabId), 'cancelled');
    this.guideLoads.delete(tabId);
    const nextState = closeTabState(this.state, tabId);
    if (!nextState.changed) {
      return;
    }

    if (
      nextState.activeTabId !== this.state.activeTabId &&
      !nextState.tabs.find((tab) => tab.id === nextState.activeTabId)?.pendingAlignment
    ) {
      resumeGuideLoad(this.guideLoads.get(nextState.activeTabId));
    }
    this.setState({
      tabs: nextState.tabs,
      activeTabId: nextState.activeTabId,
    });
    this.saveTabsToStorage();
  }

  public setActiveTab(tabId: string) {
    if (tabId === BROWSE_TAB_ID) {
      this.pruneGatedTabs();
      if (!this.state.tabs.some((tab) => tab.id === BROWSE_TAB_ID)) {
        return;
      }
    }
    cancelCatalogActivation();
    pauseGuideLoad(this.guideLoads.get(this.state.activeTabId));
    if (!this.state.tabs.find((tab) => tab.id === tabId)?.pendingAlignment) {
      resumeGuideLoad(this.guideLoads.get(tabId));
    }
    this.setState({ activeTabId: tabId });

    this.saveTabsToStorage();

    // Tabs without a content URL skip the fetch path.
    const switchedTab = this.state.tabs.find((t) => t.id === tabId);
    if (!switchedTab || isNonContentTab(switchedTab)) {
      return;
    }

    const tab = this.state.tabs.find((t) => t.id === tabId);
    if (tab && !tab.isLoading && !tab.error && !tab.content) {
      this.loadTab(tabId, tab.currentUrl || tab.baseUrl);
    }
  }

  public async navigateToNextMilestone(options?: { rejectOnError?: boolean }) {
    const activeTab = this.getActiveTab();
    if (activeTab && activeTab.content) {
      const nextUrl = getNextMilestoneUrlFromContent(
        activeTab.content,
        activeTab.activeTrackId,
        activeTab.activeTrackMilestones
      );
      if (nextUrl) {
        await this.loadTab(activeTab.id, nextUrl, {
          ...(options?.rejectOnError && { rejectOnError: true }),
          explicitGuideId: getNextMilestoneIdFromContent(
            activeTab.content,
            activeTab.activeTrackId,
            activeTab.activeTrackMilestones
          ),
        });
      }
    }
  }

  public async navigateToPreviousMilestone() {
    const activeTab = this.getActiveTab();
    if (activeTab && activeTab.content) {
      const prevUrl = getPreviousMilestoneUrlFromContent(
        activeTab.content,
        activeTab.activeTrackId,
        activeTab.activeTrackMilestones
      );
      if (prevUrl) {
        // explicitGuideId is undefined when Previous falls back to the cover
        // page (see getPreviousMilestoneIdFromContent) — correct, since the
        // cover page has no guide id of its own and must stay on the
        // no-explicit-id default (isCoverPageLoad true).
        this.loadTab(activeTab.id, prevUrl, {
          explicitGuideId: getPreviousMilestoneIdFromContent(
            activeTab.content,
            activeTab.activeTrackId,
            activeTab.activeTrackMilestones
          ),
        });
      }
    }
  }

  public async restoreReaderPosition(position: ReaderPosition): Promise<void> {
    await this.restoreTabsAsync();
    let tab = this.state.tabs.find((candidate) => candidate.baseUrl === position.doc);
    if (!tab) {
      tab = {
        id: this.generateTabId(),
        title: 'Learning path',
        baseUrl: position.doc,
        currentUrl: position.doc,
        content: null,
        isLoading: true,
        error: null,
        type: isLearningJourneyUrl(position.doc) ? 'learning-journey' : 'docs',
      };
      this.setState({ tabs: [...this.state.tabs, tab] });
    }
    const tabId = tab.id;
    this.setState({ activeTabId: tabId });
    await this.loadTab(tabId, position.doc);
    const cover = this.state.tabs.find((candidate) => candidate.id === tabId)?.content;
    if (!cover) {
      return;
    }
    const selectedTrack = cover.metadata?.learningJourney?.tracks?.find((track) => track.trackId === position.trackId);
    this.setActiveTrackId(
      tabId,
      selectedTrack?.trackId ?? null,
      selectedTrack?.milestones ?? null,
      typeof cover.metadata?.packageManifest?.id === 'string' ? cover.metadata.packageManifest.id : undefined
    );
    const sequence = resolveActiveMilestoneSequence(cover, selectedTrack?.trackId, selectedTrack?.milestones);
    const milestone = sequence?.milestones.find((item) => item.url === position.milestoneUrl && !item.isLocked);
    if (milestone) {
      await this.loadTab(tabId, milestone.url, { explicitGuideId: milestone.id });
    }
    await this.saveTabsToStorage();
  }

  public getActiveTab(): LearningJourneyTab | null {
    return this.state.tabs.find((t) => t.id === this.state.activeTabId) || null;
  }

  public setActiveTrackId(
    tabId: string,
    trackId: string | null,
    milestones?: Milestone[] | null,
    pathId?: string
  ): void {
    const current = this.state.tabs.find((tab) => tab.id === tabId);
    // The cover re-reports its selection on every mount; only a change to what projectPersistedTabs writes needs a save.
    const selectionChanged =
      (current?.activeTrackId || null) !== (trackId || null) || (!!trackId && current?.activeTrackPathId !== pathId);
    this.setState({
      tabs: this.state.tabs.map((tab) =>
        tab.id === tabId
          ? { ...tab, activeTrackId: trackId, activeTrackMilestones: milestones, activeTrackPathId: pathId }
          : tab
      ),
    });
    if (current && selectionChanged) {
      this.saveTabsToStorage();
    }
  }

  public canNavigateNext(): boolean {
    const activeTab = this.getActiveTab();
    return activeTab?.content
      ? getNextMilestoneUrlFromContent(activeTab.content, activeTab.activeTrackId, activeTab.activeTrackMilestones) !==
          null
      : false;
  }

  public canNavigatePrevious(): boolean {
    const activeTab = this.getActiveTab();
    return activeTab?.content
      ? getPreviousMilestoneUrlFromContent(
          activeTab.content,
          activeTab.activeTrackId,
          activeTab.activeTrackMilestones
        ) !== null
      : false;
  }

  /**
   * Open the Dev Tools view (or switch to it if already open).
   * Singleton strip tab opened from the overflow menu when Dev Mode is on.
   */
  public openDevToolsTab(): void {
    const existingTab = this.state.tabs.find((t) => t.id === DEVTOOLS_TAB_ID);
    if (existingTab) {
      this.setState({ activeTabId: DEVTOOLS_TAB_ID });
      this.saveTabsToStorage();
      return;
    }

    const newTab: LearningJourneyTab = {
      id: DEVTOOLS_TAB_ID,
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
      activeTabId: DEVTOOLS_TAB_ID,
    });

    this.saveTabsToStorage();
  }

  /**
   * Open the Editor tab (or switch to it if already open)
   */
  public openEditorTab(): void {
    const existingTab = this.state.tabs.find((t) => t.id === EDITOR_TAB_ID);
    if (existingTab) {
      this.setState({ activeTabId: EDITOR_TAB_ID });
      this.saveTabsToStorage();
      return;
    }

    const newTab: LearningJourneyTab = {
      id: EDITOR_TAB_ID,
      title: DEFAULT_GUIDE_TITLE,
      baseUrl: '',
      currentUrl: '',
      content: null,
      isLoading: false,
      error: null,
      type: 'editor',
    };

    this.setState({
      tabs: [...this.state.tabs, newTab],
      activeTabId: EDITOR_TAB_ID,
    });

    this.saveTabsToStorage();
  }

  /** Update the editor tab's strip title from the working guide. */
  public updateEditorTabTitle(title: string): void {
    const trimmed = title.trim() || DEFAULT_GUIDE_TITLE;
    const editorTab = this.state.tabs.find((t) => t.id === EDITOR_TAB_ID);
    if (!editorTab || editorTab.title === trimmed) {
      return;
    }

    this.setState({
      tabs: this.state.tabs.map((t) => (t.id === EDITOR_TAB_ID ? { ...t, title: trimmed } : t)),
    });
    this.saveTabsToStorage();
  }

  public async openDocsPage(url: string, title?: string, options?: OpenDocsOptions): Promise<string> {
    const { source, skipReadyToBegin, packageInfo, preparedContent, explicitGuideId } = options ?? {};

    // Make the launch source explicit at the call site if provided. This
    // narrows the surface area of the legacy `_recordAutoLaunchSource` flag —
    // a bug where a caller forgot to record before invoking this method
    // would now manifest as a missing `options.source` (visible in code
    // review) instead of a silent default-to-"needs-check".
    if (source) {
      this._pendingLaunchSource = source;
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
      ...(packageInfo?.trackId && { activeTrackId: packageInfo.trackId, activeTrackPathId: packageInfo.packageId }),
    };

    this.setState({
      tabs: [...this.state.tabs, newTab],
      activeTabId: tabId,
    });

    // Save tabs to storage immediately after creating
    this.saveTabsToStorage();

    this.loadTab(tabId, url, { skipReadyToBegin, packageInfo, prefetched: preparedContent, explicitGuideId });

    return tabId;
  }

  private async loadDocsTabContent(
    tabId: string,
    url: string,
    skipReadyToBegin?: boolean,
    packageInfoArg?: PackageOpenInfo,
    prefetched?: RawContent,
    explicitGuideId?: string,
    loadContext?: GuideLoadContext,
    keepContentVisible = false
  ): Promise<GuideLoadOutcome> {
    // Outgoing content preserves track identity if this load's path resolution fails.
    const outgoingContent = this.state.tabs.find((t) => t.id === tabId)?.content;
    const knownBaseUrl =
      outgoingContent?.metadata?.learningJourney?.baseUrl ?? outgoingContent?.metadata?.trackMemberBaseUrl;

    if (!keepContentVisible) {
      this.setTabLoading(tabId);
    }

    try {
      const launchSource = this._consumeAutoLaunchSource();
      let packageInfo = packageInfoArg ?? this.state.tabs.find((t) => t.id === tabId)?.packageInfo;
      // Deep links need a manifest to render milestone navigation.
      if (!prefetched && !packageInfo && isPackageContentUrl(url)) {
        packageInfo = await fetchPackageInfoFromUrl(url, loadContext);
      }
      // skipReadyToBegin cannot alter already-prefetched content.
      if (prefetched && skipReadyToBegin) {
        logger.warn('[DocsPanel] skipReadyToBegin ignored for prefetched content');
      }
      const result = prefetched
        ? { content: prefetched }
        : await loadDocsTabContentResult(url, {
            skipReadyToBegin,
            packageInfo,
            explicitGuideId,
            knownBaseUrl,
            loadContext,
          });

      if (this.guideLoads.get(tabId) !== loadContext) {
        return 'error';
      }
      if (result.content) {
        markGuideLoadStage(loadContext, 'render');
        const fetchedContent = { ...result.content, loadContext };
        const currentPath = locationService.getLocation().pathname;
        const alignmentDecision = resolveDocsLoadAlignment({
          requestedUrl: url,
          packageManifest: packageInfo?.packageManifest,
          fetchedManifest: fetchedContent.metadata.packageManifest,
          packageManifestIsFromEnclosingPath: fetchedContent.metadata.journeyManifest !== undefined,
          currentPath,
          launchSource,
          isAdmin: currentUserIsAdmin(),
          isFullScreen: panelModeManager.getMode() === 'fullscreen',
        });
        const pendingAlignment = alignmentDecision ? { ...alignmentDecision, decidedAt: Date.now() } : undefined;

        const finalTab = this.finishTabSuccess(tabId, (tab) =>
          buildDocsLoadSuccessPatch({ tab, requestedUrl: url, fetchedContent, packageInfo, pendingAlignment })
        );

        if (pendingAlignment) {
          pauseGuideLoad(loadContext, true);
          reportAppInteraction(UserInteraction.AlignmentPromptShown, {
            guide_url: url,
            guide_title: finalTab?.title ?? '',
            launch_source: pendingAlignment.launchSource,
            current_path: pendingAlignment.currentPath,
            starting_location: pendingAlignment.startingLocation,
          });
        }
        if (this.state.activeTabId !== tabId) {
          pauseGuideLoad(loadContext);
        }
        return 'completed';
      } else {
        finishGuideLoad(
          loadContext,
          'error',
          result.diagnostic ?? { source: loadContext?.source ?? 'other', stage: 'fetch', reason: 'unexpected-error' }
        );
        if (!keepContentVisible) {
          this.failTab(tabId, result.error || 'Failed to load documentation');
        }
        return 'error';
      }
    } catch (error) {
      if (this.guideLoads.get(tabId) !== loadContext) {
        return 'error';
      }
      finishGuideLoad(loadContext, 'error', diagnoseGuideError(error, loadContext?.source ?? 'other', 'prepare'));
      logger.error('Failed to load docs content');
      if (!keepContentVisible) {
        this.failTab(tabId, error instanceof Error ? error.message : 'Failed to load documentation');
      }
      return 'error';
    }
  }
}

function CombinedPanelRendererInner({ model }: SceneComponentProps<CombinedLearningJourneyPanel>) {
  // Initialize user storage (sets up global storage for standalone helpers)
  // This MUST be called before any storage operations to ensure Grafana user storage is used
  useUserStorage();

  useCustomGuideCatalogueOnOpen();

  // Get plugin configuration for dev mode check. `isResolved` distinguishes a
  // known config from "not known yet"; without it an all-defaults config would
  // read as an explicit "dev mode off" and prune authorized tabs.
  const { config: pluginConfig, isResolved: isPluginConfigResolved } = usePathfinderPluginConfig({
    refreshOnMount: true,
  });

  const isDevMode = isDevModeEnabled(pluginConfig);
  const browseEnabled = useBooleanFlag('pathfinder.package-browser', true);

  const isEditorUser = isCurrentUserEditor();

  const codaEnabled = isCodaTerminalEnabled(pluginConfig);
  const codaAvailable = useCodaPluginAvailable(codaEnabled);

  // SECURITY: Scoped logger that only emits in dev mode to prevent user data leaking to console.
  // Stable callback identity so effects depending on it do not re-run when isDevMode toggles.
  const logSession = useDevModeLogger(isDevMode);

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
  useCatalogBrowserListener(model, panelMode);

  // Hand the model the config React resolved and let it re-apply the tab
  // gates. The model owns the derivation, so restore and this pass cannot
  // disagree. `null` while the context is unresolved leaves the model's own
  // config in place rather than stripping tabs on a default-shaped read.
  React.useEffect(() => {
    model.syncPluginConfig(isPluginConfigResolved ? pluginConfig : null);
  }, [isPluginConfigResolved, pluginConfig, model, tabs, browseEnabled]);

  // Listen for auto-open events from global link interceptor
  // Place this HERE (not in ContextPanelRenderer) to avoid component remounting issues
  useAutoOpenListener(model, 'sidebar');
  // removed — using restored custom overflow state below

  const activeTab = tabs.find((t) => t.id === activeTabId) || null;
  const isRecommendationsTab = activeTab?.type === 'recommendations';
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
      model.loadTab(tab.id, tab.currentUrl || tab.baseUrl, { source: 'internal_reload' });
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
  useE2EResetGuideCapability({
    activeTabCurrentUrl: activeTab?.currentUrl,
    activeTabBaseUrl: activeTab?.baseUrl,
  });

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
        overflowGuideTabs={overflowedTabs}
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
        onOpenEditorTab={() => model.openEditorTab()}
        onOpenDevToolsTab={() => model.openDevToolsTab()}
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
        isDevMode={isDevMode}
        isWysiwygPreview={isWysiwygPreview}
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

      {/* Coda terminal panel — needs Pathfinder's own enablement gate and the
          separate Coda app plugin to be installed and enabled. */}
      {codaEnabled && codaAvailable && (
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
