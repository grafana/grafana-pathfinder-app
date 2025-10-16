// Combined Learning Journey and Docs Panel
// Post-refactoring unified component using new content system only

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SceneObjectBase, SceneObjectState, SceneComponentProps } from '@grafana/scenes';
import { IconButton, Alert, Icon, useStyles2, Button } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { t } from '@grafana/i18n';
import { getConfigWithDefaults, DocsPluginConfig } from '../../constants';

import { useInteractiveElements } from '../../utils/interactive.hook';
import { useKeyboardShortcuts } from '../../utils/keyboard-shortcuts.hook';
import { useLinkClickHandler } from '../../utils/link-handler.hook';
import { parseUrlSafely } from '../../utils/url-validator';

import { setupScrollTracking, reportAppInteraction, UserInteraction } from '../../lib/analytics';
import { FeedbackButton } from '../FeedbackButton/FeedbackButton';
import { SkeletonLoader } from '../SkeletonLoader';

// Import new unified content system
import {
  fetchContent,
  ContentRenderer,
  RawContent,
  getNextMilestoneUrlFromContent,
  getPreviousMilestoneUrlFromContent,
} from '../../utils/docs-retrieval';

// Import learning journey helpers
import {
  getJourneyProgress,
  setJourneyCompletionPercentage,
} from '../../utils/docs-retrieval/learning-journey-helpers';

import { ContextPanel } from './context-panel';

import { getStyles as getComponentStyles, addGlobalModalStyles } from '../../styles/docs-panel.styles';
import { journeyContentHtml, docsContentHtml } from '../../styles/content-html.styles';
import { getInteractiveStyles } from '../../styles/interactive.styles';
import { getPrismStyles } from '../../styles/prism.styles';

// Use the properly extracted styles
const getStyles = getComponentStyles;

interface LearningJourneyTab {
  id: string;
  title: string;
  baseUrl: string;
  currentUrl: string; // The specific milestone/page URL currently loaded
  content: RawContent | null; // Unified content type
  isLoading: boolean;
  error: string | null;
  type?: 'learning-journey' | 'docs';
}

interface PersistedTabData {
  id: string;
  title: string;
  baseUrl: string;
  currentUrl?: string; // The specific milestone/page URL user was viewing (optional for backward compatibility)
  type?: 'learning-journey' | 'docs';
}

interface CombinedPanelState extends SceneObjectState {
  tabs: LearningJourneyTab[];
  activeTabId: string;
  contextPanel: ContextPanel;
  pluginConfig: DocsPluginConfig;
}

const STORAGE_KEY = 'grafana-docs-plugin-tabs';
const ACTIVE_TAB_STORAGE_KEY = 'grafana-docs-plugin-active-tab';

class CombinedLearningJourneyPanel extends SceneObjectBase<CombinedPanelState> {
  public static Component = CombinedPanelRenderer;

  public get renderBeforeActivation(): boolean {
    return true;
  }

  public constructor(pluginConfig: DocsPluginConfig = {}) {
    const restoredTabs = CombinedLearningJourneyPanel.restoreTabsFromStorage();
    const contextPanel = new ContextPanel(
      (url: string, title: string) => this.openLearningJourney(url, title),
      (url: string, title: string) => this.openDocsPage(url, title)
    );

    const activeTabId = CombinedLearningJourneyPanel.restoreActiveTabFromStorage(restoredTabs);

    super({
      tabs: restoredTabs,
      activeTabId,
      contextPanel,
      pluginConfig,
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

  private static restoreTabsFromStorage(): LearningJourneyTab[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsedData: PersistedTabData[] = JSON.parse(stored);

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
      }
    } catch (error) {
      console.error('Failed to restore tabs from storage:', error);
    }

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

  private static restoreActiveTabFromStorage(tabs: LearningJourneyTab[]): string {
    try {
      const stored = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
      if (stored) {
        let activeTabId: string;

        // Handle both JSON string and raw string cases
        try {
          activeTabId = JSON.parse(stored);
        } catch {
          // If JSON.parse fails, treat it as a raw string
          activeTabId = stored;
        }

        const tabExists = tabs.some((t) => t.id === activeTabId);
        return tabExists ? activeTabId : 'recommendations';
      }
    } catch (error) {
      console.error('Failed to restore active tab from storage:', error);
    }

    return 'recommendations';
  }

  private saveTabsToStorage(): void {
    try {
      const tabsToSave: PersistedTabData[] = this.state.tabs
        .filter((tab) => tab.id !== 'recommendations')
        .map((tab) => ({
          id: tab.id,
          title: tab.title,
          baseUrl: tab.baseUrl,
          currentUrl: tab.currentUrl,
          type: tab.type,
        }));

      localStorage.setItem(STORAGE_KEY, JSON.stringify(tabsToSave));
      localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, JSON.stringify(this.state.activeTabId));
    } catch (error) {
      console.error('Failed to save tabs to storage:', error);
    }
  }

  public static clearPersistedTabs(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(ACTIVE_TAB_STORAGE_KEY);
    } catch (error) {
      console.error('Failed to clear persisted tabs:', error);
    }
  }

  public async openLearningJourney(url: string, title?: string): Promise<string> {
    const finalTitle = title || 'Learning Journey';
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
      const configWithDefaults = getConfigWithDefaults(this.state.pluginConfig);
      const result = await fetchContent(url, { docsBaseUrl: configWithDefaults.docsBaseUrl });

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
    try {
      const tab = currentTabs.find((t) => t.id === tabId);
      if (tab) {
        // Remove all keys matching this content key prefix
        const prefix = `docsPlugin:completedSteps:${tab.baseUrl}`;
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith(prefix)) {
            localStorage.removeItem(key);
            // Adjust index due to removal
            i--;
          }
        }
      }
    } catch {
      // ignore
    }
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

  public async openDocsPage(url: string, title?: string): Promise<string> {
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
    this.loadDocsTabContent(tabId, url);

    return tabId;
  }

  public async loadDocsTabContent(tabId: string, url: string) {
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
      const configWithDefaults = getConfigWithDefaults(this.state.pluginConfig);
      const result = await fetchContent(url, { docsBaseUrl: configWithDefaults.docsBaseUrl });

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

function CombinedPanelRenderer({ model }: SceneComponentProps<CombinedLearningJourneyPanel>) {
  React.useEffect(() => {
    addGlobalModalStyles();
  }, []);

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

    return () => {
      document.removeEventListener('pathfinder-auto-open-docs', handleAutoOpen);
    };
  }, [model]); // Only model as dependency - this component doesn't remount on tab changes

  const { tabs, activeTabId, contextPanel } = model.useState();
  // removed — using restored custom overflow state below

  const activeTab = tabs.find((t) => t.id === activeTabId) || null;
  const isRecommendationsTab = activeTabId === 'recommendations';
  const theme = useStyles2((theme: GrafanaTheme2) => theme);

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
  const calculateTabVisibility = useCallback(() => {
    if (tabs.length === 0) {
      setVisibleTabs([]);
      setOverflowedTabs([]);
      return;
    }

    // If we don't have container width yet, show minimal tabs
    if (containerWidth === 0) {
      setVisibleTabs(tabs.slice(0, 1)); // Just Recommendations
      setOverflowedTabs(tabs.slice(1));
      return;
    }

    // Note: chevron button width is already reserved in containerWidth calculation
    const tabSpacing = 4; // Gap between tabs (theme.spacing(0.5))

    // Use a more practical minimum: each tab needs at least 100px to be readable
    // With flex layout, tabs will grow to fill available space proportionally
    const minTabWidth = 100; // Minimum readable width per tab

    // The containerWidth already has chevron space reserved
    const availableWidth = containerWidth;

    // Determine how many tabs can fit
    let maxVisibleTabs = 1; // Always show at least Recommendations
    let widthUsed = minTabWidth; // Start with first tab (Recommendations)

    // Try to fit additional tabs
    for (let i = 1; i < tabs.length; i++) {
      const tabWidth = minTabWidth + tabSpacing;
      const spaceNeeded = widthUsed + tabWidth;

      if (spaceNeeded <= availableWidth) {
        maxVisibleTabs++;
        widthUsed += tabWidth;
      } else {
        break;
      }
    }

    // Ensure active tab is visible if possible
    const activeTabIndex = tabs.findIndex((t) => t.id === activeTabId);
    if (activeTabIndex >= maxVisibleTabs && maxVisibleTabs > 1) {
      // Swap active tab into visible range
      const visibleTabsArray = [...tabs.slice(0, maxVisibleTabs - 1), tabs[activeTabIndex]];
      const overflowTabsArray = [...tabs.slice(maxVisibleTabs - 1, activeTabIndex), ...tabs.slice(activeTabIndex + 1)];
      setVisibleTabs(visibleTabsArray);
      setOverflowedTabs(overflowTabsArray);
    } else {
      setVisibleTabs(tabs.slice(0, maxVisibleTabs));
      setOverflowedTabs(tabs.slice(maxVisibleTabs));
    }
  }, [tabs, containerWidth, activeTabId]);

  useEffect(() => {
    calculateTabVisibility();
  }, [calculateTabVisibility]);

  // ResizeObserver to track container width changes
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
  }, []);

  // Content styles are applied at the component level via CSS classes

  const contentRef = useRef<HTMLDivElement>(null);

  // Expose current active tab id/url globally for interactive persistence keys
  useEffect(() => {
    try {
      (window as any).__DocsPluginActiveTabId = activeTab?.id || '';
      (window as any).__DocsPluginActiveTabUrl = activeTab?.currentUrl || activeTab?.baseUrl || '';
    } catch {
      // no-op
    }
  }, [activeTab?.id, activeTab?.currentUrl, activeTab?.baseUrl]);

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
        content_type: type === 'docs-page' ? 'docs' : 'learning-journey',
        trigger_source: 'auto_launch_tutorial',
        interaction_location: 'docs_panel',
        ...(type === 'learning-journey' && {
          completion_percentage: 0, // Auto-launch is always starting fresh
        }),
      });

      if (url && title) {
        model.openLearningJourney(url, title);
      }
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
    <div id="CombinedLearningJourney" className={styles.container} data-pathfinder-content="true">
      <div className={styles.topBar}>
        <div className={styles.tabBar} ref={tabBarRef}>
          <div className={styles.tabList} ref={tabListRef}>
            {visibleTabs.map((tab) => {
              const getTranslatedTitle = (title: string) => {
                if (title === 'Recommendations') {
                  return t('docsPanel.recommendations', 'Recommendations');
                }
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
                  className={`${styles.tab} ${tab.id === activeTabId ? styles.activeTab : ''}`}
                  onClick={() => model.setActiveTab(tab.id)}
                  title={getTranslatedTitle(tab.title)}
                >
                  <div className={styles.tabContent}>
                    {tab.id !== 'recommendations' && (
                      <Icon name={tab.type === 'docs' ? 'file-alt' : 'book'} size="xs" className={styles.tabIcon} />
                    )}
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
                    {tab.id !== 'recommendations' && (
                      <IconButton
                        name="times"
                        size="sm"
                        aria-label={t('docsPanel.closeTab', 'Close {{title}}', {
                          title: getTranslatedTitle(tab.title),
                        })}
                        onClick={(e) => {
                          e.stopPropagation();
                          reportAppInteraction(UserInteraction.CloseTabClick, {
                            content_type: tab.type || 'learning-journey',
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
                      />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {overflowedTabs.length > 0 && (
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
                aria-label={t('docsPanel.showMoreTabs', 'Show {{count}} more tabs', { count: overflowedTabs.length })}
                aria-expanded={isDropdownOpen}
                aria-haspopup="true"
              >
                <div className={styles.tabContent}>
                  <Icon name="angle-right" size="sm" className={styles.chevronIcon} />
                  <span className={styles.tabTitle}>
                    {t('docsPanel.moreTabs', '{{count}} more', { count: overflowedTabs.length })}
                  </span>
                </div>
              </button>
            </div>
          )}

          {isDropdownOpen && overflowedTabs.length > 0 && (
            <div
              ref={dropdownRef}
              className={styles.tabDropdown}
              role="menu"
              aria-label={t('docsPanel.moreTabsMenu', 'More tabs')}
            >
              {overflowedTabs.map((tab) => {
                const getTranslatedTitle = (title: string) => {
                  if (title === 'Recommendations') {
                    return t('docsPanel.recommendations', 'Recommendations');
                  }
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
                  >
                    <div className={styles.dropdownItemContent}>
                      {tab.id !== 'recommendations' && (
                        <Icon
                          name={tab.type === 'docs' ? 'file-alt' : 'book'}
                          size="xs"
                          className={styles.dropdownItemIcon}
                        />
                      )}
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
                      {tab.id !== 'recommendations' && (
                        <IconButton
                          name="times"
                          size="sm"
                          aria-label={t('docsPanel.closeTab', 'Close {{title}}', {
                            title: getTranslatedTitle(tab.title),
                          })}
                          onClick={(e) => {
                            e.stopPropagation();
                            reportAppInteraction(UserInteraction.CloseTabClick, {
                              content_type: tab.type || 'learning-journey',
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
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className={styles.content}>
        {(() => {
          // Show recommendations tab
          if (isRecommendationsTab) {
            return <contextPanel.Component model={contextPanel} />;
          }

          // Show loading state with skeleton
          if (!isRecommendationsTab && activeTab?.isLoading) {
            return (
              <div className={activeTab.type === 'docs' ? styles.docsContent : styles.journeyContent}>
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
              <div className={activeTab.type === 'docs' ? styles.docsContent : styles.journeyContent}>
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
                {/* Content Meta for learning journey pages (when no milestone progress is shown) */}
                {isLearningJourneyTab && !showMilestoneProgress && (
                  <div className={styles.contentMeta}>
                    <div className={styles.metaInfo}>
                      <span>{t('docsPanel.learningJourney', 'Learning Journey')}</span>
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
                            isGrafanaDomain =
                              parsed.hostname === 'grafana.com' || parsed.hostname.endsWith('.grafana.com');
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
                                  content_type: activeTab.type || 'docs',
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
                          reportAppInteraction(UserInteraction.OpenExtraResource, {
                            content_url: url,
                            content_type: activeTab.type || 'learning-journey',
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
                            window.open(url, '_blank', 'noopener,noreferrer');
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
                  {activeTab.content && (
                    <ContentRenderer
                      content={activeTab.content}
                      containerRef={contentRef}
                      className={`${
                        activeTab.content.type === 'learning-journey' ? journeyStyles : docsStyles
                      } ${interactiveStyles} ${prismStyles}`}
                      onContentReady={() => {
                        // Content is ready - any additional setup can go here
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
        <FeedbackButton
          contentUrl={activeTab?.content?.url || activeTab?.baseUrl || ''}
          contentType={activeTab?.type || 'learning-journey'}
          interactionLocation="docs_panel_footer_feedback_button"
          currentMilestone={activeTab?.content?.metadata?.learningJourney?.currentMilestone}
          totalMilestones={activeTab?.content?.metadata?.learningJourney?.totalMilestones}
        />
      )}
    </div>
  );
}

// Export the main component and keep backward compatibility
export { CombinedLearningJourneyPanel };
export class LearningJourneyPanel extends CombinedLearningJourneyPanel {}
export class DocsPanel extends CombinedLearningJourneyPanel {}
