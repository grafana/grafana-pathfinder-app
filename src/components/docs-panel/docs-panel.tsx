// Combined Learning Journey and Docs Panel
// Post-refactoring unified component using new content system only

import React, { useEffect, useLayoutEffect, useRef, useCallback, Suspense, lazy } from 'react';
import { SceneObjectBase, SceneComponentProps } from '@grafana/scenes';
import { IconButton, Alert, Icon, useStyles2, Button, ButtonGroup } from '@grafana/ui';

// Lazy load dev tools to keep them out of production bundles
// This component is only loaded when dev mode is enabled and the tab is opened
const SelectorDebugPanel = lazy(() =>
  import('../SelectorDebugPanel').then((module) => ({
    default: module.SelectorDebugPanel,
  }))
);

// Lazy load Coda Terminal to keep it out of production bundles
// Only loaded when dev mode is enabled and terminal feature is enabled
const TerminalPanel = lazy(() =>
  import('../../integrations/coda').then((module) => ({
    default: module.TerminalPanel,
  }))
);
import { GrafanaTheme2, usePluginContext } from '@grafana/data';
import { t } from '@grafana/i18n';
import { DocsPluginConfig, getConfigWithDefaults, PLUGIN_BASE_URL } from '../../constants';

import { useInteractiveElements, NavigationManager } from '../../interactive-engine';
import { useKeyboardShortcuts } from './keyboard-shortcuts.hook';
import { useLinkClickHandler } from './link-handler.hook';
import { isDevModeEnabled } from '../../utils/dev-mode';
import { parseUrlSafely } from '../../security';

import {
  setupScrollTracking,
  reportAppInteraction,
  UserInteraction,
  getContentTypeForAnalytics,
} from '../../lib/analytics';
import { tabStorage, useUserStorage, interactiveStepStorage } from '../../lib/user-storage';
import { FeedbackButton } from '../FeedbackButton/FeedbackButton';
import { SkeletonLoader } from '../SkeletonLoader';

import {
  fetchContent,
  ContentRenderer,
  getNextMilestoneUrlFromContent,
  getPreviousMilestoneUrlFromContent,
  getJourneyProgress,
  setJourneyCompletionPercentage,
  getMilestoneSlug,
  markMilestoneDone,
  isLastMilestone,
} from '../../docs-retrieval';

import { ContextPanel } from './context-panel';
import { BadgeUnlockedToast } from '../LearningPaths';
import { getBadgeById } from '../../learning-paths';

import { getStyles as getComponentStyles, addGlobalModalStyles } from '../../styles/docs-panel.styles';
import { journeyContentHtml, docsContentHtml } from '../../styles/content-html.styles';
import { getInteractiveStyles } from '../../styles/interactive.styles';
import { getPrismStyles } from '../../styles/prism.styles';
import { config, getAppEvents } from '@grafana/runtime';
import { PresenterControls, AttendeeJoin, HandRaiseButton, HandRaiseIndicator, HandRaiseQueue } from '../LiveSession';
import { SessionProvider, useSession, ActionReplaySystem, ActionCaptureSystem } from '../../integrations/workshop';
import type { AttendeeMode } from '../../types/collaboration.types';
import { linkInterceptionState } from '../../global-state/link-interception';
import { testIds } from '../../constants/testIds';

// Import extracted components
import { LoadingIndicator, ErrorDisplay, TabBarActions, ModalBackdrop } from './components';
// Import extracted utilities
import {
  isDocsLikeTab,
  getTranslatedTitle,
  restoreTabsFromStorage,
  restoreActiveTabFromStorage,
  isGrafanaDocsUrl,
  cleanDocsUrl,
} from './utils';
// Import extracted hooks
import { useBadgeCelebrationQueue, useTabOverflow, useScrollPositionPreservation, useContentReset } from './hooks';

// Import centralized types
import { LearningJourneyTab, PersistedTabData, CombinedPanelState } from '../../types/content-panel.types';
import type { DocsPanelModelOperations } from './types';

class CombinedLearningJourneyPanel extends SceneObjectBase<CombinedPanelState> implements DocsPanelModelOperations {
  public static Component = CombinedPanelRenderer;

  /**
   * Module-level guard: prevents restoreTabsAsync() from running more than once,
   * even across model instances (which can be recreated by Scenes framework).
   */
  private static _hasRestoredTabs = false;

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
      (url: string, title: string) => this.openLearningJourney(url, title),
      (url: string, title: string) => this.openDocsPage(url, title),
      () => this.openDevToolsTab()
    );

    super({
      tabs: defaultTabs,
      activeTabId: 'recommendations',
      contextPanel,
      pluginConfig,
    });

    // Note: Tab restoration now happens from React component after storage is initialized
    // to avoid race condition with useUserStorage hook
  }

  public async restoreTabsAsync(): Promise<void> {
    // Guard: only restore once per model lifetime to prevent double-restore race condition
    // where a second restore (triggered by component remount or React Strict Mode) replaces
    // tabs that already had content loaded, leaving them in {content: null} blank state
    if (CombinedLearningJourneyPanel._hasRestoredTabs) {
      return;
    }
    CombinedLearningJourneyPanel._hasRestoredTabs = true;

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
    if (activeTab && activeTab.id !== 'recommendations') {
      // If we have an active tab but no content, load it
      if (!activeTab.content && !activeTab.isLoading && !activeTab.error) {
        if (isDocsLikeTab(activeTab.type)) {
          this.loadDocsTabContent(activeTab.id, activeTab.currentUrl || activeTab.baseUrl);
        } else {
          this.loadTabContent(activeTab.id, activeTab.currentUrl || activeTab.baseUrl);
        }
      }
    }
  }

  private async saveTabsToStorage(): Promise<void> {
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
        }));

      // Save both tabs and active tab
      await Promise.all([tabStorage.setTabs(tabsToSave), tabStorage.setActiveTab(this.state.activeTabId)]);
    } catch (error) {
      console.error('Failed to save tabs to storage:', error);
    }
  }

  public static async clearPersistedTabs(): Promise<void> {
    try {
      await tabStorage.clear();
    } catch (error) {
      console.error('Failed to clear persisted tabs:', error);
    }
  }

  public async openLearningJourney(url: string, title?: string): Promise<string> {
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

    // Load content for the tab
    this.loadTabContent(tabId, url);

    return tabId;
  }

  public async loadTabContent(tabId: string, url: string) {
    // Skip loading if URL is empty
    if (!url || url.trim() === '') {
      return;
    }

    // Update tab to loading state
    const updatedTabs = this.state.tabs.map((t) =>
      t.id === tabId
        ? {
            ...t,
            isLoading: true,
            error: null,
          }
        : t
    );
    this.setState({ tabs: updatedTabs });

    try {
      const result = await fetchContent(url);

      // Check if fetch succeeded or failed
      if (result.content) {
        // Success: set content and clear error
        const finalUpdatedTabs = this.state.tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                content: result.content,
                isLoading: false,
                error: null,
                currentUrl: url, // Ensure currentUrl is set to the actual loaded URL
              }
            : t
        );
        this.setState({ tabs: finalUpdatedTabs });

        // Save tabs to storage after content is loaded
        this.saveTabsToStorage();

        // Update completion percentage for learning journeys
        const updatedTab = finalUpdatedTabs.find((t) => t.id === tabId);
        if (updatedTab?.type === 'learning-journey' && updatedTab.content) {
          const progress = getJourneyProgress(updatedTab.content);
          setJourneyCompletionPercentage(updatedTab.baseUrl, progress);
        }
      } else {
        // Fetch failed: set error from result
        const errorUpdatedTabs = this.state.tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                isLoading: false,
                error: result.error || 'Failed to load content',
              }
            : t
        );
        this.setState({ tabs: errorUpdatedTabs });

        // Save tabs to storage even when there's an error
        this.saveTabsToStorage();
      }
    } catch (error) {
      console.error(`Failed to load journey content for tab ${tabId}:`, error);

      const errorUpdatedTabs = this.state.tabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              isLoading: false,
              error: error instanceof Error ? error.message : 'Failed to load content',
            }
          : t
      );
      this.setState({ tabs: errorUpdatedTabs });

      // Save tabs to storage even when there's an error
      this.saveTabsToStorage();
    }
  }

  public closeTab(tabId: string) {
    if (tabId === 'recommendations') {
      return; // Can't close recommendations tab
    }

    const currentTabs = this.state.tabs;
    const tabIndex = currentTabs.findIndex((t) => t.id === tabId);

    // Remove the tab
    const newTabs = currentTabs.filter((t) => t.id !== tabId);

    // Determine new active tab
    let newActiveTabId = this.state.activeTabId;
    if (this.state.activeTabId === tabId) {
      if (tabIndex > 0 && tabIndex < currentTabs.length - 1) {
        // Choose the next tab if available
        newActiveTabId = currentTabs[tabIndex + 1]!.id;
      } else if (tabIndex > 0) {
        // Choose the previous tab if at the end
        newActiveTabId = currentTabs[tabIndex - 1]!.id;
      } else {
        // Default to recommendations if only tab
        newActiveTabId = 'recommendations';
      }
    }

    // Check if only default tabs remain (recommendations and possibly devtools)
    // If so, always default to recommendations
    const onlyDefaultTabsRemaining = newTabs.every((t) => t.id === 'recommendations' || t.id === 'devtools');
    if (onlyDefaultTabsRemaining && newActiveTabId !== 'recommendations') {
      newActiveTabId = 'recommendations';
    }

    this.setState({
      tabs: newTabs,
      activeTabId: newActiveTabId,
    });

    // Save tabs to storage after closing
    this.saveTabsToStorage();

    // Clear any persisted interactive completion state for this tab
    // Note: Interactive step completion is now handled by interactiveStepStorage
    // which uses a different key format and is managed within interactive components
    // This cleanup is now handled automatically when interactive sections are unmounted
  }

  public setActiveTab(tabId: string) {
    this.setState({ activeTabId: tabId });

    // Save active tab to storage
    this.saveTabsToStorage();

    // If switching to a tab that hasn't loaded content yet, load it
    const tab = this.state.tabs.find((t) => t.id === tabId);
    if (tab && tabId !== 'recommendations' && !tab.isLoading && !tab.error) {
      if (isDocsLikeTab(tab.type) && !tab.content) {
        this.loadDocsTabContent(tabId, tab.currentUrl || tab.baseUrl);
      } else if (!isDocsLikeTab(tab.type) && !tab.content) {
        this.loadTabContent(tabId, tab.currentUrl || tab.baseUrl);
      }
    }
  }

  public async navigateToNextMilestone() {
    const activeTab = this.getActiveTab();
    if (activeTab && activeTab.content) {
      const nextUrl = getNextMilestoneUrlFromContent(activeTab.content);
      if (nextUrl) {
        this.loadTabContent(activeTab.id, nextUrl);
      }
    }
  }

  public async navigateToPreviousMilestone() {
    const activeTab = this.getActiveTab();
    if (activeTab && activeTab.content) {
      const prevUrl = getPreviousMilestoneUrlFromContent(activeTab.content);
      if (prevUrl) {
        this.loadTabContent(activeTab.id, prevUrl);
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

  public async openDocsPage(url: string, title?: string, skipReadyToBegin?: boolean): Promise<string> {
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
      type: 'docs',
    };

    this.setState({
      tabs: [...this.state.tabs, newTab],
      activeTabId: tabId,
    });

    // Save tabs to storage immediately after creating
    this.saveTabsToStorage();

    // Load docs content for the tab
    this.loadDocsTabContent(tabId, url, skipReadyToBegin);

    return tabId;
  }

  public async loadDocsTabContent(tabId: string, url: string, skipReadyToBegin?: boolean) {
    // Skip loading if URL is empty
    if (!url || url.trim() === '') {
      return;
    }

    // Update tab to loading state
    const updatedTabs = this.state.tabs.map((t) =>
      t.id === tabId
        ? {
            ...t,
            isLoading: true,
            error: null,
          }
        : t
    );
    this.setState({ tabs: updatedTabs });

    try {
      const result = await fetchContent(url, { skipReadyToBegin });

      // Check if fetch succeeded or failed
      if (result.content) {
        // Success: set content and clear error
        // Also sync tab type with fetched content type (important for bundled interactives)
        const fetchedContent = result.content;
        const finalUpdatedTabs = this.state.tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                content: fetchedContent,
                isLoading: false,
                error: null,
                currentUrl: url,
                // Sync tab type with content type - automatically detect interactives
                type: fetchedContent.type === 'interactive' ? 'interactive' : t.type,
              }
            : t
        );
        this.setState({ tabs: finalUpdatedTabs });

        // Save tabs to storage after content is loaded
        this.saveTabsToStorage();
      } else {
        // Fetch failed: set error from result
        const errorUpdatedTabs = this.state.tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                isLoading: false,
                error: result.error || 'Failed to load documentation',
              }
            : t
        );
        this.setState({ tabs: errorUpdatedTabs });

        // Save tabs to storage even when there's an error
        this.saveTabsToStorage();
      }
    } catch (error) {
      console.error(`Failed to load docs content for tab ${tabId}:`, error);

      const errorUpdatedTabs = this.state.tabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              isLoading: false,
              error: error instanceof Error ? error.message : 'Failed to load documentation',
            }
          : t
      );
      this.setState({ tabs: errorUpdatedTabs });

      // Save tabs to storage even when there's an error
      this.saveTabsToStorage();
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

  // SECURITY: Scoped logger that only emits in dev mode to prevent user data leaking to console.
  // Stored in a ref so it never causes effect re-runs when isDevMode toggles.
  const logSessionRef = React.useRef((...args: unknown[]) => {
    if (isDevMode) {
      console.log(...args);
    }
  });
  logSessionRef.current = (...args: unknown[]) => {
    if (isDevMode) {
      console.log(...args);
    }
  };
  const logSession = React.useCallback((...args: unknown[]) => {
    logSessionRef.current(...args);
  }, []);

  // Set global config for utility functions that can't access React context
  (window as any).__pathfinderPluginConfig = pluginConfig;

  const { tabs, activeTabId, contextPanel } = model.useState();
  React.useEffect(() => {
    addGlobalModalStyles();
  }, []);

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

  // Interactive progress state - shows reset button when user has completed steps
  const [hasInteractiveProgress, setHasInteractiveProgress] = React.useState(false);

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

  // Check for session join URL on mount and auto-open modal
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('session')) {
      if (!isLiveSessionsEnabled) {
        // Show notification that live sessions are disabled
        getAppEvents().publish({
          type: 'alert-warning',
          payload: [
            'Live sessions disabled',
            'Live sessions are disabled on this Grafana instance. Ask your administrator to enable them in the Pathfinder plugin configuration.',
          ],
        });
      } else {
        setShowAttendeeJoin(true);
      }
    }
  }, [isLiveSessionsEnabled]);

  // Action replay system for attendees
  const navigationManagerRef = useRef<NavigationManager | null>(null);
  const actionReplayRef = useRef<ActionReplaySystem | null>(null);

  // Action capture system for presenters
  const actionCaptureRef = useRef<ActionCaptureSystem | null>(null);

  // Initialize navigation manager once
  if (!navigationManagerRef.current) {
    navigationManagerRef.current = new NavigationManager();
  }

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
  React.useEffect(() => {
    // Only restore if we haven't loaded tabs yet
    // Check if tabs only contain the default system tab (recommendations)
    const hasOnlyDefaultTabs = tabs.length === 1 && tabs[0]?.id === 'recommendations';

    if (hasOnlyDefaultTabs) {
      model.restoreTabsAsync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps - only run once after mount, tabs checked at mount time

  // Ensure devtools tab exists when dev mode is enabled (permanent tab)
  React.useEffect(() => {
    if (isDevMode) {
      const hasDevToolsTab = tabs.some((t) => t.id === 'devtools');
      if (!hasDevToolsTab) {
        // Add devtools tab without switching to it
        const devToolsTab: LearningJourneyTab = {
          id: 'devtools',
          title: 'Dev Tools',
          baseUrl: '',
          currentUrl: '',
          content: null,
          isLoading: false,
          error: null,
          type: 'devtools',
        };
        model.setState({ tabs: [...tabs, devToolsTab] });
      }
    }
  }, [isDevMode, tabs, model]);

  // Listen for auto-open events from global link interceptor
  // Place this HERE (not in ContextPanelRenderer) to avoid component remounting issues
  React.useEffect(() => {
    const handleAutoOpen = (event: Event) => {
      const customEvent = event as CustomEvent<{ url: string; title: string; origin: string }>;
      const { url, title } = customEvent.detail;

      // Always create a new tab for each intercepted link
      // Call the model method directly to ensure new tabs are created
      // Use proper URL parsing for security (defense in depth)
      const urlObj = parseUrlSafely(url);
      const isLearningJourney =
        urlObj?.pathname.includes('/learning-journeys/') || urlObj?.pathname.includes('/learning-paths/');

      if (isLearningJourney) {
        model.openLearningJourney(url, title);
      } else {
        model.openDocsPage(url, title);
      }
    };

    // Listen for all auto-open events
    document.addEventListener('pathfinder-auto-open-docs', handleAutoOpen);

    // todo: investigate why this needs to be kicked to the end of the event loop
    setTimeout(() => linkInterceptionState.processQueuedLinks(), 0);

    return () => {
      document.removeEventListener('pathfinder-auto-open-docs', handleAutoOpen);
    };
  }, [model]); // Only model as dependency - this component doesn't remount on tab changes
  // removed — using restored custom overflow state below

  const activeTab = tabs.find((t) => t.id === activeTabId) || null;
  const isRecommendationsTab = activeTabId === 'recommendations';
  // Detect WYSIWYG preview tab to show "Return to editor" banner
  const isWysiwygPreview =
    activeTab?.baseUrl === 'bundled:wysiwyg-preview' || activeTab?.content?.url === 'bundled:wysiwyg-preview';
  const theme = useStyles2((theme: GrafanaTheme2) => theme);

  // STABILITY: Memoize activeTab.content to prevent ContentRenderer from remounting
  // when other tab properties change (isLoading, error, etc.)
  const stableContent = React.useMemo(() => activeTab?.content, [activeTab?.content]);

  // Check for interactive progress when content changes to show reset button
  // MUST use currentUrl || baseUrl (not content.url) to match getContentKey() in interactive sections.
  // content.url includes "/content.json" suffix which causes a key mismatch with saved progress.
  const progressKey = activeTab?.currentUrl || activeTab?.baseUrl || '';

  // Helper to check and update progress state
  const checkProgress = React.useCallback(() => {
    if (progressKey) {
      interactiveStepStorage.hasProgress(progressKey).then(setHasInteractiveProgress);
    } else {
      setHasInteractiveProgress(false);
    }
  }, [progressKey]);

  // Check progress when content key changes
  React.useEffect(() => {
    checkProgress();
  }, [checkProgress]);

  // Listen for progress saved events to update reset button reactively
  React.useEffect(() => {
    const handleProgressSaved = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      // Only update if this event is for the current tab's content
      if (detail?.contentKey === progressKey && detail?.hasProgress) {
        setHasInteractiveProgress(true);
      }
    };

    window.addEventListener('interactive-progress-saved', handleProgressSaved);
    return () => {
      window.removeEventListener('interactive-progress-saved', handleProgressSaved);
    };
  }, [progressKey]);

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

  // Content reset hook - handles complex storage/state/reload orchestration
  const handleResetGuide = useContentReset({ model, setHasInteractiveProgress });

  // Helper: Reload active tab content (DRY - was duplicated 3x)
  const reloadActiveTab = useCallback(
    (tab: LearningJourneyTab) => {
      if (isDocsLikeTab(tab.type)) {
        model.loadDocsTabContent(tab.id, tab.currentUrl || tab.baseUrl);
      } else {
        model.loadTabContent(tab.id, tab.currentUrl || tab.baseUrl);
      }
    },
    [model]
  );

  // Expose current active tab id/url globally for interactive persistence keys.
  // MUST be useLayoutEffect so the globals are set before children's useEffect
  // (progress restoration) runs. useEffect runs bottom-up (children first),
  // so a parent useEffect would still hold the PREVIOUS milestone's URL when
  // InteractiveSection restores progress. useLayoutEffect fires synchronously
  // before any passive effects, guaranteeing the correct URL is available.
  useLayoutEffect(() => {
    try {
      (window as any).__DocsPluginActiveTabId = activeTab?.id || '';
      (window as any).__DocsPluginActiveTabUrl = activeTab?.currentUrl || activeTab?.baseUrl || '';
    } catch {
      // no-op
    }
  }, [activeTab?.id, activeTab?.currentUrl, activeTab?.baseUrl]);

  // Auto-complete last milestone on arrival if it has no interactive steps.
  // The last milestone has no "Next" button, so there is no click-based trigger
  // to mark it as done. We wait for the DOM to render, then check for interactive
  // step elements. If none are found, we mark the milestone complete immediately.
  useEffect(() => {
    if (!stableContent || stableContent.type !== 'learning-journey' || !activeTab?.currentUrl || !activeTab?.baseUrl) {
      return;
    }

    if (!isLastMilestone(stableContent)) {
      return;
    }

    const timer = setTimeout(() => {
      const container = contentRef?.current;
      if (!container) {
        return;
      }

      const hasInteractiveSteps = container.querySelectorAll('[data-step-id]').length > 0;
      if (!hasInteractiveSteps) {
        const slug = getMilestoneSlug(activeTab.currentUrl!);
        if (slug) {
          void markMilestoneDone(activeTab.baseUrl!, slug, stableContent.metadata?.learningJourney?.totalMilestones);
        }
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [stableContent, activeTab?.currentUrl, activeTab?.baseUrl, contentRef]);

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
    if (sessionRole === 'attendee' && navigationManagerRef.current && attendeeMode && !actionReplayRef.current) {
      logSession(`[DocsPanel] Initializing ActionReplaySystem for attendee in ${attendeeMode} mode`);
      actionReplayRef.current = new ActionReplaySystem(attendeeMode, navigationManagerRef.current);
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
  }, [sessionRole, attendeeMode, logSession]);

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

      // Open the tutorial in a new tab
      if (url.includes('/learning-journeys/') || url.includes('/learning-paths/')) {
        model.openLearningJourney(url, title);
      } else {
        model.openDocsPage(url, title);
      }
    }
  }, [sessionRole, sessionInfo, model, logSession]);

  // Tab persistence is now handled explicitly in the model methods
  // No need for automatic saving here as it's done when tabs are created/modified
  // Note: Click-outside and dropdown positioning now handled by useTabOverflow hook

  // Auto-launch tutorial detection
  useEffect(() => {
    const handleAutoLaunchTutorial = (event: CustomEvent) => {
      const { url, title, type } = event.detail;

      // Track auto-launch analytics - unified event for opening any resource
      reportAppInteraction(UserInteraction.OpenResourceClick, {
        content_title: title,
        content_url: url,
        content_type: getContentTypeForAnalytics(url, type === 'docs-page' ? 'docs' : 'learning-journey'),
        trigger_source: 'auto_launch_tutorial',
        interaction_location: 'docs_panel',
        ...(type === 'learning-journey' && {
          completion_percentage: 0, // Auto-launch is always starting fresh
        }),
      });

      if (url && title) {
        model.openLearningJourney(url, title);
      }

      // send an event so we know the page has been loaded
      const launchEvent = new CustomEvent('auto-launch-complete', {
        detail: event.detail,
      });
      window.dispatchEvent(launchEvent);
    };

    document.addEventListener('auto-launch-tutorial', handleAutoLaunchTutorial as EventListener);

    return () => {
      document.removeEventListener('auto-launch-tutorial', handleAutoLaunchTutorial as EventListener);
    };
  }, [model]);

  // Scroll tracking
  useEffect(() => {
    // Only set up scroll tracking for actual content tabs (not recommendations)
    if (!isRecommendationsTab && activeTab && activeTab.content) {
      // Find the actual scrollable element (the div with overflow: auto)
      const scrollableElement = document.getElementById('inner-docs-content');

      if (scrollableElement) {
        const cleanup = setupScrollTracking(scrollableElement, activeTab, isRecommendationsTab);
        return cleanup;
      }
    }

    return undefined;
  }, [activeTab, activeTab?.content, isRecommendationsTab]);

  // ContentRenderer renders the content with styling applied via CSS classes

  return (
    <div
      id="CombinedLearningJourney"
      className={styles.container}
      data-pathfinder-content="true"
      data-testid={testIds.docsPanel.container}
    >
      {/* Live session controls - only render when there's session content */}
      {(isLiveSessionsEnabled || isSessionActive) && (
        <div className={styles.topBar}>
          <div className={styles.liveSessionButtons}>
            {!isSessionActive && isLiveSessionsEnabled && (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  icon="users-alt"
                  onClick={() => setShowPresenterControls(true)}
                  tooltip="Start a live session to broadcast your actions to attendees"
                >
                  Start live session
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  icon="user"
                  onClick={() => setShowAttendeeJoin(true)}
                  tooltip="Join an existing live session"
                >
                  Join live session
                </Button>
              </>
            )}
            {isSessionActive && sessionRole === 'presenter' && (
              <>
                <Button size="sm" variant="primary" icon="circle" onClick={() => setShowPresenterControls(true)}>
                  Session active
                </Button>
                <div ref={handRaiseIndicatorRef}>
                  <HandRaiseIndicator count={handRaises.length} onClick={() => setShowHandRaiseQueue(true)} />
                </div>
              </>
            )}
            {isSessionActive && sessionRole === 'attendee' && (
              <Alert title="" severity="success" style={{ margin: 0, padding: '8px 12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Icon name="check-circle" />
                    <span style={{ fontWeight: 500 }}>Connected to: {sessionInfo?.config.name || 'Live session'}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '12px', color: 'rgba(204, 204, 220, 0.85)' }}>Mode:</span>
                    <ButtonGroup>
                      <Button
                        size="sm"
                        variant={attendeeMode === 'guided' ? 'primary' : 'secondary'}
                        onClick={() => {
                          if (attendeeMode !== 'guided') {
                            const newMode: AttendeeMode = 'guided';
                            // Update session state
                            setAttendeeMode(newMode);
                            // Update ActionReplaySystem
                            if (actionReplayRef.current) {
                              actionReplayRef.current.setMode(newMode);
                            }
                            // Send mode change to presenter
                            if (sessionManager) {
                              sessionManager.sendToPresenter({
                                type: 'mode_change',
                                sessionId: sessionInfo?.sessionId || '',
                                timestamp: Date.now(),
                                senderId: sessionManager.getRole() || 'attendee',
                                mode: newMode,
                              } as any);
                            }
                            logSession('[DocsPanel] Switched to Guided mode');
                          }
                        }}
                        tooltip="Only see highlights when presenter clicks Show Me"
                      >
                        Guided
                      </Button>
                      <Button
                        size="sm"
                        variant={attendeeMode === 'follow' ? 'primary' : 'secondary'}
                        onClick={() => {
                          if (attendeeMode !== 'follow') {
                            const newMode: AttendeeMode = 'follow';
                            // Update session state
                            setAttendeeMode(newMode);
                            // Update ActionReplaySystem
                            if (actionReplayRef.current) {
                              actionReplayRef.current.setMode(newMode);
                            }
                            // Send mode change to presenter
                            if (sessionManager) {
                              sessionManager.sendToPresenter({
                                type: 'mode_change',
                                sessionId: sessionInfo?.sessionId || '',
                                timestamp: Date.now(),
                                senderId: sessionManager.getRole() || 'attendee',
                                mode: newMode,
                              } as any);
                            }
                            logSession('[DocsPanel] Switched to Follow mode');
                          }
                        }}
                        tooltip="Execute actions automatically when presenter clicks Do It"
                      >
                        Follow
                      </Button>
                    </ButtonGroup>
                    <HandRaiseButton isRaised={isHandRaised} onToggle={handleHandRaiseToggle} />
                    <Button
                      size="sm"
                      variant="secondary"
                      icon="times"
                      onClick={() => {
                        if (confirm('Leave this live session?')) {
                          endSession();
                        }
                      }}
                      tooltip="Leave the live session"
                    >
                      Leave
                    </Button>
                  </div>
                </div>
              </Alert>
            )}
          </div>
        </div>
      )}

      {/* Tab bar - always show permanent tabs, show guide tabs when open */}
      <div className={styles.tabBar} ref={tabBarRef} data-testid={testIds.docsPanel.tabBar}>
        {/* Permanent icon-only tabs */}
        <div className={styles.permanentTabs}>
          <button
            className={`${styles.iconTab} ${activeTabId === 'recommendations' ? styles.iconTabActive : ''}`}
            onClick={() => model.setActiveTab('recommendations')}
            title={t('docsPanel.recommendations', 'Recommendations')}
            data-testid={testIds.docsPanel.recommendationsTab}
          >
            <Icon name="document-info" size="md" />
          </button>
          {isDevMode && (
            <button
              className={`${styles.iconTab} ${activeTabId === 'devtools' ? styles.iconTabActive : ''}`}
              onClick={() => model.setActiveTab('devtools')}
              title={t('docsPanel.devTools', 'Dev tools')}
              data-testid={testIds.docsPanel.tab('devtools')}
            >
              <Icon name="bug" size="md" />
            </button>
          )}
        </div>

        {/* Divider - only show when there are guide tabs */}
        {visibleTabs.filter((t) => t.id !== 'recommendations' && t.id !== 'devtools').length > 0 && (
          <div className={styles.tabDivider} />
        )}

        {/* Guide tabs with titles */}
        <div className={styles.tabList} ref={tabListRef} data-testid={testIds.docsPanel.tabList}>
          {visibleTabs
            .filter((tab) => tab.id !== 'recommendations' && tab.id !== 'devtools')
            .map((tab) => {
              return (
                <button
                  key={tab.id}
                  className={`${styles.tab} ${tab.id === activeTabId ? styles.activeTab : ''}`}
                  onClick={() => model.setActiveTab(tab.id)}
                  title={getTranslatedTitle(tab.title)}
                  data-testid={testIds.docsPanel.tab(tab.id)}
                >
                  <div className={styles.tabContent}>
                    {tab.type === 'devtools' && <Icon name="bug" size="xs" className={styles.tabIcon} />}
                    <span className={styles.tabTitle}>
                      {tab.isLoading ? (
                        <>
                          <Icon name="sync" size="xs" />
                          <span>{t('docsPanel.loading', 'Loading...')}</span>
                        </>
                      ) : (
                        getTranslatedTitle(tab.title)
                      )}
                    </span>
                    <IconButton
                      name="times"
                      size="sm"
                      aria-label={t('docsPanel.closeTab', 'Close {{title}}', {
                        title: getTranslatedTitle(tab.title),
                      })}
                      onClick={(e) => {
                        e.stopPropagation();
                        reportAppInteraction(UserInteraction.CloseTabClick, {
                          content_type: getContentTypeForAnalytics(
                            tab.currentUrl || tab.baseUrl,
                            tab.type || 'learning-journey'
                          ),
                          tab_title: tab.title,
                          content_url: tab.currentUrl || tab.baseUrl,
                          interaction_location: 'tab_button',
                          ...(tab.type === 'learning-journey' &&
                            tab.content && {
                              completion_percentage: getJourneyProgress(tab.content),
                              current_milestone: tab.content.metadata?.learningJourney?.currentMilestone,
                              total_milestones: tab.content.metadata?.learningJourney?.totalMilestones,
                            }),
                        });
                        model.closeTab(tab.id);
                      }}
                      className={styles.closeButton}
                      data-testid={testIds.docsPanel.tabCloseButton(tab.id)}
                    />
                  </div>
                </button>
              );
            })}
        </div>

        {overflowedTabs.filter((t) => t.id !== 'recommendations' && t.id !== 'devtools').length > 0 && (
          <div className={styles.tabOverflow}>
            <button
              ref={chevronButtonRef}
              className={`${styles.tab} ${styles.chevronTab}`}
              onClick={() => {
                if (!isDropdownOpen) {
                  dropdownOpenTimeRef.current = Date.now();
                }
                setIsDropdownOpen(!isDropdownOpen);
              }}
              aria-label={t('docsPanel.showMoreTabs', 'Show {{count}} more tabs', {
                count: overflowedTabs.filter((t) => t.id !== 'recommendations' && t.id !== 'devtools').length,
              })}
              aria-expanded={isDropdownOpen}
              aria-haspopup="true"
              data-testid={testIds.docsPanel.tabOverflowButton}
            >
              <Icon name="angle-down" size="sm" />
              <span>+{overflowedTabs.filter((t) => t.id !== 'recommendations' && t.id !== 'devtools').length}</span>
            </button>
          </div>
        )}

        {isDropdownOpen &&
          overflowedTabs.filter((t) => t.id !== 'recommendations' && t.id !== 'devtools').length > 0 && (
            <div
              ref={dropdownRef}
              className={styles.tabDropdown}
              role="menu"
              aria-label={t('docsPanel.moreTabsMenu', 'More tabs')}
              data-testid={testIds.docsPanel.tabDropdown}
            >
              {overflowedTabs
                .filter((tab) => tab.id !== 'recommendations' && tab.id !== 'devtools')
                .map((tab) => {
                  return (
                    <button
                      key={tab.id}
                      className={`${styles.dropdownItem} ${tab.id === activeTabId ? styles.activeDropdownItem : ''}`}
                      onClick={() => {
                        model.setActiveTab(tab.id);
                        setIsDropdownOpen(false);
                      }}
                      role="menuitem"
                      aria-label={t('docsPanel.switchToTab', 'Switch to {{title}}', {
                        title: getTranslatedTitle(tab.title),
                      })}
                      data-testid={testIds.docsPanel.tabDropdownItem(tab.id)}
                    >
                      <div className={styles.dropdownItemContent}>
                        {tab.type === 'devtools' && <Icon name="bug" size="xs" className={styles.dropdownItemIcon} />}
                        <span className={styles.dropdownItemTitle}>
                          {tab.isLoading ? (
                            <>
                              <Icon name="sync" size="xs" />
                              <span>{t('docsPanel.loading', 'Loading...')}</span>
                            </>
                          ) : (
                            getTranslatedTitle(tab.title)
                          )}
                        </span>
                        <IconButton
                          name="times"
                          size="sm"
                          aria-label={t('docsPanel.closeTab', 'Close {{title}}', {
                            title: getTranslatedTitle(tab.title),
                          })}
                          onClick={(e) => {
                            e.stopPropagation();
                            reportAppInteraction(UserInteraction.CloseTabClick, {
                              content_type: getContentTypeForAnalytics(
                                tab.currentUrl || tab.baseUrl,
                                tab.type || 'learning-journey'
                              ),
                              tab_title: tab.title,
                              content_url: tab.currentUrl || tab.baseUrl,
                              close_location: 'dropdown',
                              ...(tab.type === 'learning-journey' &&
                                tab.content && {
                                  completion_percentage: getJourneyProgress(tab.content),
                                  current_milestone: tab.content.metadata?.learningJourney?.currentMilestone,
                                  total_milestones: tab.content.metadata?.learningJourney?.totalMilestones,
                                }),
                            });
                            model.closeTab(tab.id);
                          }}
                          className={styles.dropdownItemClose}
                        />
                      </div>
                    </button>
                  );
                })}
            </div>
          )}

        {/* Menu and close actions */}
        <TabBarActions className={styles.tabBarActions} />
      </div>

      <div className={styles.content} data-testid={testIds.docsPanel.content}>
        {(() => {
          // Show recommendations tab
          if (isRecommendationsTab) {
            return <contextPanel.Component model={contextPanel} />;
          }

          // Show dev tools tab
          if (activeTabId === 'devtools') {
            return (
              <div className={styles.devToolsContent} data-testid="devtools-tab-content">
                <Suspense fallback={<SkeletonLoader type="recommendations" />}>
                  <SelectorDebugPanel
                    onOpenDocsPage={(url: string, title: string) => model.openDocsPage(url, title, true)}
                    onOpenLearningJourney={(url: string, title: string) => model.openLearningJourney(url, title)}
                  />
                </Suspense>
              </div>
            );
          }

          // Show loading state with skeleton
          if (!isRecommendationsTab && activeTab?.isLoading) {
            return (
              <LoadingIndicator
                className={isDocsLikeTab(activeTab.type) ? styles.docsContent : styles.journeyContent}
                contentType={isDocsLikeTab(activeTab.type) ? 'documentation' : 'learning-journey'}
              />
            );
          }

          // Show error state with retry option
          if (!isRecommendationsTab && activeTab?.error && !activeTab.isLoading) {
            return (
              <ErrorDisplay
                className={isDocsLikeTab(activeTab.type) ? styles.docsContent : styles.journeyContent}
                contentType={isDocsLikeTab(activeTab.type) ? 'documentation' : 'learning-journey'}
                error={activeTab.error}
                onRetry={() => reloadActiveTab(activeTab)}
              />
            );
          }

          // Show content - both learning journeys and docs use the same ContentRenderer now!
          if (!isRecommendationsTab && activeTab?.content && !activeTab.isLoading) {
            const isLearningJourneyTab = activeTab.type === 'learning-journey' || !isDocsLikeTab(activeTab.type);
            const showMilestoneProgress =
              isLearningJourneyTab &&
              activeTab.content?.type === 'learning-journey' &&
              activeTab.content.metadata.learningJourney;

            return (
              <div className={isDocsLikeTab(activeTab.type) ? styles.docsContent : styles.journeyContent}>
                {/* Return to Editor Banner - only shown for WYSIWYG preview */}
                {isWysiwygPreview && (
                  <div className={styles.returnToEditorBanner} data-testid={testIds.devTools.previewBanner}>
                    <div className={styles.returnToEditorLeft} data-testid={testIds.devTools.previewModeIndicator}>
                      <Icon name="eye" size="sm" />
                      <span>{t('docsPanel.previewMode', 'Preview mode')}</span>
                    </div>
                    <button
                      className={styles.returnToEditorButton}
                      onClick={() => model.openDevToolsTab()}
                      data-testid={testIds.devTools.returnToEditorButton}
                    >
                      <Icon name="arrow-left" size="sm" />
                      {t('docsPanel.returnToEditor', 'Return to editor')}
                    </button>
                  </div>
                )}

                {/* Content Meta for learning path pages (when no milestone progress is shown) */}
                {isLearningJourneyTab && !showMilestoneProgress && (
                  <div className={styles.contentMeta}>
                    <div className={styles.metaInfo}>
                      <span>{t('docsPanel.learningJourney', 'Learning path')}</span>
                    </div>
                    <small>
                      {(activeTab.content?.metadata.learningJourney?.totalMilestones || 0) > 0
                        ? t('docsPanel.milestonesCount', '{{count}} milestones', {
                            count: activeTab.content?.metadata.learningJourney?.totalMilestones,
                          })
                        : t('docsPanel.interactiveJourney', 'Interactive journey')}
                    </small>
                  </div>
                )}

                {/* Content Meta for docs/interactive - now includes secondary open-in-new button */}
                {isDocsLikeTab(activeTab.type) && (
                  <div className={styles.contentMeta}>
                    <div className={styles.metaInfo}>
                      <span>
                        {activeTab.type === 'interactive'
                          ? t('docsPanel.interactiveGuide', 'Interactive guide')
                          : t('docsPanel.documentation', 'Documentation')}
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        gap: 8,
                      }}
                    >
                      {(() => {
                        const url = activeTab.content?.url || activeTab.baseUrl;
                        if (isGrafanaDocsUrl(url)) {
                          const cleanUrl = cleanDocsUrl(url);

                          return (
                            <button
                              className={styles.secondaryActionButton}
                              aria-label={t('docsPanel.openInNewTab', 'Open this page in new tab')}
                              onClick={() => {
                                reportAppInteraction(UserInteraction.OpenExtraResource, {
                                  content_url: cleanUrl,
                                  content_type: getContentTypeForAnalytics(cleanUrl, activeTab.type || 'docs'),
                                  link_text: activeTab.title,
                                  source_page: activeTab.content?.url || activeTab.baseUrl || 'unknown',
                                  link_type: 'external_browser',
                                  interaction_location: 'docs_content_meta_right',
                                });
                                // Delay to ensure analytics event is sent before opening new tab
                                setTimeout(() => {
                                  window.open(cleanUrl, '_blank', 'noopener,noreferrer');
                                }, 100);
                              }}
                            >
                              <Icon name="external-link-alt" size="sm" />
                              <span>{t('docsPanel.open', 'Open')}</span>
                            </button>
                          );
                        }
                        return null;
                      })()}
                      {isDevMode && (
                        <IconButton
                          tooltip="Refresh tab (dev mode only)"
                          name="sync"
                          onClick={() => {
                            if (activeTab) {
                              reloadActiveTab(activeTab);
                            }
                          }}
                        />
                      )}
                      {hasInteractiveProgress && (
                        <button
                          className={styles.secondaryActionButton}
                          aria-label={t('docsPanel.resetGuide', 'Reset guide')}
                          title={t('docsPanel.resetGuideTooltip', 'Resets all interactive steps')}
                          onClick={async () => {
                            if (progressKey && activeTab) {
                              await handleResetGuide(progressKey, activeTab);
                            }
                          }}
                        >
                          <Icon name="history-alt" size="sm" />
                          <span>{t('docsPanel.resetGuide', 'Reset guide')}</span>
                        </button>
                      )}
                      <FeedbackButton
                        variant="secondary"
                        contentUrl={activeTab.content?.url || activeTab.baseUrl}
                        contentType={activeTab.type || 'learning-journey'}
                        interactionLocation="docs_panel_header_feedback_button"
                        currentMilestone={activeTab.content?.metadata?.learningJourney?.currentMilestone}
                        totalMilestones={activeTab.content?.metadata?.learningJourney?.totalMilestones}
                      />
                    </div>
                  </div>
                )}

                {/* Milestone Progress - only show for learning journey milestone pages */}
                {showMilestoneProgress && (
                  <div className={styles.milestoneProgress}>
                    <div className={styles.progressInfo}>
                      <div className={styles.progressHeader}>
                        <IconButton
                          name="arrow-left"
                          size="sm"
                          aria-label={t('docsPanel.previousMilestone', 'Previous milestone')}
                          onClick={() => {
                            reportAppInteraction(UserInteraction.MilestoneArrowInteractionClick, {
                              content_title: activeTab.title,
                              content_url: activeTab.baseUrl,
                              current_milestone: activeTab.content?.metadata.learningJourney?.currentMilestone || 0,
                              total_milestones: activeTab.content?.metadata.learningJourney?.totalMilestones || 0,
                              direction: 'backward',
                              interaction_location: 'milestone_progress_bar',
                              completion_percentage: activeTab.content ? getJourneyProgress(activeTab.content) : 0,
                            });

                            model.navigateToPreviousMilestone();
                          }}
                          tooltip={t('docsPanel.previousMilestoneTooltip', 'Previous milestone (Alt + ←)')}
                          tooltipPlacement="top"
                          disabled={!model.canNavigatePrevious() || activeTab.isLoading}
                          className={styles.navButton}
                        />
                        <span className={styles.milestoneText}>
                          {activeTab.content?.metadata.learningJourney?.currentMilestone === 0
                            ? t('docsPanel.milestoneIntroduction', 'Introduction ({{total}} milestones)', {
                                total: activeTab.content?.metadata.learningJourney?.totalMilestones,
                              })
                            : t('docsPanel.milestoneProgress', 'Milestone {{current}} of {{total}}', {
                                current: activeTab.content?.metadata.learningJourney?.currentMilestone,
                                total: activeTab.content?.metadata.learningJourney?.totalMilestones,
                              })}
                        </span>
                        <IconButton
                          name="arrow-right"
                          size="sm"
                          aria-label={t('docsPanel.nextMilestone', 'Next milestone')}
                          onClick={() => {
                            reportAppInteraction(UserInteraction.MilestoneArrowInteractionClick, {
                              content_title: activeTab.title,
                              content_url: activeTab.baseUrl,
                              current_milestone: activeTab.content?.metadata.learningJourney?.currentMilestone || 0,
                              total_milestones: activeTab.content?.metadata.learningJourney?.totalMilestones || 0,
                              direction: 'forward',
                              interaction_location: 'milestone_progress_bar',
                              completion_percentage: activeTab.content ? getJourneyProgress(activeTab.content) : 0,
                            });

                            // Mark current milestone done if it has no interactive steps
                            if (
                              activeTab.content?.type === 'learning-journey' &&
                              activeTab.currentUrl &&
                              activeTab.baseUrl
                            ) {
                              const hasInteractiveSteps =
                                (contentRef?.current?.querySelectorAll('[data-step-id]').length ?? 0) > 0;
                              if (!hasInteractiveSteps) {
                                const slug = getMilestoneSlug(activeTab.currentUrl);
                                if (slug) {
                                  void markMilestoneDone(
                                    activeTab.baseUrl,
                                    slug,
                                    activeTab.content?.metadata?.learningJourney?.totalMilestones
                                  );
                                }
                              }
                            }

                            model.navigateToNextMilestone();
                          }}
                          tooltip={t('docsPanel.nextMilestoneTooltip', 'Next milestone (Alt + →)')}
                          tooltipPlacement="top"
                          disabled={!model.canNavigateNext() || activeTab.isLoading}
                          className={styles.navButton}
                        />
                      </div>
                      <div className={styles.progressBar}>
                        <div
                          className={styles.progressFill}
                          style={{
                            width: `${
                              ((activeTab.content?.metadata.learningJourney?.currentMilestone || 0) /
                                (activeTab.content?.metadata.learningJourney?.totalMilestones || 1)) *
                              100
                            }%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Content Action Bar removed for docs to reclaim vertical space */}
                {!isDocsLikeTab(activeTab.type) && (
                  <div className={styles.contentActionBar}>
                    <IconButton
                      name="external-link-alt"
                      size="xs"
                      aria-label={`Open this journey in new tab`}
                      onClick={() => {
                        const url = activeTab.content?.url || activeTab.baseUrl;
                        if (url) {
                          // Strip /unstyled.html from URL for browser viewing (users want the styled docs page)
                          const cleanUrl = url.replace(/\/unstyled\.html$/, '');

                          reportAppInteraction(UserInteraction.OpenExtraResource, {
                            content_url: cleanUrl,
                            content_type: getContentTypeForAnalytics(cleanUrl, activeTab.type || 'learning-journey'),
                            link_text: activeTab.title,
                            source_page: activeTab.content?.url || activeTab.baseUrl || 'unknown',
                            link_type: 'external_browser',
                            interaction_location: 'journey_content_action_bar',
                            ...(!isDocsLikeTab(activeTab.type) &&
                              activeTab.content?.metadata.learningJourney && {
                                current_milestone: activeTab.content.metadata.learningJourney.currentMilestone,
                                total_milestones: activeTab.content.metadata.learningJourney.totalMilestones,
                                completion_percentage: getJourneyProgress(activeTab.content),
                              }),
                          });
                          // Delay to ensure analytics event is sent before opening new tab
                          setTimeout(() => {
                            window.open(cleanUrl, '_blank', 'noopener,noreferrer');
                          }, 100);
                        }
                      }}
                      tooltip={`Open this journey in new tab`}
                      tooltipPlacement="top"
                      className={styles.actionButton}
                    />
                  </div>
                )}

                {/* Unified Content Renderer - works for both learning journeys and docs! */}
                <div
                  id="inner-docs-content"
                  style={{
                    flex: 1,
                    overflow: 'auto',
                    minHeight: 0,
                  }}
                >
                  {stableContent && (
                    <ContentRenderer
                      key={activeTab?.currentUrl || stableContent.url}
                      content={stableContent}
                      containerRef={contentRef}
                      className={`${
                        stableContent.type === 'learning-journey' ? journeyStyles : docsStyles
                      } ${interactiveStyles} ${prismStyles}`}
                      onContentReady={() => {
                        // Restore scroll position after content is ready
                        restoreScrollPosition();
                      }}
                      onGuideComplete={() => {
                        const baseUrl = activeTab?.baseUrl || stableContent.url;

                        // Mark bundled guides as 100% complete when all interactive steps finish
                        if (baseUrl?.startsWith('bundled:')) {
                          setJourneyCompletionPercentage(baseUrl, 100);
                        }

                        // Mark learning journey milestones as done when all interactive steps finish
                        if (stableContent.type === 'learning-journey' && activeTab?.currentUrl) {
                          const slug = getMilestoneSlug(activeTab.currentUrl);
                          const journeyBase = activeTab.baseUrl;
                          if (slug && journeyBase) {
                            markMilestoneDone(
                              journeyBase,
                              slug,
                              stableContent.metadata?.learningJourney?.totalMilestones
                            );
                          }
                        }
                      }}
                    />
                  )}

                  {/* Go home button - always visible at bottom of content */}
                  <div className={styles.contentFooterAction}>
                    <Button
                      variant="secondary"
                      icon="book-open"
                      size="md"
                      onClick={() => {
                        window.location.assign(PLUGIN_BASE_URL);
                      }}
                    >
                      {t('docsPanel.returnToMyLearning', 'Return to my learning')}
                    </Button>
                  </div>
                </div>
              </div>
            );
          }

          return null;
        })()}
      </div>

      {/* Coda Terminal Panel - only shown in dev mode with terminal feature enabled */}
      {isDevMode && pluginConfig.enableCodaTerminal && (
        <Suspense fallback={null}>
          <TerminalPanel />
        </Suspense>
      )}

      {/* Feedback Button - only shown at bottom for non-docs views; docs uses header placement */}
      {!isRecommendationsTab && !isDocsLikeTab(activeTab?.type) && (
        <>
          <FeedbackButton
            contentUrl={activeTab?.content?.url || activeTab?.baseUrl || ''}
            contentType={activeTab?.type || 'learning-journey'}
            interactionLocation="docs_panel_footer_feedback_button"
            currentMilestone={activeTab?.content?.metadata?.learningJourney?.currentMilestone}
            totalMilestones={activeTab?.content?.metadata?.learningJourney?.totalMilestones}
          />
        </>
      )}

      {/* Live Session Modals */}
      {showPresenterControls && !isSessionActive && (
        <div
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 10000,
            background: theme.colors.background.primary,
            borderRadius: theme.shape.radius.default,
            boxShadow: theme.shadows.z3,
            padding: theme.spacing(3),
            maxWidth: '600px',
            maxHeight: '90vh',
            overflow: 'auto',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: theme.spacing(2),
            }}
          >
            <h3 style={{ margin: 0 }}>Live Session</h3>
            <IconButton name="times" size="lg" onClick={() => setShowPresenterControls(false)} aria-label="Close" />
          </div>
          <PresenterControls tutorialUrl={activeTab?.currentUrl || activeTab?.baseUrl || ''} />
        </div>
      )}

      {showPresenterControls && isSessionActive && sessionRole === 'presenter' && (
        <div
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 10000,
            background: theme.colors.background.primary,
            borderRadius: theme.shape.radius.default,
            boxShadow: theme.shadows.z3,
            padding: theme.spacing(3),
            maxWidth: '600px',
            maxHeight: '90vh',
            overflow: 'auto',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: theme.spacing(2),
            }}
          >
            <h3 style={{ margin: 0 }}>Live Session</h3>
            <IconButton name="times" size="lg" onClick={() => setShowPresenterControls(false)} aria-label="Close" />
          </div>
          <PresenterControls tutorialUrl={activeTab?.currentUrl || activeTab?.baseUrl || ''} />
        </div>
      )}

      <AttendeeJoin
        isOpen={showAttendeeJoin}
        onClose={() => setShowAttendeeJoin(false)}
        onJoined={() => {
          setShowAttendeeJoin(false);
          // TODO: Start listening for presenter events
        }}
      />

      <HandRaiseQueue
        handRaises={handRaises}
        isOpen={showHandRaiseQueue}
        onClose={() => setShowHandRaiseQueue(false)}
        anchorRef={handRaiseIndicatorRef}
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

// Wrap the renderer with SessionProvider so it has access to session context
function CombinedPanelRenderer(props: SceneComponentProps<CombinedLearningJourneyPanel>) {
  return (
    <SessionProvider>
      <CombinedPanelRendererInner {...props} />
    </SessionProvider>
  );
}

// Export the main component and keep backward compatibility
export { CombinedLearningJourneyPanel };
export class LearningJourneyPanel extends CombinedLearningJourneyPanel {}
export class DocsPanel extends CombinedLearningJourneyPanel {}
