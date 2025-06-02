import { css } from '@emotion/css';
import React, { useEffect, useRef } from 'react';

import { GrafanaTheme2 } from '@grafana/data';
import { SceneComponentProps, SceneObjectBase, SceneObjectState } from '@grafana/scenes';
import { Icon, IconButton, useStyles2, Spinner, Alert } from '@grafana/ui';
import { locationService } from '@grafana/runtime';
import { 
  fetchLearningJourneyContent, 
  LearningJourneyContent,
  getNextMilestoneUrl,
  getPreviousMilestoneUrl,
  clearLearningJourneyCache 
} from '../../utils/docs-fetcher';
import { ContextPanel } from './context-panel';

interface LearningJourneyTab {
  id: string;
  title: string;
  baseUrl: string;
  content: LearningJourneyContent | null;
  isLoading: boolean;
  error: string | null;
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
  }

  public setActiveTab(tabId: string) {
    this.setState({ activeTabId: tabId });
    
    // If switching to a learning journey tab that hasn't loaded content yet, load it
    const tab = this.state.tabs.find(t => t.id === tabId);
    if (tab && tabId !== 'recommendations' && !tab.content && !tab.isLoading && !tab.error) {
      this.loadTabContent(tabId, tab.baseUrl);
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
}

function CombinedPanelRenderer({ model }: SceneComponentProps<CombinedLearningJourneyPanel>) {
  const { tabs, activeTabId, contextPanel } = model.useState();
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
              <IconButton
                name="arrow-left"
                aria-label="Previous milestone"
                onClick={() => model.navigateToPreviousMilestone()}
                tooltip="Previous milestone (Alt + ←)"
                tooltipPlacement="left"
                disabled={!model.canNavigatePrevious() || activeTab.isLoading}
              />
              <IconButton
                name="arrow-right"
                aria-label="Next milestone"
                onClick={() => model.navigateToNextMilestone()}
                tooltip="Next milestone (Alt + →)"
                tooltipPlacement="left"
                disabled={!model.canNavigateNext() || activeTab.isLoading}
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
        {isRecommendationsTab && (
          <contextPanel.Component model={contextPanel} />
        )}

        {!isRecommendationsTab && activeTab?.isLoading && (
          <div className={styles.loadingContainer}>
            <Spinner size="lg" />
            <span>Loading learning journey...</span>
          </div>
        )}
        
        {!isRecommendationsTab && activeTab?.error && !activeTab.isLoading && (
          <Alert severity="error" title="Learning Journey">
            {activeTab.error}
          </Alert>
        )}
        
        {!isRecommendationsTab && activeTab?.content && !activeTab.isLoading && (
          <div className={styles.journeyContent}>
            {/* Milestone Progress - only show for milestone pages (currentMilestone > 0) */}
            {activeTab.content.currentMilestone > 0 && activeTab.content.milestones.length > 0 && (
              <div className={styles.milestoneProgress}>
                <div className={styles.progressInfo}>
                  <span>Milestone {activeTab.content.currentMilestone} of {activeTab.content.totalMilestones}</span>
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
        )}
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
    
    '& .journey-image': {
      maxWidth: '100%',
      height: 'auto',
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
      margin: `${theme.spacing(2)} 0`,
      display: 'block',
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
});

// Export the main component and keep backward compatibility
export { CombinedLearningJourneyPanel };
export class LearningJourneyPanel extends CombinedLearningJourneyPanel {}
export class DocsPanel extends CombinedLearningJourneyPanel {}
