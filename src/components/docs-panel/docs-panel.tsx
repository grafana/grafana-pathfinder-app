import React, { useEffect, useRef } from 'react';
import { css } from '@emotion/css';

import { GrafanaTheme2 } from '@grafana/data';
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
  clearSpecificJourneyContentCache
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
}

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
    });
  }

  private generateTabId(): string {
    return `journey-tab-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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
      console.log('🔧 About to call fetchLearningJourneyContent with URL:', url);
      const journeyContent = await fetchLearningJourneyContent(url);
      
      const finalTabs = [...this.state.tabs];
      const finalTabIndex = finalTabs.findIndex(tab => tab.id === tabId);
      
      if (finalTabIndex !== -1) {
        // Only update title if it's still "Loading..." (preserve original journey title)
        const shouldUpdateTitle = finalTabs[finalTabIndex].title === 'Loading...';
        
        finalTabs[finalTabIndex] = {
          ...finalTabs[finalTabIndex],
          content: journeyContent,
          title: shouldUpdateTitle ? (journeyContent?.title || finalTabs[finalTabIndex].title) : finalTabs[finalTabIndex].title,
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

    // Clear content cache for the specific journey but preserve milestone cache
    // Milestone cache is needed for URL-to-milestone matching when reopening tabs
    if (tabToClose && tabToClose.baseUrl) {
      console.log(`Clearing content cache for closed journey: ${tabToClose.baseUrl}`);
      clearSpecificJourneyContentCache(tabToClose.baseUrl);
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
    console.log('📄 CombinedLearningJourneyPanel.openDocsPage called with:', { url, title });
    console.log('📄 URL type:', typeof url, 'URL value:', url);
    
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
    console.log('📄 loadDocsTabContent called with:', { tabId, url });
    
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
      console.log('📄 About to call fetchSingleDocsContent with URL:', url);
      const docsContent = await fetchSingleDocsContent(url);
      
      const finalTabs = [...this.state.tabs];
      const finalTabIndex = finalTabs.findIndex(tab => tab.id === tabId);
      
      if (finalTabIndex !== -1) {
        // Only update title if it's still "Loading..." (preserve original title)
        const shouldUpdateTitle = finalTabs[finalTabIndex].title === 'Loading...';
        
        finalTabs[finalTabIndex] = {
          ...finalTabs[finalTabIndex],
          docsContent: docsContent,
          title: shouldUpdateTitle ? (docsContent?.title || finalTabs[finalTabIndex].title) : finalTabs[finalTabIndex].title,
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
  const { tabs, activeTabId, contextPanel } = model.useState();
  const styles = useStyles2(getStyles);
  const theme = useTheme2();
  const contentRef = useRef<HTMLDivElement>(null);
  const activeTab = model.getActiveTab();
  const isRecommendationsTab = activeTabId === TAB_CONFIG.RECOMMENDATIONS_ID;

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

  // Use custom hooks for cleaner organization
  useInteractiveElements();
  
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
      console.log('🔗 Click event detected on:', e.target);
      const target = e.target as HTMLElement;
      const link = target.closest('a') as HTMLAnchorElement;
      
      if (link) {
        console.log('🔗 Found link element:', link);
        console.log('🔗 Link href:', link.getAttribute('href'));
        console.log('🔗 Link attributes:', Array.from(link.attributes).map(a => `${a.name}="${a.value}"`));
        
        const hasInternalAttribute = link.hasAttribute('data-docs-internal-link');
        console.log('🔗 Has data-docs-internal-link attribute:', hasInternalAttribute);
        
        if (hasInternalAttribute) {
          console.log('🔗 Intercepting internal docs link!');
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          
          const href = link.getAttribute('href');
          if (href) {
            console.log('🔗 Intercepted docs link click:', href);
            
            // Extract title from link text or use default
            const title = link.textContent?.trim() || 'Documentation';
            
            // Make sure we have a valid docs URL
            let finalUrl = href;
            
            // If it's a relative URL starting with /docs/, make it absolute
            if (href.startsWith('/docs/')) {
              finalUrl = `https://grafana.com${href}`;
              console.log('🔗 Converted relative URL to absolute:', finalUrl);
            }
            
            // Determine if it's a learning journey or regular docs page
            const isLearningJourney = finalUrl.includes('/learning-journeys/');
            
            console.log('🔗 Final URL to open in app tab:', finalUrl);
            console.log('🔗 Is learning journey:', isLearningJourney);
            console.log('🔗 Title:', title);
            
            if (isLearningJourney) {
              model.openLearningJourney(finalUrl, title);
            } else {
              model.openDocsPage(finalUrl, title);
            }
          }
        } else {
          console.log('🔗 Link does not have data-docs-internal-link attribute, allowing default behavior');
        }
      } else {
        console.log('🔗 No link element found in click target');
      }
    };

    // Add event listener for docs internal links - use capture phase to intercept early
    contentElement.addEventListener('click', handleDocsLinkClick, true);

    console.log('🔗 Added click listener to content element');

    // Cleanup
    return () => {
      contentElement.removeEventListener('click', handleDocsLinkClick, true);
      console.log('🔗 Removed click listener from content element');
    };
  }, [activeTab, model]);

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
      console.log(`🎯 Attempting to scroll to anchor: #${hashFragment}`);
      
      // Small delay to ensure content is fully rendered
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
          console.log(`✅ Found anchor element:`, targetElement);
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
              console.log(`🔍 Found fallback anchor element:`, element);
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
          {!isRecommendationsTab && activeTab && (
            <>
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
                  </div>
                  <small>
                    Last updated: {new Date(activeTab.docsContent.lastFetched).toLocaleString()}
                  </small>
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
                <div 
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
