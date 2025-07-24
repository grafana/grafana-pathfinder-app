// Combined Learning Journey and Docs Panel
// Post-refactoring unified component using new content system only

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SceneObjectBase, SceneObjectState, SceneComponentProps } from '@grafana/scenes';
import { IconButton, Alert, Spinner, Icon, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { addGlobalModalStyles } from '../../styles/docs-panel.styles';

import { useInteractiveElements } from '../../utils/interactive.hook';
import { useKeyboardShortcuts } from '../../utils/keyboard-shortcuts.hook';
import { useLinkClickHandler } from '../../utils/link-handler.hook';

import { setupScrollTracking, reportAppInteraction, UserInteraction } from '../../lib/analytics';

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
  setJourneyCompletionPercentage
} from '../../utils/docs-retrieval/learning-journey-helpers';

import { ContextPanel } from './context-panel';

import { getStyles as getComponentStyles } from '../../styles/docs-panel.styles';
import { journeyContentHtml, docsContentHtml } from '../../styles/content-html.styles';
import { getInteractiveStyles } from '../../styles/interactive.styles';

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
}

const STORAGE_KEY = 'grafana-docs-plugin-tabs';
const ACTIVE_TAB_STORAGE_KEY = 'grafana-docs-plugin-active-tab';

class CombinedLearningJourneyPanel extends SceneObjectBase<CombinedPanelState> {
  public static Component = CombinedPanelRenderer;

  public get renderBeforeActivation(): boolean {
    return true;
  }

  public constructor() {
    const restoredTabs = CombinedLearningJourneyPanel.restoreTabsFromStorage();
    const contextPanel = new ContextPanel(
      (url: string, title: string) => this.openLearningJourney(url, title),
      (url: string, title: string) => this.openDocsPage(url, title)
    );

    const activeTabId = CombinedLearningJourneyPanel.restoreActiveTabFromStorage(restoredTabs);

    super({
      tabs: restoredTabs,
      activeTabId,
      contextPanel
    });

    // Initialize the active tab if needed
    this.initializeRestoredActiveTab();
  }

  private generateTabId(): string {
    return `tab-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  private initializeRestoredActiveTab(): void {
    const activeTab = this.state.tabs.find(t => t.id === this.state.activeTabId);
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
            title: 'Recommendations',
            baseUrl: '',
            currentUrl: '',
            content: null,
            isLoading: false,
            error: null,
          }
        ];
        
        parsedData.forEach(data => {
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
      }
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
        
        const tabExists = tabs.some(t => t.id === activeTabId);
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
        .filter(tab => tab.id !== 'recommendations')
        .map(tab => ({
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
      activeTabId: tabId
    });

    // Load content for the tab
    this.loadTabContent(tabId, url);
    
    return tabId;
  }

  public async loadTabContent(tabId: string, url: string) {
    // Update tab to loading state
    const updatedTabs = this.state.tabs.map(t => 
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
      
      const finalUpdatedTabs = this.state.tabs.map(t => 
        t.id === tabId 
          ? { 
              ...t, 
              content: result.content, 
              isLoading: false, 
              error: null,
              currentUrl: url  // Ensure currentUrl is set to the actual loaded URL
            }
          : t
      );
      this.setState({ tabs: finalUpdatedTabs });
      
      // Update completion percentage for learning journeys
      const updatedTab = finalUpdatedTabs.find(t => t.id === tabId);
      if (updatedTab?.type === 'learning-journey' && updatedTab.content) {
        const progress = getJourneyProgress(updatedTab.content);
        setJourneyCompletionPercentage(updatedTab.baseUrl, progress);
      }
      
    } catch (error) {
      console.error(`Failed to load journey content for tab ${tabId}:`, error);
      
      const errorUpdatedTabs = this.state.tabs.map(t => 
        t.id === tabId 
          ? { 
              ...t, 
              isLoading: false, 
              error: error instanceof Error ? error.message : 'Failed to load content',
            }
          : t
      );
      this.setState({ tabs: errorUpdatedTabs });
    }
  }

  public closeTab(tabId: string) {
    if (tabId === 'recommendations') {
      return; // Can't close recommendations tab
    }

    const currentTabs = this.state.tabs;
    const tabIndex = currentTabs.findIndex(t => t.id === tabId);
    
    // Remove the tab
    const newTabs = currentTabs.filter(t => t.id !== tabId);
    
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
      activeTabId: newActiveTabId
    });

    // Save tabs to storage after closing
    this.saveTabsToStorage();
  }

  public setActiveTab(tabId: string) {
    this.setState({ activeTabId: tabId });
    
    // Save active tab to storage
    this.saveTabsToStorage();
    
    // If switching to a tab that hasn't loaded content yet, load it
    const tab = this.state.tabs.find(t => t.id === tabId);
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
    return this.state.tabs.find(t => t.id === this.state.activeTabId) || null;
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
      activeTabId: tabId
    });

    // Load docs content for the tab
    this.loadDocsTabContent(tabId, url);
    
    return tabId;
  }

  public async loadDocsTabContent(tabId: string, url: string) {
    // Update tab to loading state
    const updatedTabs = this.state.tabs.map(t => 
      t.id === tabId 
        ? { 
            ...t, 
            isLoading: true, 
            error: null
          }
        : t
    );
    this.setState({ tabs: updatedTabs });

    try {
      const result = await fetchContent(url);
      
      const finalUpdatedTabs = this.state.tabs.map(t => 
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
      
    } catch (error) {
      console.error(`Failed to load docs content for tab ${tabId}:`, error);
      
      const errorUpdatedTabs = this.state.tabs.map(t => 
        t.id === tabId 
          ? { 
              ...t,
              isLoading: false, 
              error: error instanceof Error ? error.message : 'Failed to load documentation'
            }
          : t
      );
      this.setState({ tabs: errorUpdatedTabs });
    }
  }
}

function CombinedPanelRenderer({ model }: SceneComponentProps<CombinedLearningJourneyPanel>) {
  React.useEffect(() => { addGlobalModalStyles(); }, []);
  const { tabs, activeTabId, contextPanel } = model.useState();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dropdownOpenTimeRef = useRef<number>(0);

  const activeTab = tabs.find(t => t.id === activeTabId) || null;
  const isRecommendationsTab = activeTabId === 'recommendations';
  const theme = useStyles2((theme: GrafanaTheme2) => theme);
  
  const styles = useStyles2(getStyles);
  const interactiveStyles = useStyles2(getInteractiveStyles);

  // Tab overflow management - SIMPLIFIED!
  const tabListRef = useRef<HTMLDivElement>(null);
  const [visibleTabs, setVisibleTabs] = useState<LearningJourneyTab[]>(tabs);
  const [overflowedTabs, setOverflowedTabs] = useState<LearningJourneyTab[]>([]);
  const chevronButtonRef = useRef<HTMLButtonElement>(null);

  // TODO: Replace with dynamic tab width calculation later
  // For now, hard-code to show Recommendations + 1 tab, chevron the rest
  const calculateTabVisibility = useCallback(() => {
    if (tabs.length === 0) {
      setVisibleTabs([]);
      setOverflowedTabs([]);
      return;
    }

    // Simple logic: show first 2 tabs (Recommendations + 1), chevron the rest
    const maxVisibleTabs = 2;
    
    if (tabs.length <= maxVisibleTabs) {
      // All tabs fit, no chevron needed
      setVisibleTabs(tabs);
      setOverflowedTabs([]);
    } else {
      // Show first 2 tabs, chevron the rest
      setVisibleTabs(tabs.slice(0, maxVisibleTabs));
      setOverflowedTabs(tabs.slice(maxVisibleTabs));
    }
  }, [tabs]);

  // Recalculate when tabs change
  useEffect(() => {
    calculateTabVisibility();
  }, [calculateTabVisibility]);

  // Content styles are applied at the component level via CSS classes

  const contentRef = useRef<HTMLDivElement>(null);

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
    model 
  });

  // Save tabs to storage when state changes
  React.useEffect(() => {
    // Call via setState to trigger storage save
    model.setState({ tabs, activeTabId });
  }, [tabs, activeTabId]);

  // Close dropdown when clicking outside and handle positioning
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node) &&
          chevronButtonRef.current && !chevronButtonRef.current.contains(event.target as Node)) {
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
      const { url, title } = event.detail;
      
      // Track auto-launch tutorial analytics
      reportAppInteraction(UserInteraction.StartLearningJourneyClick, {
        journey_title: title,
        journey_url: url,
        trigger_source: 'auto_launch_tutorial',
        interaction_location: 'docs_panel'
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
    if (activeTab && activeTab.content && contentRef.current) {
      const cleanup = setupScrollTracking(
        contentRef.current,
        activeTab,
        isRecommendationsTab
      );
      
      return cleanup;
    }
    
    // Return undefined for the else case
    return undefined;
  }, [activeTab, activeTab?.content, isRecommendationsTab]);

  // ContentRenderer renders the content with styling applied via CSS classes

  return (
    <div className={styles.container}>
      <div className={styles.topBar}>
        <div className={styles.tabBar}>
          <div className={styles.tabList} ref={tabListRef}>
            {/* Render visible tabs */}
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                className={`${styles.tab} ${tab.id === activeTabId ? styles.activeTab : ''}`}
                onClick={() => model.setActiveTab(tab.id)}
                disabled={tab.isLoading}
                title={tab.title}
              >
                <div className={styles.tabContent}>
                  {tab.id !== 'recommendations' && (
                    <Icon 
                      name={tab.type === 'docs' ? 'file-alt' : 'book'} 
                      size="xs" 
                      className={styles.tabIcon} 
                    />
                  )}
                  <span className={styles.tabTitle}>
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
                        
                        reportAppInteraction(UserInteraction.CloseTabClick, {
                          tab_type: tab.type || 'learning-journey',
                          tab_title: tab.title,
                          tab_url: tab.currentUrl || tab.baseUrl,
                          close_location: 'tab_button'
                        });
                        
                        model.closeTab(tab.id);
                      }}
                      className={styles.closeButton}
                    />
                  )}
                </div>
              </button>
            ))}
            
          </div>
          
          {/* Render chevron button for overflowed tabs - OUTSIDE tabList */}
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
                          
                          reportAppInteraction(UserInteraction.CloseTabClick, {
                            tab_type: tab.type || 'learning-journey',
                            tab_title: tab.title,
                            tab_url: tab.currentUrl || tab.baseUrl,
                            close_location: 'dropdown'
                          });
                          
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
          
          // Show content - both learning journeys and docs use the same ContentRenderer now!
          if (!isRecommendationsTab && activeTab?.content && !activeTab.isLoading) {
            const isLearningJourneyTab = activeTab.type === 'learning-journey' || activeTab.type !== 'docs';
            const showMilestoneProgress = isLearningJourneyTab && activeTab.content?.type === 'learning-journey' && 
             activeTab.content.metadata.learningJourney && 
             activeTab.content.metadata.learningJourney.currentMilestone > 0;

            return (
              <div className={activeTab.type === 'docs' ? styles.docsContent : styles.journeyContent}>

                {/* Content Meta for learning journey pages (when no milestone progress is shown) */}
                {isLearningJourneyTab && !showMilestoneProgress && (
                  <div className={styles.contentMeta}>
                    <div className={styles.metaInfo}>
                      <span>Learning Journey</span>
                    </div>
                    <small>
                      {(activeTab.content?.metadata.learningJourney?.totalMilestones || 0) > 0 ? 
                        `${activeTab.content?.metadata.learningJourney?.totalMilestones} milestones` : 
                        'Interactive journey'}
                    </small>
                  </div>
                )}

                {/* Content Meta for docs */}
                {activeTab.type === 'docs' && (
                  <div className={styles.contentMeta}>
                    <div className={styles.metaInfo}>
                      <span>Documentation</span>
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
                          aria-label="Previous milestone"
                          onClick={() => {
                            reportAppInteraction(UserInteraction.MilestoneArrowInteractionClick, {
                              journey_title: activeTab.title,
                              journey_url: activeTab.baseUrl,
                              current_milestone: activeTab.content?.metadata.learningJourney?.currentMilestone || 0,
                              total_milestones: activeTab.content?.metadata.learningJourney?.totalMilestones || 0,
                              direction: 'backward',
                              interaction_location: 'milestone_progress_bar'
                            });
                            
                            model.navigateToPreviousMilestone();
                          }}
                          tooltip="Previous milestone (Alt + ←)"
                          tooltipPlacement="top"
                          disabled={!model.canNavigatePrevious() || activeTab.isLoading}
                          className={styles.navButton}
                        />
                        <span className={styles.milestoneText}>
                          Milestone {activeTab.content?.metadata.learningJourney?.currentMilestone} of {activeTab.content?.metadata.learningJourney?.totalMilestones}
                        </span>
                        <IconButton
                          name="arrow-right"
                          size="sm"
                          aria-label="Next milestone"
                          onClick={() => {
                            reportAppInteraction(UserInteraction.MilestoneArrowInteractionClick, {
                              journey_title: activeTab.title,
                              journey_url: activeTab.baseUrl,
                              current_milestone: activeTab.content?.metadata.learningJourney?.currentMilestone || 0,
                              total_milestones: activeTab.content?.metadata.learningJourney?.totalMilestones || 0,
                              direction: 'forward',
                              interaction_location: 'milestone_progress_bar'
                            });
                            
                            model.navigateToNextMilestone();
                          }}
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
                            width: `${((activeTab.content?.metadata.learningJourney?.currentMilestone || 0) / (activeTab.content?.metadata.learningJourney?.totalMilestones || 1)) * 100}%` 
                          }} 
                        />
                      </div>
                    </div>
                  </div>
                )}
                
                {/* Content Action Bar */}
                <div className={styles.contentActionBar}>
                  <IconButton
                    name="external-link-alt"
                    size="xs"
                    aria-label={`Open this ${activeTab.type === 'docs' ? 'page' : 'journey'} in new tab`}
                    onClick={() => {
                      const url = activeTab.content?.url || activeTab.baseUrl;
                      if (url) {
                        reportAppInteraction(UserInteraction.OpenDocumentationButton, {
                          content_type: activeTab.type || 'learning-journey',
                          content_title: activeTab.title,
                          content_url: url,
                          interaction_location: `${activeTab.type === 'docs' ? 'docs' : 'journey'}_content_action_bar`,
                          ...(activeTab.type !== 'docs' && activeTab.content?.metadata.learningJourney && {
                            current_milestone: activeTab.content.metadata.learningJourney.currentMilestone,
                            total_milestones: activeTab.content.metadata.learningJourney.totalMilestones
                          })
                        });
                        
                        window.open(url, '_blank', 'noopener,noreferrer');
                      }
                    }}
                    tooltip={`Open this ${activeTab.type === 'docs' ? 'page' : 'journey'} in new tab`}
                    tooltipPlacement="top"
                    className={styles.actionButton}
                  />
                </div>
                
                {/* Unified Content Renderer - works for both learning journeys and docs! */}
                <div id='inner-docs-content' style={{ 
                  flex: 1, 
                  overflow: 'auto',
                  minHeight: 0 
                }}>
                  {activeTab.content && (
                    <ContentRenderer
                      content={activeTab.content}
                      containerRef={contentRef}
                      className={`${activeTab.content.type === 'learning-journey' 
                        ? journeyContentHtml(theme) 
                        : docsContentHtml(theme)
                      } ${interactiveStyles}`}
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
    </div>
  );
}

// Export the main component and keep backward compatibility
export { CombinedLearningJourneyPanel };
export class LearningJourneyPanel extends CombinedLearningJourneyPanel {}
export class DocsPanel extends CombinedLearningJourneyPanel {} 

