// Combined Learning Journey and Docs Panel
// Post-refactoring unified component using new content system only

import React, { useState, useEffect, useRef, useCallback, Suspense, lazy } from 'react';
import { SceneObjectBase, SceneComponentProps } from '@grafana/scenes';
import { IconButton, Alert, Icon, useStyles2, Button, ButtonGroup } from '@grafana/ui';

// Lazy load dev tools to keep them out of production bundles
// This component is only loaded when dev mode is enabled and the tab is opened
const SelectorDebugPanel = lazy(() =>
  import('../SelectorDebugPanel').then((module) => ({
    default: module.SelectorDebugPanel,
  }))
);
import { GrafanaTheme2, usePluginContext } from '@grafana/data';
import { t } from '@grafana/i18n';
import { DocsPluginConfig, ALLOWED_GRAFANA_DOCS_HOSTNAMES, getConfigWithDefaults } from '../../constants';

import { useInteractiveElements, NavigationManager } from '../../interactive-engine';
import { useKeyboardShortcuts } from '../../utils/keyboard-shortcuts.hook';
import { useLinkClickHandler } from '../../utils/link-handler.hook';
import { isDevModeEnabledGlobal, isDevModeEnabled } from '../../utils/dev-mode';
import { parseUrlSafely, isAllowedContentUrl, isLocalhostUrl, isGitHubRawUrl } from '../../security';

import {
  setupScrollTracking,
  reportAppInteraction,
  UserInteraction,
  getContentTypeForAnalytics,
} from '../../lib/analytics';
import { tabStorage, useUserStorage, learningProgressStorage } from '../../lib/user-storage';
import { FeedbackButton } from '../FeedbackButton/FeedbackButton';
import { SkeletonLoader } from '../SkeletonLoader';

// Import new unified content system
import {
  fetchContent,
  ContentRenderer,
  getNextMilestoneUrlFromContent,
  getPreviousMilestoneUrlFromContent,
} from '../../docs-retrieval';

// Import learning journey helpers
import { getJourneyProgress, setJourneyCompletionPercentage } from '../../docs-retrieval/learning-journey-helpers';

import { ContextPanel } from './context-panel';
import { MyLearningTab, BadgeUnlockedToast } from '../LearningPaths';
import { getBadgeById } from '../../learning-paths';

import { getStyles as getComponentStyles, addGlobalModalStyles } from '../../styles/docs-panel.styles';
import { journeyContentHtml, docsContentHtml } from '../../styles/content-html.styles';
import { getInteractiveStyles } from '../../styles/interactive.styles';
import { getPrismStyles } from '../../styles/prism.styles';
import { config, getAppEvents, locationService } from '@grafana/runtime';
import logoSvg from '../../img/logo.svg';
import { PresenterControls, AttendeeJoin, HandRaiseButton, HandRaiseIndicator, HandRaiseQueue } from '../LiveSession';
import { SessionProvider, useSession, ActionReplaySystem, ActionCaptureSystem } from '../../integrations/workshop';
import type { AttendeeMode } from '../../types/collaboration.types';
import { linkInterceptionState } from '../../global-state/link-interception';
import { testIds } from '../testIds';

// Use the properly extracted styles
const getStyles = getComponentStyles;

// Import centralized types
import { LearningJourneyTab, PersistedTabData, CombinedPanelState } from '../../types/content-panel.types';

class CombinedLearningJourneyPanel extends SceneObjectBase<CombinedPanelState> {
  public static Component = CombinedPanelRenderer;

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
      {
        id: 'my-learning',
        title: 'My learning',
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
    const restoredTabs = await CombinedLearningJourneyPanel.restoreTabsFromStorage();
    const activeTabId = await CombinedLearningJourneyPanel.restoreActiveTabFromStorage(restoredTabs);

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
        if (activeTab.type === 'docs') {
          this.loadDocsTabContent(activeTab.id, activeTab.currentUrl || activeTab.baseUrl);
        } else {
          this.loadTabContent(activeTab.id, activeTab.currentUrl || activeTab.baseUrl);
        }
      }
    }
  }

  private static async restoreTabsFromStorage(): Promise<LearningJourneyTab[]> {
    try {
      const parsedData = await tabStorage.getTabs<PersistedTabData>();

      if (!parsedData || parsedData.length === 0) {
        // Return default tabs if no stored data
        return [
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
      }

      const tabs: LearningJourneyTab[] = [
        {
          id: 'recommendations',
          title: 'Recommendations', // Will be translated in renderer
          baseUrl: '',
          currentUrl: '',
          content: null,
          isLoading: false,
          error: null,
        },
      ];

      parsedData.forEach((data) => {
        // Handle devtools tab specially - it has no URLs to validate
        if (data.type === 'devtools') {
          tabs.push({
            id: 'devtools',
            title: 'Dev Tools',
            baseUrl: '',
            currentUrl: '',
            content: null,
            isLoading: false,
            error: null,
            type: 'devtools',
          });
          return;
        }

        // SECURITY: Validate URLs before restoring from storage
        // This prevents XSS attacks via storage injection
        const validateUrl = (url: string): boolean => {
          const isDevMode = isDevModeEnabledGlobal();
          return isAllowedContentUrl(url) || (isDevMode && isLocalhostUrl(url)) || (isDevMode && isGitHubRawUrl(url));
        };

        const isValidBase = validateUrl(data.baseUrl);
        const isValidCurrent = !data.currentUrl || validateUrl(data.currentUrl);

        if (!isValidBase || !isValidCurrent) {
          console.warn('Rejected potentially unsafe URL from storage:', {
            baseUrl: data.baseUrl,
            currentUrl: data.currentUrl,
            isValidBase,
            isValidCurrent,
          });
          return; // Skip this tab
        }

        tabs.push({
          id: data.id,
          title: data.title,
          baseUrl: data.baseUrl,
          currentUrl: data.currentUrl || data.baseUrl,
          content: null, // Will be loaded when tab becomes active
          isLoading: false,
          error: null,
          type: data.type || 'learning-journey',
        });
      });

      return tabs;
    } catch (error) {
      console.error('Failed to restore tabs from storage:', error);
      return [
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
    }
  }

  private static async restoreActiveTabFromStorage(tabs: LearningJourneyTab[]): Promise<string> {
    try {
      const activeTabId = await tabStorage.getActiveTab();

      if (activeTabId) {
        const tabExists = tabs.some((t) => t.id === activeTabId);
        return tabExists ? activeTabId : 'recommendations';
      }
    } catch (error) {
      console.error('Failed to restore active tab from storage:', error);
    }

    return 'recommendations';
  }

  private async saveTabsToStorage(): Promise<void> {
    try {
      const tabsToSave: PersistedTabData[] = this.state.tabs
        .filter((tab) => tab.id !== 'recommendations' && tab.id !== 'my-learning')
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
    const finalTitle = title || 'Learning journey';
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
        newActiveTabId = currentTabs[tabIndex + 1].id;
      } else if (tabIndex > 0) {
        // Choose the previous tab if at the end
        newActiveTabId = currentTabs[tabIndex - 1].id;
      } else {
        // Default to recommendations if only tab
        newActiveTabId = 'recommendations';
      }
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
      if (tab.type === 'docs' && !tab.content) {
        this.loadDocsTabContent(tabId, tab.currentUrl || tab.baseUrl);
      } else if (tab.type !== 'docs' && !tab.content) {
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
        const finalUpdatedTabs = this.state.tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                content: result.content,
                isLoading: false,
                error: null,
                currentUrl: url,
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
  const [badgeCelebrationQueue, setBadgeCelebrationQueue] = React.useState<string[]>([]);
  const [currentCelebrationBadge, setCurrentCelebrationBadge] = React.useState<string | null>(null);
  const isProcessingQueueRef = React.useRef(false);

  // Process the badge queue - show next badge toast
  React.useEffect(() => {
    if (badgeCelebrationQueue.length > 0 && !currentCelebrationBadge && !isProcessingQueueRef.current) {
      isProcessingQueueRef.current = true;
      // Small delay before showing next toast for better UX
      const timer = setTimeout(() => {
        const [nextBadge, ...remaining] = badgeCelebrationQueue;
        setBadgeCelebrationQueue(remaining);
        setCurrentCelebrationBadge(nextBadge);
        isProcessingQueueRef.current = false;
      }, currentCelebrationBadge === null ? 0 : 500); // No delay for first, 500ms between subsequent

      return () => clearTimeout(timer);
    }
    return undefined;
  }, [badgeCelebrationQueue, currentCelebrationBadge]);

  // Listen for badge award events globally (only set up once)
  React.useEffect(() => {
    const handleProgressUpdate = (event: Event) => {
      const detail = (event as CustomEvent).detail;

      // Check for new badges from guide completion
      if (detail?.type === 'guide-completed' && detail?.newBadges?.length > 0) {
        // Add all new badges to the queue (cap at 3 to avoid overwhelming)
        const newBadges = detail.newBadges.slice(0, 3) as string[];
        setBadgeCelebrationQueue((prev) => [...prev, ...newBadges]);
      }
    };

    window.addEventListener('learning-progress-updated', handleProgressUpdate);

    return () => {
      window.removeEventListener('learning-progress-updated', handleProgressUpdate);
    };
  }, []);

  // Handle dismissing the current badge celebration
  const handleDismissGlobalCelebration = React.useCallback(async () => {
    const badgeId = currentCelebrationBadge;
    if (badgeId) {
      // Clear current badge to trigger showing next in queue
      setCurrentCelebrationBadge(null);
      // Then persist dismissal to storage
      await learningProgressStorage.dismissCelebration(badgeId);
    }
  }, [currentCelebrationBadge]);
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

      console.log(`[DocsPanel] Hand ${isRaised ? 'raised' : 'lowered'} by ${attendeeName}`);
    },
    [sessionManager, sessionInfo, attendeeName]
  );

  // Listen for hand raise events (presenter only)
  React.useEffect(() => {
    if (sessionRole !== 'presenter') {
      return;
    }

    console.log('[DocsPanel] Setting up hand raise event listener for presenter');

    const cleanup = onEvent((event) => {
      console.log('[DocsPanel] Presenter received event:', event.type, event);

      if (event.type === 'hand_raise') {
        if (event.isRaised) {
          // Show toast notification when someone raises their hand
          console.log('[DocsPanel] Showing toast for hand raise:', event.attendeeName);
          getAppEvents().publish({
            type: 'alert-success',
            payload: ['Live session', `${event.attendeeName} has raised their hand`],
          });
        }
      }
    });

    return cleanup;
  }, [sessionRole, onEvent]);

  // Restore tabs after storage is initialized (fixes race condition)
  React.useEffect(() => {
    // Only restore if we haven't loaded tabs yet (tabs length === 1 means only recommendations tab)
    if (tabs.length === 1 && tabs[0].id === 'recommendations') {
      model.restoreTabsAsync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps - only run once after mount, tabs checked at mount time

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
      const isLearningJourney = urlObj?.pathname.includes('/learning-journeys/');

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

  const styles = useStyles2(getStyles);
  const interactiveStyles = useStyles2(getInteractiveStyles);
  const prismStyles = useStyles2(getPrismStyles);
  const journeyStyles = useStyles2(journeyContentHtml);
  const docsStyles = useStyles2(docsContentHtml);

  // Tab overflow management - dynamic calculation based on container width
  const tabBarRef = useRef<HTMLDivElement>(null); // Measure parent instead of child
  const tabListRef = useRef<HTMLDivElement>(null);
  const [visibleTabs, setVisibleTabs] = useState<LearningJourneyTab[]>(tabs);
  const [overflowedTabs, setOverflowedTabs] = useState<LearningJourneyTab[]>([]);
  const chevronButtonRef = useRef<HTMLButtonElement>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dropdownOpenTimeRef = useRef<number>(0);
  const [containerWidth, setContainerWidth] = useState<number>(0);

  // Dynamic tab visibility calculation based on container width
  // Note: Permanent tabs (recommendations, my-learning) are now rendered separately as icon tabs
  const calculateTabVisibility = useCallback(() => {
    // Filter out permanent tabs - they're rendered separately as icons
    const guideTabs = tabs.filter((t) => t.id !== 'recommendations' && t.id !== 'my-learning');

    if (guideTabs.length === 0) {
      setVisibleTabs(tabs); // Keep all tabs in state for reference
      setOverflowedTabs([]);
      return;
    }

    // If we don't have container width yet, show minimal tabs
    if (containerWidth === 0) {
      setVisibleTabs(tabs);
      setOverflowedTabs([]);
      return;
    }

    // Note: chevron button width is already reserved in containerWidth calculation
    const tabSpacing = 4; // Gap between tabs (theme.spacing(0.5))

    // Use a more practical minimum: each tab needs at least 100px to be readable
    // With flex layout, tabs will grow to fill available space proportionally
    const minTabWidth = 100; // Minimum readable width per tab

    // Account for permanent tabs space (2 icon tabs + divider = ~80px)
    const permanentTabsWidth = 80;
    const availableWidth = Math.max(0, containerWidth - permanentTabsWidth);

    // Determine how many guide tabs can fit
    let maxVisibleGuideTabs = 0;
    let widthUsed = 0;

    // Try to fit guide tabs
    for (let i = 0; i < guideTabs.length; i++) {
      const tabWidth = minTabWidth + tabSpacing;
      const spaceNeeded = widthUsed + tabWidth;

      if (spaceNeeded <= availableWidth) {
        maxVisibleGuideTabs++;
        widthUsed += tabWidth;
      } else {
        break;
      }
    }

    // Ensure active tab is visible if possible (only for guide tabs)
    const activeGuideTabIndex = guideTabs.findIndex((t) => t.id === activeTabId);
    if (activeGuideTabIndex >= maxVisibleGuideTabs && maxVisibleGuideTabs > 0) {
      // Swap active tab into visible range
      const visibleGuideTabsArray = [...guideTabs.slice(0, maxVisibleGuideTabs - 1), guideTabs[activeGuideTabIndex]];
      const overflowGuideTabsArray = [
        ...guideTabs.slice(maxVisibleGuideTabs - 1, activeGuideTabIndex),
        ...guideTabs.slice(activeGuideTabIndex + 1),
      ];
      // Include permanent tabs in visibleTabs for completeness
      setVisibleTabs([...tabs.filter((t) => t.id === 'recommendations' || t.id === 'my-learning'), ...visibleGuideTabsArray]);
      setOverflowedTabs(overflowGuideTabsArray);
    } else {
      // Include permanent tabs in visibleTabs for completeness
      setVisibleTabs([...tabs.filter((t) => t.id === 'recommendations' || t.id === 'my-learning'), ...guideTabs.slice(0, maxVisibleGuideTabs)]);
      setOverflowedTabs(guideTabs.slice(maxVisibleGuideTabs));
    }
  }, [tabs, containerWidth, activeTabId]);

  useEffect(() => {
    calculateTabVisibility();
  }, [calculateTabVisibility]);

  // ResizeObserver to track container width changes
  // Re-run when tabs.length changes to handle tab bar appearing/disappearing
  useEffect(() => {
    const tabBar = tabBarRef.current;
    if (!tabBar) {
      return;
    }

    // Measure tabBar and reserve space for chevron button
    const chevronWidth = 120; // Approximate width of chevron button + spacing

    // Set initial width immediately (ResizeObserver may not fire on initial mount)
    const tabBarWidth = tabBar.getBoundingClientRect().width;
    const availableForTabs = Math.max(0, tabBarWidth - chevronWidth);
    if (availableForTabs > 0) {
      setContainerWidth(availableForTabs);
    }

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const tabBarWidth = entry.contentRect.width;
        const availableForTabs = Math.max(0, tabBarWidth - chevronWidth);
        setContainerWidth(availableForTabs);
      }
    });

    resizeObserver.observe(tabBar);

    return () => {
      resizeObserver.disconnect();
    };
  }, [tabs.length]);

  // Content styles are applied at the component level via CSS classes

  const contentRef = useRef<HTMLDivElement>(null);

  // Scroll position preservation by tab/URL
  const scrollPositionRef = useRef<Record<string, number>>({});
  const lastContentUrlRef = useRef<string>('');

  // Expose current active tab id/url globally for interactive persistence keys
  useEffect(() => {
    try {
      (window as any).__DocsPluginActiveTabId = activeTab?.id || '';
      (window as any).__DocsPluginActiveTabUrl = activeTab?.currentUrl || activeTab?.baseUrl || '';
    } catch {
      // no-op
    }
  }, [activeTab?.id, activeTab?.currentUrl, activeTab?.baseUrl]);

  // Save scroll position before content changes
  const saveScrollPosition = useCallback(() => {
    const scrollableElement = document.getElementById('inner-docs-content');
    if (scrollableElement && lastContentUrlRef.current) {
      scrollPositionRef.current[lastContentUrlRef.current] = scrollableElement.scrollTop;
    }
  }, []);

  // Restore scroll position when content loads
  const restoreScrollPosition = useCallback(() => {
    const contentUrl = activeTab?.currentUrl || activeTab?.baseUrl || '';
    if (contentUrl && contentUrl !== lastContentUrlRef.current) {
      lastContentUrlRef.current = contentUrl;

      // Restore saved position if available
      const savedPosition = scrollPositionRef.current[contentUrl];
      if (typeof savedPosition === 'number') {
        const scrollableElement = document.getElementById('inner-docs-content');
        if (scrollableElement) {
          // Use requestAnimationFrame to ensure DOM is ready
          requestAnimationFrame(() => {
            scrollableElement.scrollTop = savedPosition;
          });
        }
      } else {
        // New content - scroll to top
        const scrollableElement = document.getElementById('inner-docs-content');
        if (scrollableElement) {
          requestAnimationFrame(() => {
            scrollableElement.scrollTop = 0;
          });
        }
      }
    }
  }, [activeTab?.currentUrl, activeTab?.baseUrl]);

  // Track scroll position continuously
  useEffect(() => {
    const scrollableElement = document.getElementById('inner-docs-content');
    if (!scrollableElement) {
      return;
    }

    const handleScroll = () => {
      saveScrollPosition();
    };

    scrollableElement.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      scrollableElement.removeEventListener('scroll', handleScroll);
      saveScrollPosition();
    };
  }, [saveScrollPosition]);

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
      console.log('[DocsPanel] Initializing ActionCaptureSystem for presenter');
      actionCaptureRef.current = new ActionCaptureSystem(sessionManager, sessionInfo.sessionId);
      actionCaptureRef.current.startCapture();
    }

    // Cleanup when ending session
    if (sessionRole !== 'presenter' && actionCaptureRef.current) {
      console.log('[DocsPanel] Cleaning up ActionCaptureSystem');
      actionCaptureRef.current.stopCapture();
      actionCaptureRef.current = null;
    }
  }, [sessionRole, sessionManager, sessionInfo]);

  // ============================================================================
  // Live Session Effects (Attendee)
  // ============================================================================

  // Initialize ActionReplaySystem when joining as attendee
  useEffect(() => {
    if (sessionRole === 'attendee' && navigationManagerRef.current && attendeeMode && !actionReplayRef.current) {
      console.log(`[DocsPanel] Initializing ActionReplaySystem for attendee in ${attendeeMode} mode`);
      actionReplayRef.current = new ActionReplaySystem(attendeeMode, navigationManagerRef.current);
    }

    // Update mode if it changes
    if (sessionRole === 'attendee' && actionReplayRef.current && attendeeMode) {
      actionReplayRef.current.setMode(attendeeMode);
      console.log(`[DocsPanel] Updated ActionReplaySystem mode to ${attendeeMode}`);
    }

    // Cleanup when leaving session
    if (sessionRole !== 'attendee' && actionReplayRef.current) {
      console.log('[DocsPanel] Cleaning up ActionReplaySystem');
      actionReplayRef.current = null;
    }
  }, [sessionRole, attendeeMode]);

  // Listen for session events and replay them (attendee only)
  useEffect(() => {
    if (sessionRole !== 'attendee' || !actionReplayRef.current) {
      return;
    }

    console.log('[DocsPanel] Setting up event listener for attendee');

    const cleanup = onEvent((event) => {
      console.log('[DocsPanel] Received event:', event.type);

      // Handle session end
      if (event.type === 'session_end') {
        console.log('[DocsPanel] Presenter ended the session');
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
  }, [sessionRole, onEvent, endSession]);

  // Auto-open tutorial when joining session as attendee
  useEffect(() => {
    if (sessionRole === 'attendee' && sessionInfo?.config.tutorialUrl) {
      console.log('[DocsPanel] Auto-opening tutorial:', sessionInfo.config.tutorialUrl);

      const url = sessionInfo.config.tutorialUrl;
      const title = sessionInfo.config.name;

      // Open the tutorial in a new tab
      if (url.includes('/learning-journeys/')) {
        model.openLearningJourney(url, title);
      } else {
        model.openDocsPage(url, title);
      }
    }
  }, [sessionRole, sessionInfo, model]);

  // Tab persistence is now handled explicitly in the model methods
  // No need for automatic saving here as it's done when tabs are created/modified

  // Close dropdown when clicking outside and handle positioning
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        chevronButtonRef.current &&
        !chevronButtonRef.current.contains(event.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    };

    // Position dropdown to prevent clipping
    const positionDropdown = () => {
      if (isDropdownOpen && dropdownRef.current && chevronButtonRef.current) {
        const dropdown = dropdownRef.current;
        const chevronButton = chevronButtonRef.current;

        // Reset position attributes
        dropdown.removeAttribute('data-position');

        // Get chevron button position
        const chevronRect = chevronButton.getBoundingClientRect();
        const dropdownWidth = Math.min(320, Math.max(220, dropdown.offsetWidth)); // Use CSS min/max values

        // Check if dropdown extends beyond right edge of viewport
        if (chevronRect.right - dropdownWidth < 20) {
          // Not enough space on right, position from left
          dropdown.setAttribute('data-position', 'left');
        }
      }
    };

    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      // Position dropdown after it's rendered
      setTimeout(positionDropdown, 0);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }

    // Return undefined for the else case
    return undefined;
  }, [isDropdownOpen]);

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
      <div className={styles.headerBar} data-testid={testIds.docsPanel.headerBar}>
        <img src={logoSvg} alt="" width={20} height={20} />
        <div className={styles.headerRight}>
          <IconButton
            name="cog"
            size="sm"
            tooltip={t('docsPanel.settings', 'Plugin settings')}
            onClick={() => {
              reportAppInteraction(UserInteraction.DocsPanelInteraction, {
                action: 'navigate_to_config',
                source: 'header_settings_button',
              });
              locationService.push('/plugins/grafana-pathfinder-app?page=configuration');
            }}
            aria-label={t('docsPanel.settings', 'Plugin settings')}
            data-testid={testIds.docsPanel.settingsButton}
          />
          <div className={styles.headerDivider} />
          <IconButton
            name="times"
            size="sm"
            tooltip={t('docsPanel.closeSidebar', 'Close sidebar')}
            onClick={() => {
              reportAppInteraction(UserInteraction.DocsPanelInteraction, {
                action: 'close_sidebar',
                source: 'header_close_button',
              });
              // Close the extension sidebar
              const appEvents = getAppEvents();
              appEvents.publish({
                type: 'close-extension-sidebar',
                payload: {},
              });
            }}
            aria-label="Close sidebar"
            data-testid={testIds.docsPanel.closeButton}
          />
        </div>
      </div>
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
                          console.log('[DocsPanel] Switched to Guided mode');
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
                          console.log('[DocsPanel] Switched to Follow mode');
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
              <Icon name="compass" size="md" />
            </button>
            <button
              className={`${styles.iconTab} ${activeTabId === 'my-learning' ? styles.iconTabActive : ''}`}
              onClick={() => model.setActiveTab('my-learning')}
              title={t('docsPanel.myLearning', 'My learning')}
              data-testid={testIds.docsPanel.tab('my-learning')}
            >
              <Icon name="book-open" size="md" />
            </button>
          </div>

          {/* Divider - only show when there are guide tabs */}
          {visibleTabs.filter((t) => t.id !== 'recommendations' && t.id !== 'my-learning').length > 0 && (
            <div className={styles.tabDivider} />
          )}

          {/* Guide tabs with titles */}
          <div className={styles.tabList} ref={tabListRef} data-testid={testIds.docsPanel.tabList}>
            {visibleTabs
              .filter((tab) => tab.id !== 'recommendations' && tab.id !== 'my-learning')
              .map((tab) => {
                const getTranslatedTitle = (title: string) => {
                  if (title === 'Learning journey') {
                    return t('docsPanel.learningJourney', 'Learning journey');
                  }
                  if (title === 'Documentation') {
                    return t('docsPanel.documentation', 'Documentation');
                  }
                  return title; // Custom titles stay as-is
                };

                return (
                  <button
                    key={tab.id}
                    className={`${styles.tab} ${tab.id === activeTabId ? styles.activeTab : ''}`}
                    onClick={() => model.setActiveTab(tab.id)}
                    title={getTranslatedTitle(tab.title)}
                    data-testid={testIds.docsPanel.tab(tab.id)}
                  >
                    <div className={styles.tabContent}>
                      <Icon
                        name={tab.type === 'devtools' ? 'bug' : tab.type === 'docs' ? 'file-alt' : 'book'}
                        size="xs"
                        className={styles.tabIcon}
                      />
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

          {overflowedTabs.filter((t) => t.id !== 'recommendations' && t.id !== 'my-learning').length > 0 && (
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
                aria-label={t('docsPanel.showMoreTabs', 'Show {{count}} more tabs', { count: overflowedTabs.filter((t) => t.id !== 'recommendations' && t.id !== 'my-learning').length })}
                aria-expanded={isDropdownOpen}
                aria-haspopup="true"
                data-testid={testIds.docsPanel.tabOverflowButton}
              >
                <div className={styles.tabContent}>
                  <Icon name="angle-right" size="sm" className={styles.chevronIcon} />
                  <span className={styles.tabTitle}>
                    {t('docsPanel.moreTabs', '{{count}} more', { count: overflowedTabs.filter((t) => t.id !== 'recommendations' && t.id !== 'my-learning').length })}
                  </span>
                </div>
              </button>
            </div>
          )}

          {isDropdownOpen && overflowedTabs.filter((t) => t.id !== 'recommendations' && t.id !== 'my-learning').length > 0 && (
            <div
              ref={dropdownRef}
              className={styles.tabDropdown}
              role="menu"
              aria-label={t('docsPanel.moreTabsMenu', 'More tabs')}
              data-testid={testIds.docsPanel.tabDropdown}
            >
              {overflowedTabs
                .filter((tab) => tab.id !== 'recommendations' && tab.id !== 'my-learning')
                .map((tab) => {
                  const getTranslatedTitle = (title: string) => {
                    if (title === 'Learning Journey') {
                      return t('docsPanel.learningJourney', 'Learning Journey');
                    }
                    if (title === 'Documentation') {
                      return t('docsPanel.documentation', 'Documentation');
                    }
                    return title; // Custom titles stay as-is
                  };

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
                        <Icon
                          name={tab.type === 'devtools' ? 'bug' : tab.type === 'docs' ? 'file-alt' : 'book'}
                          size="xs"
                          className={styles.dropdownItemIcon}
                        />
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
        </div>
      </div>

      <div className={styles.content} data-testid={testIds.docsPanel.content}>
        {(() => {
          // Show recommendations tab
          if (isRecommendationsTab) {
            return <contextPanel.Component model={contextPanel} />;
          }

          // Show my learning tab
          if (activeTabId === 'my-learning') {
            return (
              <MyLearningTab
                onOpenGuide={(url, title) => {
                  model.openLearningJourney(url, title);
                }}
              />
            );
          }

          // Show dev tools tab
          if (activeTabId === 'devtools') {
            return (
              <div className={styles.devToolsContent} data-testid="devtools-tab-content">
                <Suspense fallback={<SkeletonLoader type="recommendations" />}>
                  <SelectorDebugPanel
                    onOpenDocsPage={(url: string, title: string) => model.openDocsPage(url, title, true)}
                  />
                </Suspense>
              </div>
            );
          }

          // Show loading state with skeleton
          if (!isRecommendationsTab && activeTab?.isLoading) {
            return (
              <div
                className={activeTab.type === 'docs' ? styles.docsContent : styles.journeyContent}
                data-testid={testIds.docsPanel.loadingState}
              >
                <SkeletonLoader type={activeTab.type === 'docs' ? 'documentation' : 'learning-journey'} />
              </div>
            );
          }

          // Show error state with retry option
          if (!isRecommendationsTab && activeTab?.error && !activeTab.isLoading) {
            const isRetryable =
              activeTab.error.includes('timeout') ||
              activeTab.error.includes('Unable to connect') ||
              activeTab.error.includes('network');

            return (
              <div
                className={activeTab.type === 'docs' ? styles.docsContent : styles.journeyContent}
                data-testid={testIds.docsPanel.errorState}
              >
                <Alert
                  severity="error"
                  title={`Unable to load ${activeTab.type === 'docs' ? 'documentation' : 'learning journey'}`}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <p>{activeTab.error}</p>
                    {isRetryable && (
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            if (activeTab.type === 'docs') {
                              model.loadDocsTabContent(activeTab.id, activeTab.currentUrl || activeTab.baseUrl);
                            } else {
                              model.loadTabContent(activeTab.id, activeTab.currentUrl || activeTab.baseUrl);
                            }
                          }}
                        >
                          {t('docsPanel.retry', 'Retry')}
                        </Button>
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                          {t('docsPanel.retryHint', 'Check your connection and try again')}
                        </span>
                      </div>
                    )}
                  </div>
                </Alert>
              </div>
            );
          }

          // Show content - both learning journeys and docs use the same ContentRenderer now!
          if (!isRecommendationsTab && activeTab?.content && !activeTab.isLoading) {
            const isLearningJourneyTab = activeTab.type === 'learning-journey' || activeTab.type !== 'docs';
            const showMilestoneProgress =
              isLearningJourneyTab &&
              activeTab.content?.type === 'learning-journey' &&
              activeTab.content.metadata.learningJourney &&
              activeTab.content.metadata.learningJourney.currentMilestone > 0;

            return (
              <div className={activeTab.type === 'docs' ? styles.docsContent : styles.journeyContent}>
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

                {/* Content Meta for learning journey pages (when no milestone progress is shown) */}
                {isLearningJourneyTab && !showMilestoneProgress && (
                  <div className={styles.contentMeta}>
                    <div className={styles.metaInfo}>
                      <span>{t('docsPanel.learningJourney', 'Learning journey')}</span>
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

                {/* Content Meta for docs - now includes secondary open-in-new button */}
                {activeTab.type === 'docs' && (
                  <div className={styles.contentMeta}>
                    <div className={styles.metaInfo}>
                      <span>{t('docsPanel.documentation', 'Documentation')}</span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        gap: 8,
                      }}
                    >
                      {(() => {
                        const url = activeTab.content?.url || activeTab.baseUrl;
                        const isBundled = typeof url === 'string' && url.startsWith('bundled:');
                        let isGrafanaDomain = false;
                        try {
                          if (url && typeof url === 'string') {
                            const parsed = new URL(url);
                            // Security: Use exact hostname matching from allowlist (no subdomains)
                            isGrafanaDomain = ALLOWED_GRAFANA_DOCS_HOSTNAMES.includes(parsed.hostname);
                          }
                        } catch {
                          isGrafanaDomain = false;
                        }
                        if (url && !isBundled && isGrafanaDomain) {
                          // Strip /unstyled.html from URL for browser viewing (users want the styled docs page)
                          const cleanUrl = url.replace(/\/unstyled\.html$/, '');

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
                              if (activeTab.type === 'docs') {
                                model.loadDocsTabContent(activeTab.id, activeTab.currentUrl || activeTab.baseUrl);
                              } else {
                                model.loadTabContent(activeTab.id, activeTab.currentUrl || activeTab.baseUrl);
                              }
                            }
                          }}
                        />
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
                          {t('docsPanel.milestoneProgress', 'Milestone {{current}} of {{total}}', {
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
                {activeTab.type !== 'docs' && (
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
                            ...(activeTab.type !== 'docs' &&
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
                        // Mark bundled guides as 100% complete when all interactive sections finish
                        const baseUrl = activeTab?.baseUrl || stableContent.url;
                        if (baseUrl?.startsWith('bundled:')) {
                          setJourneyCompletionPercentage(baseUrl, 100);
                        }
                      }}
                    />
                  )}
                </div>
              </div>
            );
          }

          return null;
        })()}
      </div>
      {/* Feedback Button - only shown at bottom for non-docs views; docs uses header placement */}
      {!isRecommendationsTab && activeTab?.type !== 'docs' && (
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

      {/* Modal backdrop */}
      {(showPresenterControls || showAttendeeJoin) && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            zIndex: 9999,
          }}
          onClick={() => {
            setShowPresenterControls(false);
            setShowAttendeeJoin(false);
          }}
        />
      )}

      {/* Global Badge Celebration Toast - shows queued toasts sequentially */}
      {currentCelebrationBadge && getBadgeById(currentCelebrationBadge) && (
        <BadgeUnlockedToast
          badge={getBadgeById(currentCelebrationBadge)!}
          onDismiss={handleDismissGlobalCelebration}
          queueCount={badgeCelebrationQueue.length}
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
