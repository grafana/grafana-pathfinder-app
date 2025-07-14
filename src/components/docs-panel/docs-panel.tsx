import React, { useEffect, useRef, useState, useCallback } from 'react';
import { css } from '@emotion/css';

import { SceneComponentProps, SceneObjectBase, SceneObjectState } from '@grafana/scenes';
import { Icon, IconButton, useStyles2, Spinner, Alert, useTheme2 } from '@grafana/ui';

import { useInteractiveElements } from '../../utils/interactive.hook';
import { useContentProcessing } from '../../utils/content-processing.hook';
import { useKeyboardShortcuts } from '../../utils/keyboard-shortcuts.hook';
import { useLinkClickHandler } from '../../utils/link-handler.hook';
import { getStyles as getComponentStyles, addGlobalModalStyles } from '../../styles/docs-panel.styles';
import { journeyContentHtml, docsContentHtml } from '../../styles/content-html.styles';
import { getInteractiveStyles, addGlobalInteractiveStyles } from '../../styles/interactive.styles';
import { TAB_CONFIG } from '../../constants/selectors';

import { 
  fetchLearningJourneyContent, 
  LearningJourneyContent,
  getNextMilestoneUrl,
  getPreviousMilestoneUrl,
  clearSpecificJourneyCache,
} from '../../utils/docs-fetcher';
import { 
  fetchSingleDocsContent, 
  SingleDocsContent 
} from '../../utils/single-docs-fetcher';
import { ContextPanel } from './context-panel';

// Use the properly extracted styles
const getStyles = getComponentStyles;

interface LearningJourneyTab {
  id: string;
  title: string;
  baseUrl: string;
  currentUrl: string; // The specific milestone/page URL currently loaded
  content: LearningJourneyContent | null;
  isLoading: boolean;
  error: string | null;
  type?: 'learning-journey' | 'docs';
  docsContent?: SingleDocsContent | null;
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
}

// localStorage keys for tab persistence
const TABS_STORAGE_KEY = 'grafana-docs-plugin-tabs';
const ACTIVE_TAB_STORAGE_KEY = 'grafana-docs-plugin-active-tab';

class CombinedLearningJourneyPanel extends SceneObjectBase<CombinedPanelState> {
  public static Component = CombinedPanelRenderer;

  public get renderBeforeActivation(): boolean {
    return true;
  }

  public constructor() {
    const contextPanel = new ContextPanel((url: string, title: string) => {
      this.openLearningJourney(url, title);
    }, (url: string, title: string) => {
      this.openDocsPage(url, title);
    });

    // Restore tabs from localStorage
    const restoredTabs = CombinedLearningJourneyPanel.restoreTabsFromStorage();
    const restoredActiveTabId = CombinedLearningJourneyPanel.restoreActiveTabFromStorage(restoredTabs);

    super({
      tabs: restoredTabs,
      activeTabId: restoredActiveTabId,
      contextPanel,
    });

    // Initialize restored active tab content if needed
    if (restoredActiveTabId !== 'recommendations') {
      this.initializeRestoredActiveTab();
    }
  }

  private generateTabId(): string {
    return `journey-tab-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  private initializeRestoredActiveTab(): void {
    // Small delay to ensure the state has been updated
    setTimeout(() => {
      const activeTab = this.getActiveTab();
      if (!activeTab || activeTab.id === 'recommendations') {
        return;
      }

      // Load content based on tab type, using currentUrl to preserve exact position
      if (activeTab.type === 'docs' && !activeTab.docsContent && !activeTab.isLoading) {
        this.loadDocsTabContent(activeTab.id, activeTab.currentUrl);
      } else if (activeTab.type !== 'docs' && !activeTab.content && !activeTab.isLoading) {
        // Use currentUrl (specific milestone) rather than baseUrl (journey start)
        this.loadTabContent(activeTab.id, activeTab.currentUrl);
      }
    }, 100);
  }

  // Static methods for tab persistence
  private static restoreTabsFromStorage(): LearningJourneyTab[] {
    try {
      const storedTabs = localStorage.getItem(TABS_STORAGE_KEY);
      if (storedTabs) {
        const persistedTabs: PersistedTabData[] = JSON.parse(storedTabs);
        
        // Convert persisted data back to full tab objects
        const restoredTabs: LearningJourneyTab[] = persistedTabs.map(persistedTab => ({
          id: persistedTab.id,
          title: persistedTab.title,
          baseUrl: persistedTab.baseUrl,
          currentUrl: persistedTab.currentUrl || persistedTab.baseUrl, // Fallback for old data
          content: null, // Content will be loaded on demand
          isLoading: false,
          error: null,
          type: persistedTab.type,
          docsContent: null, // Content will be loaded on demand
        }));
        
        // Always ensure recommendations tab is first
        const recommendationsTab: LearningJourneyTab = {
          id: 'recommendations',
          title: 'Recommendations',
          baseUrl: '',
          currentUrl: '',
          content: null,
          isLoading: false,
          error: null,
        };
        
        // Filter out recommendations tab from restored tabs and prepend it
        const otherTabs = restoredTabs.filter(tab => tab.id !== 'recommendations');
        return [recommendationsTab, ...otherTabs];
      }
    } catch (error) {
      console.warn('Failed to restore tabs from storage:', error);
    }
    
    // Fallback to default state
    return [
      {
        id: 'recommendations',
        title: 'Recommendations',
        baseUrl: '',
        currentUrl: '',
        content: null,
        isLoading: false,
        error: null,
      }
    ];
  }

  private static restoreActiveTabFromStorage(tabs: LearningJourneyTab[]): string {
    try {
      const storedActiveTabId = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
      if (storedActiveTabId && tabs.some(tab => tab.id === storedActiveTabId)) {
        return storedActiveTabId;
      }
    } catch (error) {
      console.warn('Failed to restore active tab from storage:', error);
    }
    
    // Fallback to recommendations tab
    return 'recommendations';
  }

  private saveTabsToStorage(): void {
    try {
      // Only persist non-recommendations tabs with essential data
      const tabsToSave: PersistedTabData[] = this.state.tabs
        .filter(tab => tab.id !== 'recommendations')
        .map(tab => ({
          id: tab.id,
          title: tab.title,
          baseUrl: tab.baseUrl,
          currentUrl: tab.currentUrl,
          type: tab.type,
        }));
      
      localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(tabsToSave));
      localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, this.state.activeTabId);
    } catch (error) {
      console.warn('Failed to save tabs to storage:', error);
    }
  }

  public static clearPersistedTabs(): void {
    try {
      localStorage.removeItem(TABS_STORAGE_KEY);
      localStorage.removeItem(ACTIVE_TAB_STORAGE_KEY);
    } catch (error) {
      console.warn('Failed to clear persisted tabs:', error);
    }
  }

  public async openLearningJourney(url: string, title?: string): Promise<string> {
    const tabId = this.generateTabId();
    const newTab: LearningJourneyTab = {
      id: tabId,
      title: title || 'Loading...',
      baseUrl: url,
      currentUrl: url, // Store the specific milestone URL
      content: null,
      isLoading: false, // Start as not loading - we'll load on demand
      error: null,
    };

    const updatedTabs = [...this.state.tabs, newTab];
    
    this.setState({
      tabs: updatedTabs,
      activeTabId: tabId,
    });

    // Save tabs to storage
    this.saveTabsToStorage();

    // Load content immediately when tab is created and activated
    await this.loadTabContent(tabId, url);
    
    return tabId;
  }

  public async loadTabContent(tabId: string, url: string) {
    // Find the tab and set loading state
    const tab = this.state.tabs.find(t => t.id === tabId);
    if (!tab) {
      console.error(`Tab ${tabId} not found`);
      return;
    }

    // Update tab state to loading and set the currentUrl to the URL being loaded
    const updatedTabs = this.state.tabs.map(t => 
      t.id === tabId 
        ? { 
            ...t, 
            isLoading: true, 
            error: null, 
            currentUrl: url  // Update currentUrl when loading new content
          }
        : t
    );
    this.setState({ tabs: updatedTabs });

    try {
      const content = await fetchLearningJourneyContent(url);
      
      const finalUpdatedTabs = this.state.tabs.map(t => 
        t.id === tabId 
          ? { 
              ...t, 
              content: content, 
              isLoading: false, 
              error: null,
              currentUrl: url  // Ensure currentUrl is set to the actual loaded URL
            }
          : t
      );
      this.setState({ tabs: finalUpdatedTabs });
      
      // Save tabs to storage after content loading (preserves milestone position)
      this.saveTabsToStorage();
      
    } catch (error) {
      console.error(`Failed to load tab content: ${error}`);

      const errorUpdatedTabs = this.state.tabs.map(t => 
        t.id === tabId 
          ? { 
              ...t, 
              isLoading: false, 
              error: `Failed to load content: ${error instanceof Error ? error.message : 'Unknown error'}`,
              currentUrl: url  // Keep currentUrl even on error for retry purposes
            }
          : t
      );
      this.setState({ tabs: errorUpdatedTabs });
    }
  }

  public closeTab(tabId: string) {
    // Don't allow closing the recommendations tab
    if (tabId === 'recommendations') {return;}

    // Get the tab before removing it so we can clear its cache
    const tabToClose = this.state.tabs.find(tab => tab.id === tabId);

    const updatedTabs = this.state.tabs.filter(tab => tab.id !== tabId);
    
    // If we're closing the active tab, switch to recommendations or another tab
    let newActiveTabId = this.state.activeTabId;
    if (this.state.activeTabId === tabId) {
      newActiveTabId = 'recommendations'; // Always fall back to recommendations
    }

    this.setState({
      tabs: updatedTabs,
      activeTabId: newActiveTabId,
    });

    // Save tabs to storage after closing
    this.saveTabsToStorage();

    // Clear ALL cache for the specific journey when app tab is closed
    // This ensures reopening the journey starts fresh from the beginning
    if (tabToClose && tabToClose.baseUrl) {
      clearSpecificJourneyCache(tabToClose.baseUrl);
    }
  }

  public setActiveTab(tabId: string) {
    this.setState({ activeTabId: tabId });
    
    // Save active tab to storage
    this.saveTabsToStorage();
    
    // If switching to a tab that hasn't loaded content yet, load it
    const tab = this.state.tabs.find(t => t.id === tabId);
    if (tab && tabId !== 'recommendations' && !tab.isLoading && !tab.error) {
      if (tab.type === 'docs' && !tab.docsContent) {
        this.loadDocsTabContent(tabId, tab.currentUrl); // Use currentUrl to restore exact page
      } else if (tab.type !== 'docs' && !tab.content) {
        this.loadTabContent(tabId, tab.currentUrl); // Use currentUrl to restore exact milestone
      }
    }
  }

  public async navigateToNextMilestone() {
    const activeTab = this.getActiveTab();
    if (!activeTab?.content || activeTab.id === 'recommendations') {return;}

    const nextUrl = getNextMilestoneUrl(activeTab.content);
    if (nextUrl) {
      await this.loadTabContent(activeTab.id, nextUrl);
    }
  }

  public async navigateToPreviousMilestone() {
    const activeTab = this.getActiveTab();
    if (!activeTab?.content || activeTab.id === 'recommendations') {return;}

    const prevUrl = getPreviousMilestoneUrl(activeTab.content);
    if (prevUrl) {
      await this.loadTabContent(activeTab.id, prevUrl);
    }
  }

  public getActiveTab(): LearningJourneyTab | null {
    return this.state.tabs.find(tab => tab.id === this.state.activeTabId) || null;
  }

  public canNavigateNext(): boolean {
    const activeTab = this.getActiveTab();
    return activeTab?.content && activeTab.id !== 'recommendations' ? getNextMilestoneUrl(activeTab.content) !== null : false;
  }

  public canNavigatePrevious(): boolean {
    const activeTab = this.getActiveTab();
    return activeTab?.content && activeTab.id !== 'recommendations' ? getPreviousMilestoneUrl(activeTab.content) !== null : false;
  }

  public async openDocsPage(url: string, title?: string): Promise<string> {
    const tabId = this.generateTabId();
    const newTab: LearningJourneyTab = {
      id: tabId,
      title: title || 'Loading...',
      baseUrl: url,
      currentUrl: url, // Store the specific docs page URL
      content: null,
      isLoading: false,
      error: null,
      type: 'docs',
      docsContent: null,
    };

    const updatedTabs = [...this.state.tabs, newTab];
    
    this.setState({
      tabs: updatedTabs,
      activeTabId: tabId,
    });

    // Save tabs to storage
    this.saveTabsToStorage();

    // Load docs content immediately when tab is created and activated
    await this.loadDocsTabContent(tabId, url);
    
    return tabId;
  }

  public async loadDocsTabContent(tabId: string, url: string) {
    const tabIndex = this.state.tabs.findIndex(tab => tab.id === tabId);
    if (tabIndex === -1) {return;}

    // Update tab to loading state
    const updatedTabs = [...this.state.tabs];
    updatedTabs[tabIndex] = {
      ...updatedTabs[tabIndex],
      isLoading: true,
      error: null,
    };
    this.setState({ tabs: updatedTabs });

    try {
      const docsContent = await fetchSingleDocsContent(url);
      
      const finalTabs = [...this.state.tabs];
      const finalTabIndex = finalTabs.findIndex(tab => tab.id === tabId);
      
      if (finalTabIndex !== -1) {
        // Only update title if it's still "Loading..." (preserve original title)
        const shouldUpdateTitle = finalTabs[finalTabIndex].title === 'Loading...';
        const urlChanged = finalTabs[finalTabIndex].currentUrl !== url;
        
        finalTabs[finalTabIndex] = {
          ...finalTabs[finalTabIndex],
          docsContent: docsContent,
          currentUrl: url, // Update currentUrl to track current page
          title: shouldUpdateTitle ? (docsContent?.title || finalTabs[finalTabIndex].title) : finalTabs[finalTabIndex].title,
          isLoading: false,
          error: docsContent ? null : 'Failed to load documentation',
        };
        this.setState({ tabs: finalTabs });
        
        // Save tabs to storage if title was updated or URL changed
        if ((shouldUpdateTitle && docsContent?.title) || urlChanged) {
          this.saveTabsToStorage();
        }
      }
    } catch (error) {
      console.error('Failed to load docs:', error);
      const errorTabs = [...this.state.tabs];
      const errorTabIndex = errorTabs.findIndex(tab => tab.id === tabId);
      
      if (errorTabIndex !== -1) {
        errorTabs[errorTabIndex] = {
          ...errorTabs[errorTabIndex],
          docsContent: null,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Failed to load documentation',
        };
        this.setState({ tabs: errorTabs });
      }
    }
  }
}

function CombinedPanelRenderer({ model }: SceneComponentProps<CombinedLearningJourneyPanel>) {
  const { tabs, activeTabId, contextPanel } = model.useState();
  const styles = useStyles2(getStyles);
  const theme = useTheme2();
  const contentRef = useRef<HTMLDivElement>(null);
  const activeTab = model.getActiveTab();
  const isRecommendationsTab = activeTabId === TAB_CONFIG.RECOMMENDATIONS_ID;

  // Tab overflow management
  const tabListRef = useRef<HTMLDivElement>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [visibleTabs, setVisibleTabs] = useState<LearningJourneyTab[]>(tabs);
  const [overflowedTabs, setOverflowedTabs] = useState<LearningJourneyTab[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const chevronButtonRef = useRef<HTMLButtonElement>(null);

  // Calculate visible vs overflowed tabs
  const calculateTabVisibility = useCallback(() => {
    const tabContainer = tabListRef.current;
    if (!tabContainer) {
      setVisibleTabs(tabs);
      setOverflowedTabs([]);
      return;
    }

    const containerWidth = tabContainer.clientWidth;
    const tabMinWidth = 140; // From styles: minWidth: '140px'
    const chevronWidth = 120; // More accurate width for chevron button (from maxWidth: '120px')
    const gap = 4; // From styles: gap: theme.spacing(0.5) ≈ 4px

    // First, calculate how many tabs can fit without any chevron
    const maxTabsWithoutChevron = Math.floor(containerWidth / (tabMinWidth + gap));
    
    if (tabs.length <= maxTabsWithoutChevron) {
      // All tabs fit without needing a chevron
      setVisibleTabs(tabs);
      setOverflowedTabs([]);
      return;
    }

    // Some tabs need to overflow - calculate how many can fit WITH a chevron
    const availableWidthWithChevron = containerWidth - chevronWidth - gap; // Reserve space for chevron + gap
    const maxTabsWithChevron = Math.floor(availableWidthWithChevron / (tabMinWidth + gap));
    const numVisibleTabs = Math.max(1, maxTabsWithChevron); // Always show at least 1 tab

    setVisibleTabs(tabs.slice(0, numVisibleTabs));
    setOverflowedTabs(tabs.slice(numVisibleTabs));
  }, [tabs]);

  // Recalculate tab visibility when tabs change or window resizes
  useEffect(() => {
    calculateTabVisibility();
  }, [calculateTabVisibility]);

  useEffect(() => {
    const handleResize = () => {
      calculateTabVisibility();
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [calculateTabVisibility]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node) &&
          chevronButtonRef.current && !chevronButtonRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
    return undefined;
  }, [isDropdownOpen]);

  // Create combined content styles that include interactive styles
  const journeyContentStyles = css`
    ${journeyContentHtml(theme)}
    ${getInteractiveStyles(theme)}
  `;
  const docsContentStyles = css`
    ${docsContentHtml(theme)}
    ${getInteractiveStyles(theme)}
  `;

  // Add global modal and interactive styles on component mount
  useEffect(() => {
    addGlobalModalStyles();
    addGlobalInteractiveStyles();
  }, []);

  // Listen for auto-launch tutorial events
  useEffect(() => {
    // Listen for the auto-launch tutorial event
    const handleAutoLaunchTutorial = (event: CustomEvent) => {
      const { url, type, title } = event.detail;
      
      try {
        if (type === 'learning-journey') {
          // Open as learning journey
          model.openLearningJourney(url, title);
        } else {
          // Open as docs page
          model.openDocsPage(url, title);
        }
      } catch (error) {
        console.error('Failed to handle auto-launch tutorial:', error);
      }
    };

    // Listen for the auto-launch tutorial event
    document.addEventListener('auto-launch-tutorial', handleAutoLaunchTutorial as EventListener);

    // Cleanup
    return () => {
      document.removeEventListener('auto-launch-tutorial', handleAutoLaunchTutorial as EventListener);
    };
  }, [model]);

  // Use custom hooks for cleaner organization
  useInteractiveElements({ containerRef: contentRef });
  
  useContentProcessing({
    contentRef,
    activeTabContent: activeTab?.content,
    activeTabDocsContent: activeTab?.docsContent,
  });

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
    model: {
      loadTabContent: (tabId: string, url: string) => model.loadTabContent(tabId, url),
      openLearningJourney: (url: string, title: string) => model.openLearningJourney(url, title),
      getActiveTab: () => model.getActiveTab(),
      navigateToNextMilestone: () => model.navigateToNextMilestone(),
      navigateToPreviousMilestone: () => model.navigateToPreviousMilestone(),
      canNavigateNext: () => model.canNavigateNext(),
      canNavigatePrevious: () => model.canNavigatePrevious(),
    },
  });

  // Handle docs internal links to open in new app tabs instead of browser tabs
  useEffect(() => {
    const contentElement = contentRef.current;
    if (!contentElement) {return;}

    const handleDocsLinkClick = (e: Event) => {
      const target = e.target as HTMLElement;
      const link = target.closest('a') as HTMLAnchorElement;
      
      if (link) {
        const hasInternalAttribute = link.hasAttribute('data-docs-internal-link');
        const hasAnchorAttribute = link.hasAttribute('data-docs-anchor-link');
        
        if (hasAnchorAttribute) {
          // Handle anchor links - scroll to target element within the page
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          
          const anchorTarget = link.getAttribute('data-anchor-target');
          if (anchorTarget) {
            // Use the same element selection strategy as the existing anchor scrolling code
            const targetElement = 
              contentElement.querySelector(`#${anchorTarget}`) ||
              contentElement.querySelector(`[id="${anchorTarget}"]`) ||
              contentElement.querySelector(`[name="${anchorTarget}"]`) ||
              contentElement.querySelector(`h1:contains("${anchorTarget.replace(/-/g, ' ')}")`) ||
              contentElement.querySelector(`h2:contains("${anchorTarget.replace(/-/g, ' ')}")`) ||
              contentElement.querySelector(`h3:contains("${anchorTarget.replace(/-/g, ' ')}")`) ||
              contentElement.querySelector(`h4:contains("${anchorTarget.replace(/-/g, ' ')}")`) ||
              contentElement.querySelector(`h5:contains("${anchorTarget.replace(/-/g, ' ')}")`) ||
              contentElement.querySelector(`h6:contains("${anchorTarget.replace(/-/g, ' ')}")`);

            if (targetElement) {
              targetElement.scrollIntoView({ 
                behavior: 'smooth', 
                block: 'start',
                inline: 'nearest'
              });
              
              // Add a highlight effect to make it obvious
              const originalBackground = (targetElement as HTMLElement).style.backgroundColor;
              (targetElement as HTMLElement).style.backgroundColor = theme.colors.warning.main;
              (targetElement as HTMLElement).style.transition = 'background-color 0.3s ease';
              
              setTimeout(() => {
                (targetElement as HTMLElement).style.backgroundColor = originalBackground;
                setTimeout(() => {
                  (targetElement as HTMLElement).style.transition = '';
                }, 300);
              }, 2000);
              
            } else {
              console.warn(`❌ Could not find anchor element for: #${anchorTarget}`);
              // Fallback: try to find any element with text content matching the anchor
              const allElements = contentElement.querySelectorAll('h1, h2, h3, h4, h5, h6, [id], [name]');
              for (const element of allElements) {
                if (element.id.toLowerCase().includes(anchorTarget.toLowerCase()) ||
                    element.textContent?.toLowerCase().replace(/\s+/g, '-').includes(anchorTarget.toLowerCase())) {
                  element.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  break;
                }
              }
            }
          }
        } else if (hasInternalAttribute) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          
          const href = link.getAttribute('href');
          if (href) {
            const title = link.textContent?.trim() || 'Documentation';
            
            // Make sure we have a valid docs URL
            let finalUrl = href;
            
            // If it's a relative URL starting with /docs/, make it absolute
            if (href.startsWith('/docs/')) {
              finalUrl = `https://grafana.com${href}`;
            }
            
            // Determine if it's a learning journey or regular docs page
            const isLearningJourney = finalUrl.includes('/learning-journeys/');
            
            if (isLearningJourney) {
              model.openLearningJourney(finalUrl, title);
            } else {
              model.openDocsPage(finalUrl, title);
            }
          }
        }
      }
    };

    // Add event listener for docs internal links - use capture phase to intercept early
    contentElement.addEventListener('click', handleDocsLinkClick, true);

    // Cleanup
    return () => {
      contentElement.removeEventListener('click', handleDocsLinkClick, true);
    };
  }, [activeTab, model, theme]);

  // Handle anchor scrolling when content with hash fragments loads
  useEffect(() => {
    const contentElement = contentRef.current;
    if (!contentElement || !activeTab) {return;}

    let hashFragment: string | undefined;
    
    // Get hash fragment from either docs content or learning journey content
    if (activeTab.type === 'docs' && activeTab.docsContent?.hashFragment) {
      hashFragment = activeTab.docsContent.hashFragment;
    } else if (activeTab.type !== 'docs' && activeTab.content?.hashFragment) {
      hashFragment = activeTab.content.hashFragment;
    }

    if (hashFragment) {
      setTimeout(() => {
        // Try multiple element selection strategies
        const targetElement = 
          contentElement.querySelector(`#${hashFragment}`) ||
          contentElement.querySelector(`[id="${hashFragment}"]`) ||
          contentElement.querySelector(`[name="${hashFragment}"]`) ||
          contentElement.querySelector(`h1:contains("${hashFragment.replace(/-/g, ' ')}")`) ||
          contentElement.querySelector(`h2:contains("${hashFragment.replace(/-/g, ' ')}")`) ||
          contentElement.querySelector(`h3:contains("${hashFragment.replace(/-/g, ' ')}")`) ||
          contentElement.querySelector(`h4:contains("${hashFragment.replace(/-/g, ' ')}")`) ||
          contentElement.querySelector(`h5:contains("${hashFragment.replace(/-/g, ' ')}")`) ||
          contentElement.querySelector(`h6:contains("${hashFragment.replace(/-/g, ' ')}")`);

        if (targetElement) {
          targetElement.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'start',
            inline: 'nearest'
          });
          
          // Add a highlight effect to make it obvious
          const originalBackground = (targetElement as HTMLElement).style.backgroundColor;
          (targetElement as HTMLElement).style.backgroundColor = theme.colors.warning.main;
          (targetElement as HTMLElement).style.transition = 'background-color 0.3s ease';
          
          setTimeout(() => {
            (targetElement as HTMLElement).style.backgroundColor = originalBackground;
            setTimeout(() => {
              (targetElement as HTMLElement).style.transition = '';
            }, 300);
          }, 2000);
          
        } else {
          console.warn(`❌ Could not find anchor element for: #${hashFragment}`);
          // Fallback: try to find any element with text content matching the hash
          const allElements = contentElement.querySelectorAll('h1, h2, h3, h4, h5, h6, [id], [name]');
          for (const element of allElements) {
            if (element.id.toLowerCase().includes(hashFragment.toLowerCase()) ||
                element.textContent?.toLowerCase().replace(/\s+/g, '-').includes(hashFragment.toLowerCase())) {
              element.scrollIntoView({ behavior: 'smooth', block: 'start' });
              break;
            }
          }
        }
      }, 100);
    }
  }, [activeTab?.docsContent?.hashFragment, activeTab?.content?.hashFragment, activeTab?.isLoading, activeTab, contentRef, theme]);

  // Link handling is now managed by the useLinkClickHandler hook

  return (
    <div className={styles.container}>
      <div className={styles.topBar}>
        <div className={styles.title}>
          <div className={styles.titleContent}>
            <div className={styles.appIcon}>
              <Icon name="book" size="lg" />
            </div>
            <div className={styles.titleText}>
              Documentation
            </div>
          </div>
        </div>
        <div className={styles.actions}>
          {/* Actions moved to content meta areas for better context */}
        </div>
      </div>

      {/* Tab Bar */}
      <div className={styles.tabBar}>
        <div className={styles.tabList} ref={tabListRef}>
          {/* Render visible tabs */}
          {visibleTabs.map((tab) => (
            <div
              key={tab.id}
              className={`${styles.tab} ${tab.id === activeTabId ? styles.activeTab : ''}`}
              onClick={() => model.setActiveTab(tab.id)}
            >
              <div className={styles.tabContent}>
                {tab.id !== 'recommendations' && (
                  <Icon 
                    name={tab.type === 'docs' ? 'file-alt' : 'book'} 
                    size="xs" 
                    className={styles.tabIcon} 
                  />
                )}
                <span className={styles.tabTitle} title={tab.title}>
                  {tab.isLoading ? (
                    <>
                      <Icon name="sync" size="xs" />
                      <span className={styles.loadingText}>Loading...</span>
                    </>
                  ) : (
                    tab.title
                  )}
                </span>
                {tab.id !== 'recommendations' && (
                  <IconButton
                    name="times"
                    size="sm"
                    aria-label="Close tab"
                    onClick={(e) => {
                      e.stopPropagation();
                      model.closeTab(tab.id);
                    }}
                    className={styles.closeButton}
                  />
                )}
              </div>
            </div>
          ))}
          
          {/* Render chevron button for overflowed tabs */}
          {overflowedTabs.length > 0 && (
            <div className={styles.tabOverflow}>
              <button
                ref={chevronButtonRef}
                className={`${styles.tab} ${styles.chevronTab}`}
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                aria-label={`Show ${overflowedTabs.length} more tabs`}
                aria-expanded={isDropdownOpen}
                aria-haspopup="true"
              >
                <div className={styles.tabContent}>
                  <Icon name="angle-right" size="sm" className={styles.chevronIcon} />
                  <span className={styles.tabTitle}>
                    {overflowedTabs.length} more
                  </span>
                </div>
              </button>
            </div>
          )}
        </div>
        
        {/* Render dropdown outside of tabList but inside tabBar */}
        {isDropdownOpen && overflowedTabs.length > 0 && (
          <div ref={dropdownRef} className={styles.tabDropdown} role="menu" aria-label="More tabs">
            {overflowedTabs.map((tab) => (
              <button
                key={tab.id}
                className={`${styles.dropdownItem} ${tab.id === activeTabId ? styles.activeDropdownItem : ''}`}
                onClick={() => {
                  model.setActiveTab(tab.id);
                  setIsDropdownOpen(false);
                }}
                role="menuitem"
                aria-label={`Switch to ${tab.title}`}
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
                        <span>Loading...</span>
                      </>
                    ) : (
                      tab.title
                    )}
                  </span>
                  {tab.id !== 'recommendations' && (
                    <IconButton
                      name="times"
                      size="sm"
                      aria-label={`Close ${tab.title}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        model.closeTab(tab.id);
                      }}
                      className={styles.dropdownItemClose}
                    />
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={styles.content}>
        {(() => {
          // Show recommendations tab
          if (isRecommendationsTab) {
            return <contextPanel.Component model={contextPanel} />;
          }
          
          // Show loading state
          if (!isRecommendationsTab && activeTab?.isLoading) {
            return (
              <div className={styles.loadingContainer}>
                <Spinner size="lg" />
                <span>Loading {activeTab.type === 'docs' ? 'documentation' : 'learning journey'}...</span>
              </div>
            );
          }
          
          // Show error state
          if (!isRecommendationsTab && activeTab?.error && !activeTab.isLoading) {
            return (
              <Alert severity="error" title={activeTab.type === 'docs' ? 'Documentation' : 'Learning Journey'}>
                {activeTab.error}
              </Alert>
            );
          }
          
          // Show docs content
          if (!isRecommendationsTab && activeTab?.type === 'docs' && activeTab?.docsContent && !activeTab.isLoading) {
            return (
              <div className={styles.docsContent}>

                
                {/* Content Action Bar */}
                <div className={styles.contentActionBar}>
                  <IconButton
                    name="external-link-alt"
                    size="xs"
                    aria-label="Open this page in new tab"
                    onClick={() => {
                      const url = activeTab.docsContent?.url || activeTab.baseUrl;
                      if (url) {
                        window.open(url, '_blank', 'noopener,noreferrer');
                      }
                    }}
                    tooltip="Open this page in new tab"
                    tooltipPlacement="top"
                    className={styles.actionButton}
                  />
                </div>
                
                <div 
                  ref={contentRef}
                  className={docsContentStyles}
                  dangerouslySetInnerHTML={{ __html: activeTab.docsContent.content }}
                />
              </div>
            );
          }
          
          // Show learning journey content
          if (!isRecommendationsTab && activeTab?.type !== 'docs' && activeTab?.content && !activeTab.isLoading) {
            return (
              <div className={styles.journeyContent}>
                {/* Milestone Progress - only show for milestone pages (currentMilestone > 0) */}
                {activeTab.content.currentMilestone > 0 && activeTab.content.milestones.length > 0 && (
                  <div className={styles.milestoneProgress}>
                    <div className={styles.progressInfo}>
                      <div className={styles.progressHeader}>
                        <IconButton
                          name="arrow-left"
                          size="sm"
                          aria-label="Previous milestone"
                          onClick={() => model.navigateToPreviousMilestone()}
                          tooltip="Previous milestone (Alt + ←)"
                          tooltipPlacement="top"
                          disabled={!model.canNavigatePrevious() || activeTab.isLoading}
                          className={styles.navButton}
                        />
                        <span className={styles.milestoneText}>
                          Milestone {activeTab.content.currentMilestone} of {activeTab.content.totalMilestones}
                        </span>
                        <IconButton
                          name="arrow-right"
                          size="sm"
                          aria-label="Next milestone"
                          onClick={() => model.navigateToNextMilestone()}
                          tooltip="Next milestone (Alt + →)"
                          tooltipPlacement="top"
                          disabled={!model.canNavigateNext() || activeTab.isLoading}
                          className={styles.navButton}
                        />
                      </div>
                      <div className={styles.progressBar}>
                        <div 
                          className={styles.progressFill}
                          style={{ 
                            width: `${(activeTab.content.currentMilestone / activeTab.content.totalMilestones) * 100}%` 
                          }}
                        />
                      </div>
                    </div>
                  </div>
                )}
                
                {/* Content Meta for cover pages (when no milestone progress is shown) */}
                {!(activeTab.content.currentMilestone > 0 && activeTab.content.milestones.length > 0) && (
                  <div className={styles.contentMeta}>
                    <div className={styles.metaInfo}>
                      <span>Learning Journey</span>
                    </div>
                    <small>
                      {activeTab.content.totalMilestones > 0 ? `${activeTab.content.totalMilestones} milestones` : 'Interactive journey'}
                    </small>
                  </div>
                )}
                
                {/* Content Action Bar */}
                <div className={styles.contentActionBar}>
                  <IconButton
                    name="external-link-alt"
                    size="xs"
                    aria-label="Open this journey in new tab"
                    onClick={() => {
                      const url = activeTab.content?.url;
                      if (url) {
                        window.open(url, '_blank', 'noopener,noreferrer');
                      }
                    }}
                    tooltip="Open this journey in new tab"
                    tooltipPlacement="top"
                    className={styles.actionButton}
                  />
                </div>
                
                <div id='inner-docs-content'
                  ref={contentRef}
                  className={journeyContentStyles}
                  dangerouslySetInnerHTML={{ __html: activeTab.content.content }}
                />
              </div>
            );
          }
          
          return null;
        })()}
      </div>
    </div>
  );
}

// Export the main component and keep backward compatibility
export { CombinedLearningJourneyPanel };
export class LearningJourneyPanel extends CombinedLearningJourneyPanel {}
export class DocsPanel extends CombinedLearningJourneyPanel {}
