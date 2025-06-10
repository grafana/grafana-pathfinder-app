import { css } from '@emotion/css';
import React, { useEffect, useRef } from 'react';

import { GrafanaTheme2 } from '@grafana/data';
import { SceneComponentProps, SceneObjectBase, SceneObjectState } from '@grafana/scenes';
import { Icon, IconButton, useStyles2, Spinner, Alert } from '@grafana/ui';

import { 
  fetchLearningJourneyContent, 
  LearningJourneyContent,
  getNextMilestoneUrl,
  getPreviousMilestoneUrl,
  clearLearningJourneyCache,
  clearSpecificJourneyCache
} from '../../utils/docs-fetcher';
import { 
  fetchSingleDocsContent, 
  SingleDocsContent 
} from '../../utils/single-docs-fetcher';
import { ContextPanel } from './context-panel';
import { SingleDocsPanel } from './single-docs-panel';

interface LearningJourneyTab {
  id: string;
  title: string;
  baseUrl: string;
  content: LearningJourneyContent | null;
  isLoading: boolean;
  error: string | null;
  type?: 'learning-journey' | 'docs';
  docsContent?: SingleDocsContent | null;
}

interface CombinedPanelState extends SceneObjectState {
  tabs: LearningJourneyTab[];
  activeTabId: string;
  contextPanel: ContextPanel;
  singleDocsPanel: SingleDocsPanel;
}

class CombinedLearningJourneyPanel extends SceneObjectBase<CombinedPanelState> {
  public static Component = CombinedPanelRenderer;

  public get renderBeforeActivation(): boolean {
    return true;
  }

  public constructor() {
    const singleDocsPanel = new SingleDocsPanel();
    const contextPanel = new ContextPanel((url: string, title: string) => {
      this.openLearningJourney(url, title);
    }, (url: string, title: string) => {
      this.openDocsPage(url, title);
    });

    super({
      tabs: [
        {
          id: 'recommendations',
          title: 'Recommendations',
          baseUrl: '',
          content: null,
          isLoading: false,
          error: null,
        }
      ],
      activeTabId: 'recommendations',
      contextPanel,
      singleDocsPanel,
    });
  }

  private generateTabId(): string {
    return `journey-tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  public async openLearningJourney(url: string, title?: string): Promise<string> {
    const tabId = this.generateTabId();
    const newTab: LearningJourneyTab = {
      id: tabId,
      title: title || 'Loading...',
      baseUrl: url,
      content: null,
      isLoading: false, // Start as not loading - we'll load on demand
      error: null,
    };

    const updatedTabs = [...this.state.tabs, newTab];
    
    this.setState({
      tabs: updatedTabs,
      activeTabId: tabId,
    });

    // Load content immediately when tab is created and activated
    await this.loadTabContent(tabId, url);
    
    return tabId;
  }

  public async loadTabContent(tabId: string, url: string) {
    const tabIndex = this.state.tabs.findIndex(tab => tab.id === tabId);
    if (tabIndex === -1) return;

    // Update tab to loading state
    const updatedTabs = [...this.state.tabs];
    updatedTabs[tabIndex] = {
      ...updatedTabs[tabIndex],
      isLoading: true,
      error: null,
    };
    this.setState({ tabs: updatedTabs });

    try {
      console.log('Loading learning journey content for:', url);
      const journeyContent = await fetchLearningJourneyContent(url);
      
      const finalTabs = [...this.state.tabs];
      const finalTabIndex = finalTabs.findIndex(tab => tab.id === tabId);
      
      if (finalTabIndex !== -1) {
        finalTabs[finalTabIndex] = {
          ...finalTabs[finalTabIndex],
          content: journeyContent,
          title: journeyContent?.title || finalTabs[finalTabIndex].title,
          isLoading: false,
          error: journeyContent ? null : 'Failed to load learning journey',
        };
        this.setState({ tabs: finalTabs });
        console.log('Successfully loaded learning journey:', journeyContent?.title);
      }
    } catch (error) {
      console.error('Failed to load learning journey:', error);
      const errorTabs = [...this.state.tabs];
      const errorTabIndex = errorTabs.findIndex(tab => tab.id === tabId);
      
      if (errorTabIndex !== -1) {
        errorTabs[errorTabIndex] = {
          ...errorTabs[errorTabIndex],
          content: null,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Failed to load learning journey',
        };
        this.setState({ tabs: errorTabs });
      }
    }
  }

  public closeTab(tabId: string) {
    // Don't allow closing the recommendations tab
    if (tabId === 'recommendations') return;

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

    // Clear cache for the specific learning journey so it starts fresh next time
    if (tabToClose && tabToClose.baseUrl) {
      console.log(`Clearing cache for closed journey: ${tabToClose.baseUrl}`);
      clearSpecificJourneyCache(tabToClose.baseUrl);
    }
  }

  public setActiveTab(tabId: string) {
    this.setState({ activeTabId: tabId });
    
    // If switching to a tab that hasn't loaded content yet, load it
    const tab = this.state.tabs.find(t => t.id === tabId);
    if (tab && tabId !== 'recommendations' && !tab.isLoading && !tab.error) {
      if (tab.type === 'docs' && !tab.docsContent) {
        this.loadDocsTabContent(tabId, tab.baseUrl);
      } else if (tab.type !== 'docs' && !tab.content) {
        this.loadTabContent(tabId, tab.baseUrl);
      }
    }
  }

  public async navigateToNextMilestone() {
    const activeTab = this.getActiveTab();
    if (!activeTab?.content || activeTab.id === 'recommendations') return;

    const nextUrl = getNextMilestoneUrl(activeTab.content);
    if (nextUrl) {
      await this.loadTabContent(activeTab.id, nextUrl);
    }
  }

  public async navigateToPreviousMilestone() {
    const activeTab = this.getActiveTab();
    if (!activeTab?.content || activeTab.id === 'recommendations') return;

    const prevUrl = getPreviousMilestoneUrl(activeTab.content);
    if (prevUrl) {
      await this.loadTabContent(activeTab.id, prevUrl);
    }
  }

  public clearCache() {
    clearLearningJourneyCache();
    // Refresh all learning journey tabs (not recommendations)
    this.state.tabs.forEach(tab => {
      if (tab.id !== 'recommendations' && tab.baseUrl) {
        this.loadTabContent(tab.id, tab.baseUrl);
      }
    });
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
    console.log('CombinedLearningJourneyPanel.openDocsPage called with:', { url, title });
    
    const tabId = this.generateTabId();
    const newTab: LearningJourneyTab = {
      id: tabId,
      title: title || 'Loading...',
      baseUrl: url,
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

    // Load docs content immediately when tab is created and activated
    await this.loadDocsTabContent(tabId, url);
    
    return tabId;
  }

  public async loadDocsTabContent(tabId: string, url: string) {
    const tabIndex = this.state.tabs.findIndex(tab => tab.id === tabId);
    if (tabIndex === -1) return;

    // Update tab to loading state
    const updatedTabs = [...this.state.tabs];
    updatedTabs[tabIndex] = {
      ...updatedTabs[tabIndex],
      isLoading: true,
      error: null,
    };
    this.setState({ tabs: updatedTabs });

    try {
      console.log('Loading docs content for:', url);
      const docsContent = await fetchSingleDocsContent(url);
      
      const finalTabs = [...this.state.tabs];
      const finalTabIndex = finalTabs.findIndex(tab => tab.id === tabId);
      
      if (finalTabIndex !== -1) {
        finalTabs[finalTabIndex] = {
          ...finalTabs[finalTabIndex],
          docsContent: docsContent,
          title: docsContent?.title || finalTabs[finalTabIndex].title,
          isLoading: false,
          error: docsContent ? null : 'Failed to load documentation',
        };
        this.setState({ tabs: finalTabs });
        console.log('Successfully loaded docs:', docsContent?.title);
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
  const { tabs, activeTabId, contextPanel, singleDocsPanel } = model.useState();
  const styles = useStyles2(getStyles);
  const contentRef = useRef<HTMLDivElement>(null);
  const activeTab = model.getActiveTab();
  const isRecommendationsTab = activeTabId === 'recommendations';

  // Handle link clicks for "Start Learning Journey" button
  useEffect(() => {
    const handleLinkClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      
      // Handle both button and anchor elements with data-journey-start
      const startElement = target.closest('[data-journey-start="true"]') as HTMLElement;
      
      if (startElement) {
        event.preventDefault();
        event.stopPropagation();
        
        // Navigate to the first milestone
        const activeTab = model.getActiveTab();
        if (activeTab?.content?.milestones && activeTab.content.milestones.length > 0) {
          const firstMilestone = activeTab.content.milestones[0];
          if (firstMilestone.url) {
            console.log('Starting learning journey, navigating to first milestone:', firstMilestone.url);
            model.loadTabContent(activeTab.id, firstMilestone.url);
          }
        } else {
          console.warn('No milestones found to navigate to');
        }
      }
    };

    const contentElement = contentRef.current;
    if (contentElement) {
      contentElement.addEventListener('click', handleLinkClick);
      return () => {
        contentElement.removeEventListener('click', handleLinkClick);
      };
    }
  }, [model, activeTab?.content]);

  // Process tables and add expand/collapse functionality
  useEffect(() => {
    const contentElement = contentRef.current;
    if (!contentElement) return;

    // Handle table expand/collapse functionality
    const expandTableButtons = contentElement.querySelectorAll('.expand-table-btn');
    
    expandTableButtons.forEach((button) => {
      // Skip if button already has event listener
      if (button.hasAttribute('data-table-listener')) return;
      
      const expandWrapper = button.closest('.expand-table-wrapper');
      const tableWrapper = expandWrapper?.querySelector('.responsive-table-wrapper');
      
      if (tableWrapper) {
        // Initially show the table (expanded by default)
        tableWrapper.classList.remove('collapsed');
        button.classList.add('expanded');
        
        const handleClick = (e: Event) => {
          e.preventDefault();
          e.stopPropagation();
          
          const isExpanded = !tableWrapper.classList.contains('collapsed');
          
          if (isExpanded) {
            // Collapse the table
            tableWrapper.classList.add('collapsed');
            button.classList.remove('expanded');
            button.textContent = 'Expand table';
          } else {
            // Expand the table
            tableWrapper.classList.remove('collapsed');
            button.classList.add('expanded');
            button.textContent = 'Collapse table';
          }
        };
        
        button.addEventListener('click', handleClick);
        button.setAttribute('data-table-listener', 'true');
        
        // Set initial button text
        button.textContent = 'Collapse table';
      }
    });
  }, [activeTab?.content]);

  // Process code snippets and add copy buttons
  useEffect(() => {
    const contentElement = contentRef.current;
    if (!contentElement) return;

    // More precise targeting: find actual <pre> elements with code, not nested containers
    const preElements = contentElement.querySelectorAll('pre');
    
    preElements.forEach((preElement, index) => {
      // Skip if this pre element already has our copy button
      if (preElement.parentElement?.querySelector('.code-copy-button')) return;
      
      // Must contain code to be processed
      const codeElement = preElement.querySelector('code') || preElement;
      const codeText = codeElement.textContent || '';
      if (!codeText.trim()) return;
      
      console.log(`Processing pre element ${index + 1}:`, {
        hasCode: !!preElement.querySelector('code'),
        codeLength: codeText.length,
        parentClasses: preElement.parentElement?.className || 'none'
      });
      
      // Remove any remaining copy buttons from the immediate area
      const nearbyButtons = preElement.parentElement?.querySelectorAll('button[title*="copy" i], button[aria-label*="copy" i], .copy-button, .copy-btn, .btn-copy, button[onclick*="copy" i], button[data-copy], button[x-data]') || [];
      nearbyButtons.forEach(btn => {
        console.log('Removing nearby button:', btn.className, btn.textContent?.substring(0, 20));
        btn.remove();
      });
      
      // Create copy button
      const copyButton = document.createElement('button');
      copyButton.className = 'code-copy-button';
      copyButton.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
        <span class="copy-text">Copy</span>
      `;
      copyButton.title = 'Copy code to clipboard';
      
      // Add click handler for copy functionality
      copyButton.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        try {
          await navigator.clipboard.writeText(codeText);
          
          // Update button to show success
          copyButton.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20,6 9,17 4,12"></polyline>
            </svg>
            <span class="copy-text">Copied!</span>
          `;
          copyButton.classList.add('copied');
          
          // Reset after 2 seconds
          setTimeout(() => {
            copyButton.innerHTML = `
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span class="copy-text">Copy</span>
            `;
            copyButton.classList.remove('copied');
          }, 2000);
          
        } catch (err) {
          console.warn('Failed to copy code:', err);
          
          // Fallback for browsers that don't support clipboard API
          const textArea = document.createElement('textarea');
          textArea.value = codeText;
          document.body.appendChild(textArea);
          textArea.select();
          try {
            document.execCommand('copy');
            copyButton.innerHTML = `
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20,6 9,17 4,12"></polyline>
              </svg>
              <span class="copy-text">Copied!</span>
            `;
            copyButton.classList.add('copied');
            
            setTimeout(() => {
              copyButton.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                <span class="copy-text">Copy</span>
              `;
              copyButton.classList.remove('copied');
            }, 2000);
          } catch (fallbackErr) {
            console.error('Fallback copy also failed:', fallbackErr);
          } finally {
            document.body.removeChild(textArea);
          }
        }
      });
      
      // Find the best container to add the button to
      let targetContainer = preElement.parentElement;
      
      // Add button directly to the pre element instead of creating wrappers
      // Ensure the pre element is positioned relatively for button positioning  
      (preElement as HTMLElement).style.position = 'relative';
      preElement.appendChild(copyButton);
      console.log(`Added copy button directly to pre element`);
    });
  }, [activeTab?.content]);

  // Handle keyboard shortcuts for tab navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ctrl/Cmd + W to close current tab (except recommendations)
      if ((event.ctrlKey || event.metaKey) && event.key === 'w') {
        event.preventDefault();
        if (activeTab && activeTab.id !== 'recommendations') {
          model.closeTab(activeTab.id);
        }
      }
      
      // Ctrl/Cmd + Tab to switch between tabs
      if ((event.ctrlKey || event.metaKey) && event.key === 'Tab') {
        event.preventDefault();
        const currentIndex = tabs.findIndex(tab => tab.id === activeTabId);
        const nextIndex = event.shiftKey 
          ? (currentIndex - 1 + tabs.length) % tabs.length
          : (currentIndex + 1) % tabs.length;
        model.setActiveTab(tabs[nextIndex].id);
      }

      // Arrow keys for milestone navigation (only for learning journey tabs)
      if (!isRecommendationsTab) {
        if (event.altKey && event.key === 'ArrowRight') {
          event.preventDefault();
          model.navigateToNextMilestone();
        }
        
        if (event.altKey && event.key === 'ArrowLeft') {
          event.preventDefault();
          model.navigateToPreviousMilestone();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [model, tabs, activeTabId, activeTab, isRecommendationsTab]);

  return (
    <div className={styles.container}>
      <div className={styles.topBar}>
        <div className={styles.title}>
          <div className={styles.titleContent}>
            <div className={styles.appIcon}>
              <Icon name="book" size="lg" />
            </div>
            <div className={styles.titleText}>
              Learning Journeys
            </div>
          </div>
        </div>
        <div className={styles.actions}>
          {!isRecommendationsTab && activeTab && (
            <>
              {activeTab.content?.videoUrl && (
                <IconButton
                  name="play"
                  aria-label="Watch video"
                  onClick={() => {
                    if (activeTab.content?.videoUrl) {
                      window.open(activeTab.content.videoUrl, '_blank', 'noopener,noreferrer');
                    }
                  }}
                  tooltip="Watch video for this page"
                  tooltipPlacement="left"
                  className={styles.videoButton}
                />
              )}
              <IconButton
                name="external-link-alt"
                aria-label="Open original documentation"
                onClick={() => {
                  // For docs tabs, use baseUrl or docsContent.url
                  // For learning journey tabs, use content.url
                  const url = activeTab.type === 'docs' 
                    ? (activeTab.docsContent?.url || activeTab.baseUrl)
                    : activeTab.content?.url;
                  
                  if (url) {
                    window.open(url, '_blank', 'noopener,noreferrer');
                  }
                }}
                tooltip="Open original documentation in new tab"
                tooltipPlacement="left"
              />
            </>
          )}
          <IconButton
            name="trash-alt"
            aria-label="Clear cache"
            onClick={() => model.clearCache()}
            tooltip="Clear learning journey cache"
            tooltipPlacement="left"
          />
        </div>
      </div>

      {/* Tab Bar */}
      <div className={styles.tabBar}>
        <div className={styles.tabList}>
          {tabs.map((tab) => (
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
                      <span style={{ marginLeft: '4px' }}>Loading...</span>
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
          
          // Show docs content
          if (!isRecommendationsTab && activeTab?.type === 'docs' && activeTab?.docsContent && !activeTab.isLoading) {
            return (
              <div className={styles.docsContent}>
                <div className={styles.contentMeta}>
                  <div className={styles.metaInfo}>
                    <span>Documentation</span>
                    {activeTab.docsContent.breadcrumbs && activeTab.docsContent.breadcrumbs.length > 0 && (
                      <span className={styles.breadcrumbs}>
                        {activeTab.docsContent.breadcrumbs.join(' > ')}
                      </span>
                    )}
                  </div>
                  <small>
                    Last updated: {new Date(activeTab.docsContent.lastFetched).toLocaleString()}
                  </small>
                </div>
                
                {activeTab.docsContent.labels && activeTab.docsContent.labels.length > 0 && (
                  <div className={styles.labelsContainer}>
                    {activeTab.docsContent.labels.map((label, index) => (
                      <span key={index} className={styles.label}>
                        {label}
                      </span>
                    ))}
                  </div>
                )}
                
                <div 
                  ref={contentRef}
                  className={styles.docsContentHtml}
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
                        <span>Milestone {activeTab.content.currentMilestone} of {activeTab.content.totalMilestones}</span>
                        <div className={styles.milestoneNavigation}>
                          <IconButton
                            name="arrow-left"
                            size="sm"
                            aria-label="Previous milestone"
                            onClick={() => model.navigateToPreviousMilestone()}
                            tooltip="Previous milestone (Alt + ←)"
                            tooltipPlacement="top"
                            disabled={!model.canNavigatePrevious() || activeTab.isLoading}
                          />
                          <IconButton
                            name="arrow-right"
                            size="sm"
                            aria-label="Next milestone"
                            onClick={() => model.navigateToNextMilestone()}
                            tooltip="Next milestone (Alt + →)"
                            tooltipPlacement="top"
                            disabled={!model.canNavigateNext() || activeTab.isLoading}
                          />
                        </div>
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
                
                <div className={styles.contentMeta}>
                  <small>
                    Last updated: {new Date(activeTab.content.lastFetched).toLocaleString()}
                  </small>
                </div>
                
                <div 
                  ref={contentRef}
                  className={styles.journeyContentHtml}
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

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    label: 'combined-journey-container',
    backgroundColor: theme.colors.background.primary,
    borderRadius: '0',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    border: `1px solid ${theme.colors.border.weak}`,
    borderTop: 'none',
    borderBottom: 'none',
    margin: theme.spacing(-1),
    height: `calc(100% + ${theme.spacing(2)})`,
    width: `calc(100% + ${theme.spacing(2)})`,
  }),
  topBar: css({
    label: 'combined-journey-top-bar',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
    padding: theme.spacing(1),
    backgroundColor: theme.colors.background.canvas,
  }),
  title: css({
    label: 'combined-journey-title',
    flex: 1,
    textOverflow: 'ellipsis',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    fontWeight: theme.typography.fontWeightBold,
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(2),
  }),
  appIcon: css({
    label: 'combined-journey-icon',
    fontSize: '7px',
    color: theme.colors.text.primary,
    letterSpacing: '0.1em',
    opacity: 0.75,
    width: '24px',
    height: '24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }),
  titleContent: css({
    label: 'combined-journey-title-content',
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),
  titleText: css({
    fontSize: theme.typography.h5.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  actions: css({
    label: 'combined-journey-actions',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: theme.spacing(1),
  }),
  content: css({
    label: 'combined-journey-content',
    flex: 1,
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column',
  }),
  loadingContainer: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(2),
    justifyContent: 'center',
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    margin: theme.spacing(2),
  }),
  journeyContent: css({
    backgroundColor: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    overflow: 'hidden',
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
  }),
  milestoneProgress: css({
    padding: theme.spacing(2),
    backgroundColor: theme.colors.background.canvas,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    flexShrink: 0,
  }),
  progressInfo: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  progressBar: css({
    width: '100%',
    height: '4px',
    backgroundColor: theme.colors.background.secondary,
    borderRadius: '2px',
    overflow: 'hidden',
  }),
  progressFill: css({
    height: '100%',
    backgroundColor: theme.colors.success.main,
    transition: 'width 0.3s ease',
  }),
  contentMeta: css({
    padding: theme.spacing(1, 2),
    backgroundColor: theme.colors.background.canvas,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    flexShrink: 0,
  }),
  journeyContentHtml: css({
    padding: theme.spacing(3),
    overflow: 'auto',
    flex: 1,
    lineHeight: 1.6,
    fontSize: theme.typography.body.fontSize,
    
    // Journey-specific styling
    '& .journey-heading': {
      color: theme.colors.text.primary,
      fontWeight: theme.typography.fontWeightMedium,
      marginBottom: theme.spacing(2),
      '&.journey-heading-h1': {
        fontSize: theme.typography.h2.fontSize,
        borderBottom: `2px solid ${theme.colors.border.medium}`,
        paddingBottom: theme.spacing(1),
      },
      '&.journey-heading-h2': {
        fontSize: theme.typography.h3.fontSize,
        marginTop: theme.spacing(3),
      },
      '&.journey-heading-h3': {
        fontSize: theme.typography.h4.fontSize,
        marginTop: theme.spacing(2),
      },
    },
    
    // Enhanced responsive image styling
    '& img': {
      maxWidth: '100%',
      height: 'auto',
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
      margin: `${theme.spacing(2)} auto`,
      display: 'block',
      boxShadow: theme.shadows.z1,
      transition: 'all 0.2s ease',
      
      // Hover effect for better interactivity
      '&:hover': {
        boxShadow: theme.shadows.z2,
        transform: 'scale(1.02)',
        cursor: 'pointer',
      },
      
      // Handle different image sizes appropriately
      '&[src*="screenshot"], &[src*="dashboard"], &[src*="interface"]': {
        // Screenshots and interface images - keep them large but responsive
        maxWidth: '100%',
        minWidth: '300px',
        width: 'auto',
        margin: `${theme.spacing(3)} auto`,
        border: `2px solid ${theme.colors.border.medium}`,
        borderRadius: `${theme.shape.radius.default}px`,
      },
      
      '&[src*="icon"], &[src*="logo"], &[src*="badge"]': {
        // Icons and logos - keep them smaller and inline when appropriate
        maxWidth: '200px',
        maxHeight: '100px',
        margin: `${theme.spacing(1)} auto`,
        display: 'inline-block',
        verticalAlign: 'middle',
      },
      
      '&[src*="diagram"], &[src*="chart"], &[src*="graph"]': {
        // Diagrams and charts - ensure they're readable
        maxWidth: '100%',
        minWidth: '400px',
        margin: `${theme.spacing(3)} auto`,
        backgroundColor: theme.colors.background.primary,
        padding: theme.spacing(1),
      },
    },
    
    // Image containers and figures
    '& figure': {
      margin: `${theme.spacing(3)} 0`,
      textAlign: 'center',
      
      '& img': {
        margin: '0 auto',
      },
      
      '& figcaption': {
        marginTop: theme.spacing(1),
        fontSize: theme.typography.bodySmall.fontSize,
        color: theme.colors.text.secondary,
        fontStyle: 'italic',
        textAlign: 'center',
      },
    },
    
    // Image galleries or multiple images in a row
    '& .image-gallery, & .images-row': {
      display: 'flex',
      flexWrap: 'wrap',
      gap: theme.spacing(2),
      margin: `${theme.spacing(3)} 0`,
      justifyContent: 'center',
      
      '& img': {
        flex: '1 1 300px',
        maxWidth: '400px',
        margin: 0,
      },
    },
    
    // Legacy class support
    '& .journey-image': {
      maxWidth: '100%',
      height: 'auto',
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
      margin: `${theme.spacing(2)} auto`,
      display: 'block',
      boxShadow: theme.shadows.z1,
    },
    
    // Specific image type styling
    '& .journey-screenshot': {
      maxWidth: '100%',
      minWidth: '300px',
      margin: `${theme.spacing(3)} auto`,
      border: `2px solid ${theme.colors.border.medium}`,
      borderRadius: `${theme.shape.radius.default}px`,
      boxShadow: theme.shadows.z2,
    },
    
    '& .journey-icon': {
      maxWidth: '150px',
      maxHeight: '80px',
      margin: `${theme.spacing(1)} ${theme.spacing(2)}`,
      display: 'inline-block',
      verticalAlign: 'middle',
      border: 'none',
      boxShadow: 'none',
    },
    
    '& .journey-diagram': {
      maxWidth: '100%',
      minWidth: '350px',
      margin: `${theme.spacing(3)} auto`,
      backgroundColor: theme.colors.background.primary,
      padding: theme.spacing(2),
      borderRadius: `${theme.shape.radius.default}px`,
    },
    
    '& .journey-large': {
      maxWidth: '100%',
      margin: `${theme.spacing(4)} auto`,
      border: `2px solid ${theme.colors.border.medium}`,
    },
    
    '& .journey-small': {
      maxWidth: '150px',
      margin: `${theme.spacing(1)} auto`,
    },
    
    '& .journey-wide': {
      width: '100%',
      maxWidth: '100%',
      margin: `${theme.spacing(3)} 0`,
    },
    
    // Special handling for inline code
    '& code:not(pre code)': {
      backgroundColor: theme.colors.background.canvas,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: '3px',
      padding: `2px 4px`,
      fontFamily: theme.typography.fontFamilyMonospace,
      fontSize: '0.9em',
      color: theme.colors.text.primary,
      fontWeight: theme.typography.fontWeightMedium,
    },
    
    // Blockquotes and admonitions for learning journeys
    '& blockquote, & .admonition': {
      margin: `${theme.spacing(2)} 0`,
      padding: theme.spacing(2),
      borderLeft: `4px solid ${theme.colors.primary.main}`,
      backgroundColor: theme.colors.background.canvas,
      borderRadius: `0 ${theme.shape.radius.default}px ${theme.shape.radius.default}px 0`,
      fontSize: theme.typography.bodySmall.fontSize, // Smaller font size
      
      '& blockquote': {
        margin: 0,
        padding: 0,
        border: 'none',
        borderRadius: 0,
        backgroundColor: 'transparent',
      },
      
      // Style the title (Note, Warning, etc.)
      '& .title': {
        fontSize: '11px',
        fontWeight: theme.typography.fontWeightBold,
        color: theme.colors.primary.main,
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        marginBottom: theme.spacing(1),
        
        '&:before': {
          content: '"ℹ️ "', // Add an icon before the title
          marginRight: theme.spacing(0.5),
        },
      },
      
      // Style the content paragraphs
      '& p:not(.title)': {
        margin: `${theme.spacing(0.5)} 0`,
        fontSize: theme.typography.bodySmall.fontSize,
        lineHeight: 1.4,
        
        '&:last-child': {
          marginBottom: 0,
        },
      },
    },
    
    // Specific styling for different admonition types in learning journeys
    '& .admonition-note': {
      borderLeftColor: theme.colors.info.main,
      backgroundColor: theme.colors.info.transparent,
      
      '& .title': {
        color: theme.colors.info.main,
        
        '&:before': {
          content: '"ℹ️ "',
        },
      },
    },
    
    '& .admonition-warning': {
      borderLeftColor: theme.colors.warning.main,
      backgroundColor: theme.colors.warning.transparent,
      
      '& .title': {
        color: theme.colors.warning.main,
        
        '&:before': {
          content: '"⚠️ "',
        },
      },
    },
    
    '& .admonition-caution': {
      borderLeftColor: theme.colors.error.main,
      backgroundColor: theme.colors.error.transparent,
      
      '& .title': {
        color: theme.colors.error.main,
        
        '&:before': {
          content: '"⚠️ "',
        },
      },
    },
    
    // Consolidated responsive styles for mobile devices
    '@media (max-width: 768px)': {
      // Image responsive adjustments
      '& img': {
        '&[src*="screenshot"], &[src*="dashboard"], &[src*="interface"]': {
          minWidth: '250px',
          margin: `${theme.spacing(2)} auto`,
        },
        
        '&[src*="diagram"], &[src*="chart"], &[src*="graph"]': {
          minWidth: '280px',
        },
      },
      
      '& .journey-screenshot': {
        minWidth: '250px',
        margin: `${theme.spacing(2)} auto`,
      },
      
      '& .journey-diagram': {
        minWidth: '280px',
        padding: theme.spacing(1),
      },
      
      '& .image-gallery, & .images-row': {
        flexDirection: 'column',
        
        '& img': {
          flex: 'none',
          maxWidth: '100%',
        },
      },
      
      // Table responsive adjustments
      '& .responsive-table-wrapper': {
        fontSize: theme.typography.bodySmall.fontSize,
        
        '& table': {
          minWidth: '500px', // Ensure table doesn't get too cramped
        },
        
        '& th, & td': {
          padding: theme.spacing(1),
        },
      },
      
      '& .expand-table-btn': {
        fontSize: '12px',
        padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
      },
      
      // Code snippet responsive adjustments  
      '& .code-copy-button': {
        padding: `${theme.spacing(0.5)} ${theme.spacing(0.75)}`,
        minWidth: '60px',
        fontSize: '11px',
      },
      
      '& .code-snippet pre, & .code-snippet-container pre, & .code-snippet-wrapper pre': {
        paddingRight: theme.spacing(8),
        fontSize: '13px',
      },
      
      '& pre[class*="language-"]': {
        padding: `${theme.spacing(2)} ${theme.spacing(8)} ${theme.spacing(2)} ${theme.spacing(2)}`,
        fontSize: '13px',
      },
    },
    
    '@media (max-width: 480px)': {
      // Image responsive adjustments
      '& img': {
        '&[src*="screenshot"], &[src*="dashboard"], &[src*="interface"]': {
          minWidth: '200px',
          border: `1px solid ${theme.colors.border.weak}`,
          borderRadius: theme.shape.radius.default,
        },
        
        '&[src*="diagram"], &[src*="chart"], &[src*="graph"]': {
          minWidth: '200px',
          padding: theme.spacing(0.5),
        },
      },
      
      '& .journey-screenshot': {
        minWidth: '200px',
        border: `1px solid ${theme.colors.border.weak}`,
        margin: `${theme.spacing(1)} auto`,
      },
      
      '& .journey-diagram': {
        minWidth: '200px',
        padding: theme.spacing(0.5),
      },
      
      '& .journey-large': {
        margin: `${theme.spacing(2)} auto`,
      },
      
      // Table responsive adjustments for very small screens
      '& .responsive-table-wrapper': {
        '& table': {
          minWidth: '400px',
          fontSize: '12px',
        },
        
        '& th, & td': {
          padding: `${theme.spacing(0.75)} ${theme.spacing(0.5)}`,
          fontSize: '12px',
        },
      },
      
      // Code snippet responsive adjustments
      '& .code-copy-button': {
        padding: theme.spacing(0.5),
        minWidth: '32px',
        top: theme.spacing(0.5),
        right: theme.spacing(0.5),
        
        '& .copy-text': {
          display: 'none', // Hide text, show only icon
        },
      },
      
      '& .code-snippet pre, & .code-snippet-container pre, & .code-snippet-wrapper pre': {
        paddingRight: theme.spacing(6),
        fontSize: '12px',
        padding: `${theme.spacing(1.5)} ${theme.spacing(6)} ${theme.spacing(1.5)} ${theme.spacing(1.5)}`,
      },
      
      '& pre[class*="language-"]': {
        padding: `${theme.spacing(1.5)} ${theme.spacing(6)} ${theme.spacing(1.5)} ${theme.spacing(1.5)}`,
        fontSize: '12px',
      },
      
      // Progress header adjustments
      '& .progress-header': {
        gap: theme.spacing(0.5),
        
        '& > span': {
          fontSize: '12px',
        },
      },
      
      // Milestone navigation adjustments
      '& .milestone-navigation button': {
        minWidth: '32px',
        height: '32px',
      },
    },
    
    '& .journey-code': {
      backgroundColor: theme.colors.background.canvas,
      padding: theme.spacing(1),
      borderRadius: theme.shape.radius.default,
      fontFamily: theme.typography.fontFamilyMonospace,
      fontSize: theme.typography.bodySmall.fontSize,
      border: `1px solid ${theme.colors.border.weak}`,
    },
    
    '& a[data-journey-link="true"]': {
      color: theme.colors.primary.main,
      textDecoration: 'none',
      '&:hover': {
        textDecoration: 'underline',
      },
    },
    
    '& .journey-start-button': {
      display: 'inline-block',
      padding: `${theme.spacing(1.5)} ${theme.spacing(3)}`,
      backgroundColor: theme.colors.primary.main,
      color: theme.colors.primary.contrastText,
      borderRadius: theme.shape.radius.default,
      fontWeight: theme.typography.fontWeightMedium,
      textDecoration: 'none',
      margin: `${theme.spacing(2)} 0`,
      transition: 'all 0.2s ease',
      border: 'none',
      cursor: 'pointer',
      fontSize: theme.typography.body.fontSize,
      '&:hover': {
        backgroundColor: theme.colors.primary.shade,
        textDecoration: 'none',
        transform: 'translateY(-1px)',
        boxShadow: theme.shadows.z2,
      },
    },
    
    '& .journey-start-section': {
      margin: `${theme.spacing(4)} 0`,
      padding: theme.spacing(3),
      backgroundColor: theme.colors.background.canvas,
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
      textAlign: 'center',
    },
    
    '& .journey-start-container h3': {
      margin: `0 0 ${theme.spacing(2)} 0`,
      color: theme.colors.text.primary,
      fontSize: theme.typography.h4.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
    },
    
    '& p': {
      marginBottom: theme.spacing(2),
      lineHeight: 1.7,
    },
    
    '& ul, & ol': {
      marginBottom: theme.spacing(2),
      paddingLeft: theme.spacing(3),
    },
    
    '& li': {
      marginBottom: theme.spacing(1),
    },
    
    // Video link styling
    '& a[data-video-link="true"], & .journey-video-link': {
      display: 'inline-flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
      color: theme.colors.primary.main,
      textDecoration: 'none',
      fontWeight: theme.typography.fontWeightMedium,
      fontSize: theme.typography.body.fontSize,
      padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
      backgroundColor: 'transparent',
      transition: 'all 0.2s ease',
      margin: `${theme.spacing(1)} 0`,
      
      '&:hover': {
        backgroundColor: theme.colors.action.hover,
        borderColor: theme.colors.primary.main,
        textDecoration: 'none',
        transform: 'translateY(-1px)',
      },
      
      '& .journey-video-icon': {
        fontSize: '14px',
        lineHeight: 1,
      },
    },
    
    // YouTube thumbnail styling
    '& .journey-video-thumbnail': {
      display: 'block',
      margin: `${theme.spacing(3)} 0`,
      cursor: 'pointer',
      borderRadius: theme.shape.radius.default,
      overflow: 'hidden',
      boxShadow: theme.shadows.z1,
      transition: 'all 0.3s ease',
      backgroundColor: theme.colors.background.secondary,
      maxWidth: '560px',
      
      '&:hover': {
        boxShadow: theme.shadows.z3,
        transform: 'translateY(-2px)',
      },
    },
    
    '& .video-thumbnail-wrapper': {
      position: 'relative',
      paddingBottom: '56.25%', // 16:9 aspect ratio
      height: 0,
      overflow: 'hidden',
    },
    
    '& .video-thumbnail-image': {
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      transition: 'transform 0.3s ease',
    },
    
    '& .video-play-overlay': {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0, 0, 0, 0.3)',
      transition: 'background 0.3s ease',
    },
    
    '& .video-play-button': {
      width: '68px',
      height: '48px',
      backgroundColor: '#ff0000',
      borderRadius: '6px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'white',
      transition: 'all 0.3s ease',
      
      '& svg': {
        marginLeft: '2px', // Slight offset to center the play triangle
      },
    },
    
    '& .video-thumbnail-title': {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      background: 'linear-gradient(transparent, rgba(0, 0, 0, 0.8))',
      color: 'white',
      padding: `${theme.spacing(2)} ${theme.spacing(1.5)}`,
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      textShadow: '0 1px 2px rgba(0, 0, 0, 0.8)',
    },
    
    '& .journey-video-thumbnail:hover .video-thumbnail-image': {
      transform: 'scale(1.05)',
    },
    
    '& .journey-video-thumbnail:hover .video-play-overlay': {
      background: 'rgba(0, 0, 0, 0.2)',
    },
    
    '& .journey-video-thumbnail:hover .video-play-button': {
      backgroundColor: '#cc0000',
      transform: 'scale(1.1)',
    },
    
    // Clean text links for non-YouTube videos
    '& .journey-video-text-link': {
      display: 'inline-flex',
      alignItems: 'center',
      color: theme.colors.primary.main,
      textDecoration: 'none',
      fontWeight: theme.typography.fontWeightMedium,
      padding: `${theme.spacing(0.5)} 0`,
      
      '&:hover': {
        textDecoration: 'underline',
      },
    },
    
    // Code snippet styling with copy button support
    '& .code-snippet, & .code-snippet-container, & .code-snippet-wrapper': {
      position: 'relative',
      margin: `${theme.spacing(3)} 0`,
      backgroundColor: theme.colors.background.canvas,
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
      overflow: 'hidden',
      boxShadow: theme.shadows.z1,
      
      '& pre': {
        margin: 0,
        padding: theme.spacing(2),
        backgroundColor: 'transparent',
        border: 'none',
        borderRadius: 0,
        overflow: 'auto',
        fontFamily: theme.typography.fontFamilyMonospace,
        fontSize: theme.typography.bodySmall.fontSize,
        lineHeight: 1.5,
        color: theme.colors.text.primary,
        whiteSpace: 'pre',
        wordWrap: 'normal',
        
        '& code': {
          backgroundColor: 'transparent',
          padding: 0,
          border: 'none',
          borderRadius: 0,
          fontFamily: 'inherit',
          fontSize: 'inherit',
          color: 'inherit',
          whiteSpace: 'inherit',
          wordWrap: 'inherit',
        },
      },
      
      // Handle cases where pre is the direct element
      '&.code-snippet-wrapper pre, &.code-snippet pre': {
        backgroundColor: theme.colors.background.canvas,
        border: `1px solid ${theme.colors.border.weak}`,
        borderRadius: theme.shape.radius.default,
      },
    },
    
    // Copy button styling
    '& .code-copy-button': {
      position: 'absolute',
      top: theme.spacing(1),
      right: theme.spacing(1),
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
      padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
      backgroundColor: theme.colors.background.secondary,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      zIndex: 2,
      minWidth: '70px',
      justifyContent: 'center',
      
      '&:hover': {
        backgroundColor: theme.colors.action.hover,
        borderColor: theme.colors.border.medium,
        color: theme.colors.text.primary,
        transform: 'translateY(-1px)',
        boxShadow: theme.shadows.z1,
      },
      
      '&:active': {
        transform: 'translateY(0)',
        boxShadow: 'none',
      },
      
      '&.copied': {
        backgroundColor: theme.colors.success.main,
        borderColor: theme.colors.success.border,
        color: theme.colors.success.contrastText,
        
        '&:hover': {
          backgroundColor: theme.colors.success.main,
          borderColor: theme.colors.success.border,
          color: theme.colors.success.contrastText,
        },
      },
      
      '& svg': {
        flexShrink: 0,
        width: '16px',
        height: '16px',
      },
      
      '& .copy-text': {
        whiteSpace: 'nowrap',
        fontSize: '12px',
      },
    },
    
    // Code block enhancements for readability
    '& .code-snippet pre, & .code-snippet-container pre, & .code-snippet-wrapper pre': {
      // Add some visual enhancements
      position: 'relative',
      
      // Add subtle background pattern for code
      backgroundImage: `linear-gradient(90deg, transparent 79px, ${theme.colors.border.weak} 81px)`,
      backgroundSize: '81px 1.2em',
      backgroundAttachment: 'local',
      
      // Ensure proper spacing for copy button
      paddingRight: theme.spacing(10), // Make room for copy button
      
      // Custom scrollbar
      '&::-webkit-scrollbar': {
        height: '8px',
        width: '8px',
      },
      
      '&::-webkit-scrollbar-track': {
        backgroundColor: theme.colors.background.secondary,
        borderRadius: theme.shape.radius.default,
      },
      
      '&::-webkit-scrollbar-thumb': {
        backgroundColor: theme.colors.border.medium,
        borderRadius: theme.shape.radius.default,
        border: `2px solid ${theme.colors.background.secondary}`,
        
        '&:hover': {
          backgroundColor: theme.colors.border.strong,
        },
      },
    },
    
    // Table styling for learning journey content
    '& .expand-table-wrapper': {
      margin: `${theme.spacing(3)} 0`,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      overflow: 'hidden',
      backgroundColor: theme.colors.background.secondary,
    },
    
    '& .button-div': {
      padding: theme.spacing(1),
      backgroundColor: theme.colors.background.canvas,
      borderBottom: `1px solid ${theme.colors.border.weak}`,
    },
    
    '& .expand-table-btn': {
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
      padding: `${theme.spacing(0.75)} ${theme.spacing(1.5)}`,
      backgroundColor: 'transparent',
      border: `1px solid ${theme.colors.border.medium}`,
      borderRadius: theme.shape.radius.default,
      color: theme.colors.text.primary,
      cursor: 'pointer',
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      transition: 'all 0.2s ease',
      
      '&:hover': {
        backgroundColor: theme.colors.action.hover,
        borderColor: theme.colors.border.strong,
      },
      
      '&:after': {
        content: '"↓"',
        fontSize: '12px',
        marginLeft: theme.spacing(0.5),
        transition: 'transform 0.2s ease',
      },
      
      '&.expanded:after': {
        transform: 'rotate(180deg)',
      },
    },
    
    '& .responsive-table-wrapper': {
      overflow: 'auto',
      maxHeight: '300px',
      transition: 'max-height 0.3s ease',
      
      '&.collapsed': {
        maxHeight: '0',
        overflow: 'hidden',
      },
      
      // Custom scrollbar for table
      '&::-webkit-scrollbar': {
        width: '8px',
        height: '8px',
      },
      
      '&::-webkit-scrollbar-track': {
        backgroundColor: theme.colors.background.secondary,
      },
      
      '&::-webkit-scrollbar-thumb': {
        backgroundColor: theme.colors.border.medium,
        borderRadius: '4px',
        
        '&:hover': {
          backgroundColor: theme.colors.border.strong,
        },
      },
    },
    
    '& table': {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: theme.typography.body.fontSize,
      lineHeight: 1.5,
      
      '& thead': {
        backgroundColor: theme.colors.background.canvas,
        borderBottom: `2px solid ${theme.colors.border.medium}`,
        
        '& th': {
          padding: theme.spacing(1.5),
          textAlign: 'left',
          fontWeight: theme.typography.fontWeightBold,
          color: theme.colors.text.primary,
          fontSize: theme.typography.body.fontSize,
          borderRight: `1px solid ${theme.colors.border.weak}`,
          
          '&:last-child': {
            borderRight: 'none',
          },
        },
      },
      
      '& tbody': {
        '& tr': {
          borderBottom: `1px solid ${theme.colors.border.weak}`,
          transition: 'background-color 0.2s ease',
          
          '&:hover': {
            backgroundColor: theme.colors.action.hover,
          },
          
          '&:last-child': {
            borderBottom: 'none',
          },
        },
        
        '& td': {
          padding: theme.spacing(1.5),
          verticalAlign: 'top',
          borderRight: `1px solid ${theme.colors.border.weak}`,
          color: theme.colors.text.primary,
          
          '&:last-child': {
            borderRight: 'none',
          },
          
          // Support for nested content in table cells
          '& p': {
            margin: `${theme.spacing(0.5)} 0`,
            
            '&:first-child': {
              marginTop: 0,
            },
            
            '&:last-child': {
              marginBottom: 0,
            },
          },
          
          '& ol, & ul': {
            margin: `${theme.spacing(0.5)} 0`,
            paddingLeft: theme.spacing(2.5),
            
            '& li': {
              margin: `${theme.spacing(0.5)} 0`,
              lineHeight: 1.4,
              
              '& p': {
                margin: `${theme.spacing(0.25)} 0`,
              },
            },
          },
          
          '& code': {
            backgroundColor: theme.colors.background.canvas,
            border: `1px solid ${theme.colors.border.weak}`,
            borderRadius: '2px',
            padding: '2px 4px',
            fontSize: '0.9em',
            fontFamily: theme.typography.fontFamilyMonospace,
          },
          
          '& b, & strong': {
            fontWeight: theme.typography.fontWeightBold,
            color: theme.colors.text.primary,
          },
          
          '& em, & i': {
            fontStyle: 'italic',
          },
          
          // Handle buttons and interactive elements in table cells
          '& button': {
            backgroundColor: theme.colors.primary.main,
            color: theme.colors.primary.contrastText,
            border: 'none',
            borderRadius: theme.shape.radius.default,
            padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
            fontSize: theme.typography.bodySmall.fontSize,
            fontWeight: theme.typography.fontWeightMedium,
            cursor: 'pointer',
            
            '&:hover': {
              backgroundColor: theme.colors.primary.shade,
            },
          },
        },
      },
    },
    


    // Handle various code snippet structures from Grafana docs
    '& .code-snippet__border': {
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      overflow: 'hidden',
      position: 'relative',
      margin: `${theme.spacing(2)} 0`,
      
      '& pre': {
        margin: 0,
        border: 'none',
        borderRadius: 0,
      },
    },
    
    // Ensure proper styling for language-specific code blocks
    '& pre[class*="language-"]': {
      position: 'relative',
      backgroundColor: theme.colors.background.canvas,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      margin: `${theme.spacing(2)} 0`,
      padding: `${theme.spacing(2)} ${theme.spacing(10)} ${theme.spacing(2)} ${theme.spacing(2)}`,
      
      '&:before': {
        content: 'attr(class)',
        position: 'absolute',
        top: theme.spacing(0.5),
        left: theme.spacing(1),
        fontSize: '10px',
        color: theme.colors.text.secondary,
        opacity: 0.7,
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        fontWeight: theme.typography.fontWeightMedium,
        pointerEvents: 'none',
      },
    },
  }),
  tabBar: css({
    label: 'combined-journey-tab-bar',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing(0.5, 1),
    backgroundColor: theme.colors.background.canvas,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    overflow: 'hidden',
  }),
  tabList: css({
    label: 'combined-journey-tab-list',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    overflow: 'auto',
    flex: 1,
    '&::-webkit-scrollbar': {
      height: '4px',
    },
    '&::-webkit-scrollbar-track': {
      background: 'transparent',
    },
    '&::-webkit-scrollbar-thumb': {
      background: theme.colors.border.medium,
      borderRadius: '2px',
    },
  }),
  tab: css({
    label: 'combined-journey-tab',
    display: 'flex',
    alignItems: 'center',
    padding: theme.spacing(0.75, 1.5),
    cursor: 'pointer',
    backgroundColor: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderBottom: 'none',
    borderRadius: `${theme.shape.radius.default}px ${theme.shape.radius.default}px 0 0`,
    minWidth: '120px',
    maxWidth: '200px',
    position: 'relative',
    transition: 'all 0.2s ease',
    '&:hover': {
      backgroundColor: theme.colors.action.hover,
      borderColor: theme.colors.border.medium,
    },
    '&:not(:first-child)': {
      marginLeft: '-1px',
    },
  }),
  activeTab: css({
    label: 'combined-journey-active-tab',
    backgroundColor: theme.colors.background.primary,
    borderColor: theme.colors.border.medium,
    borderBottomColor: theme.colors.background.primary,
    zIndex: 1,
    '&:hover': {
      backgroundColor: theme.colors.background.primary,
    },
  }),
  tabContent: css({
    label: 'combined-journey-tab-content',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(1),
    width: '100%',
    minWidth: 0,
  }),
  tabIcon: css({
    label: 'combined-journey-tab-icon',
    color: theme.colors.text.secondary,
    flexShrink: 0,
  }),
  tabTitle: css({
    label: 'combined-journey-tab-title',
    textOverflow: 'ellipsis',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    flex: 1,
    minWidth: 0,
  }),
  closeButton: css({
    label: 'combined-journey-close-button',
    padding: theme.spacing(0.25),
    margin: 0,
    minWidth: 'auto',
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    flexShrink: 0,
    '&:hover': {
      backgroundColor: theme.colors.action.hover,
    },
  }),
  progressHeader: css({
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
    
    // Ensure text doesn't wrap awkwardly
    '& > span': {
      whiteSpace: 'nowrap',
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
    },
  }),
  milestoneNavigation: css({
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(1),
    
    // Add some visual styling for the navigation buttons
    '& button': {
      backgroundColor: theme.colors.background.secondary,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      transition: 'all 0.2s ease',
      
      '&:hover:not(:disabled)': {
        backgroundColor: theme.colors.action.hover,
        borderColor: theme.colors.border.medium,
        transform: 'translateY(-1px)',
      },
      
      '&:disabled': {
        opacity: 0.5,
        cursor: 'not-allowed',
      },
    },
  }),
  videoButton: css({
    label: 'combined-journey-video-button',
    padding: theme.spacing(0.25),
    margin: 0,
    minWidth: 'auto',
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    flexShrink: 0,
    '&:hover': {
      backgroundColor: theme.colors.action.hover,
    },
  }),
  docsPanel: css({
    label: 'single-docs-panel-wrapper',
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  }),
  docsContent: css({
    backgroundColor: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    overflow: 'hidden',
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
  }),
  metaInfo: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  breadcrumbs: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    fontStyle: 'italic',
  }),
  labelsContainer: css({
    padding: theme.spacing(1, 2),
    backgroundColor: theme.colors.background.canvas,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(0.5),
    flexShrink: 0,
  }),
  label: css({
    padding: `${theme.spacing(0.25)} ${theme.spacing(0.75)}`,
    backgroundColor: theme.colors.secondary.main,
    color: theme.colors.secondary.contrastText,
    borderRadius: theme.shape.radius.default,
    fontSize: '11px',
    fontWeight: theme.typography.fontWeightMedium,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  }),
  docsContentHtml: css({
    padding: theme.spacing(3),
    overflow: 'auto',
    flex: 1,
    lineHeight: 1.6,
    fontSize: theme.typography.body.fontSize,
    
    // Docs-specific styling - similar to journey content but optimized for docs
    '& h1, & h2, & h3, & h4, & h5, & h6': {
      color: theme.colors.text.primary,
      fontWeight: theme.typography.fontWeightMedium,
      marginBottom: theme.spacing(1.5),
      marginTop: theme.spacing(2.5),
      lineHeight: 1.3,
      
      '&:first-child': {
        marginTop: 0,
      },
    },
    
    '& h1': {
      fontSize: theme.typography.h2.fontSize,
      borderBottom: `2px solid ${theme.colors.border.medium}`,
      paddingBottom: theme.spacing(1),
      marginBottom: theme.spacing(3),
    },
    
    '& h2': {
      fontSize: theme.typography.h3.fontSize,
    },
    
    '& h3': {
      fontSize: theme.typography.h4.fontSize,
    },
    
    '& p': {
      marginBottom: theme.spacing(2),
      lineHeight: 1.7,
    },
    
    '& ul, & ol': {
      marginBottom: theme.spacing(2),
      paddingLeft: theme.spacing(3),
    },
    
    '& li': {
      marginBottom: theme.spacing(1),
    },
    
    // Enhanced image styling for docs
    '& img': {
      maxWidth: '100%',
      height: 'auto',
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
      margin: `${theme.spacing(2)} auto`,
      display: 'block',
      boxShadow: theme.shadows.z1,
    },
    
    // Code styling for docs
    '& code:not(pre code)': {
      backgroundColor: theme.colors.background.canvas,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: '3px',
      padding: `2px 4px`,
      fontFamily: theme.typography.fontFamilyMonospace,
      fontSize: '0.9em',
      color: theme.colors.text.primary,
      fontWeight: theme.typography.fontWeightMedium,
    },
    
    // Pre/code blocks
    '& pre': {
      backgroundColor: theme.colors.background.canvas,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      padding: theme.spacing(2),
      margin: `${theme.spacing(2)} 0`,
      overflow: 'auto',
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: 1.5,
    },
    
    // Links
    '& a': {
      color: theme.colors.primary.main,
      textDecoration: 'none',
      '&:hover': {
        textDecoration: 'underline',
      },
    },
    
    // Tables
    '& table': {
      width: '100%',
      borderCollapse: 'collapse',
      margin: `${theme.spacing(2)} 0`,
      
      '& th, & td': {
        padding: theme.spacing(1),
        border: `1px solid ${theme.colors.border.weak}`,
        textAlign: 'left',
      },
      
      '& th': {
        backgroundColor: theme.colors.background.canvas,
        fontWeight: theme.typography.fontWeightBold,
      },
    },
    
    // Blockquotes and admonitions
    '& blockquote, & .admonition': {
      margin: `${theme.spacing(2)} 0`,
      padding: theme.spacing(2),
      borderLeft: `4px solid ${theme.colors.primary.main}`,
      backgroundColor: theme.colors.background.canvas,
      borderRadius: `0 ${theme.shape.radius.default}px ${theme.shape.radius.default}px 0`,
      fontSize: theme.typography.bodySmall.fontSize, // Smaller font size
      
      '& blockquote': {
        margin: 0,
        padding: 0,
        border: 'none',
        borderRadius: 0,
        backgroundColor: 'transparent',
      },
      
      // Style the title (Note, Warning, etc.)
      '& .title': {
        fontSize: '11px',
        fontWeight: theme.typography.fontWeightBold,
        color: theme.colors.primary.main,
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        marginBottom: theme.spacing(1),
        
        '&:before': {
          content: '"ℹ️ "', // Add an icon before the title
          marginRight: theme.spacing(0.5),
        },
      },
      
      // Style the content paragraphs
      '& p:not(.title)': {
        margin: `${theme.spacing(0.5)} 0`,
        fontSize: theme.typography.bodySmall.fontSize,
        lineHeight: 1.4,
        
        '&:last-child': {
          marginBottom: 0,
        },
      },
    },
    
    // Specific styling for different admonition types
    '& .admonition-note': {
      borderLeftColor: theme.colors.info.main,
      backgroundColor: theme.colors.info.transparent,
      
      '& .title': {
        color: theme.colors.info.main,
        
        '&:before': {
          content: '"ℹ️ "',
        },
      },
    },
    
    '& .admonition-warning': {
      borderLeftColor: theme.colors.warning.main,
      backgroundColor: theme.colors.warning.transparent,
      
      '& .title': {
        color: theme.colors.warning.main,
        
        '&:before': {
          content: '"⚠️ "',
        },
      },
    },
    
    '& .admonition-caution': {
      borderLeftColor: theme.colors.error.main,
      backgroundColor: theme.colors.error.transparent,
      
      '& .title': {
        color: theme.colors.error.main,
        
        '&:before': {
          content: '"⚠️ "',
        },
      },
    },
  }),
});

// Export the main component and keep backward compatibility
export { CombinedLearningJourneyPanel };
export class LearningJourneyPanel extends CombinedLearningJourneyPanel {}
export class DocsPanel extends CombinedLearningJourneyPanel {}
