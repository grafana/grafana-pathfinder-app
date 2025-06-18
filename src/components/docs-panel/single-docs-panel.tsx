import { css } from '@emotion/css';
import React, { useEffect, useRef } from 'react';

import { GrafanaTheme2 } from '@grafana/data';
import { SceneComponentProps, SceneObjectBase, SceneObjectState } from '@grafana/scenes';
import { Icon, IconButton, useStyles2, Spinner, Alert } from '@grafana/ui';
import { 
  fetchSingleDocsContent, 
  SingleDocsContent,
  clearSpecificDocsCache
} from '../../utils/single-docs-fetcher';

interface SingleDocsTab {
  id: string;
  title: string;
  url: string;
  content: SingleDocsContent | null;
  isLoading: boolean;
  error: string | null;
}

interface SingleDocsPanelState extends SceneObjectState {
  tabs: SingleDocsTab[];
  activeTabId: string;
}

export class SingleDocsPanel extends SceneObjectBase<SingleDocsPanelState> {
  public static Component = SingleDocsPanelRenderer;

  public get renderBeforeActivation(): boolean {
    return true;
  }

  public constructor() {
    super({
      tabs: [],
      activeTabId: '',
    });
  }

  private generateTabId(): string {
    return `docs-tab-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  public async openDocsPage(url: string, title?: string): Promise<string> {
    console.log('SingleDocsPanel.openDocsPage called with:', { url, title, currentTabsCount: this.state.tabs.length });
    const tabId = this.generateTabId();
    const newTab: SingleDocsTab = {
      id: tabId,
      title: title || 'Loading...',
      url,
      content: null,
      isLoading: false, // Start as not loading - we'll load on demand
      error: null,
    };

    const updatedTabs = [...this.state.tabs, newTab];
    console.log('SingleDocsPanel: Creating new tab, total tabs will be:', updatedTabs.length);
    
    this.setState({
      tabs: updatedTabs,
      activeTabId: tabId,
    });

    console.log('SingleDocsPanel: State updated, hasAnyTabs:', this.hasAnyTabs());

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
      console.log('Loading docs content for:', url);
      const docsContent = await fetchSingleDocsContent(url);
      
      const finalTabs = [...this.state.tabs];
      const finalTabIndex = finalTabs.findIndex(tab => tab.id === tabId);
      
      if (finalTabIndex !== -1) {
        finalTabs[finalTabIndex] = {
          ...finalTabs[finalTabIndex],
          content: docsContent,
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
          content: null,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Failed to load documentation',
        };
        this.setState({ tabs: errorTabs });
      }
    }
  }

  public closeTab(tabId: string) {
    // Get the tab before removing it so we can clear its cache
    const tabToClose = this.state.tabs.find(tab => tab.id === tabId);

    const updatedTabs = this.state.tabs.filter(tab => tab.id !== tabId);
    
    // If we're closing the active tab, switch to another tab or clear active
    let newActiveTabId = this.state.activeTabId;
    if (this.state.activeTabId === tabId) {
      newActiveTabId = updatedTabs.length > 0 ? updatedTabs[updatedTabs.length - 1].id : '';
    }

    this.setState({
      tabs: updatedTabs,
      activeTabId: newActiveTabId,
    });

    // Clear cache for the specific docs page
    if (tabToClose && tabToClose.url) {
      console.log(`Clearing cache for closed docs page: ${tabToClose.url}`);
      clearSpecificDocsCache(tabToClose.url);
    }
  }

  public setActiveTab(tabId: string) {
    this.setState({ activeTabId: tabId });
    
    // If switching to a docs tab that hasn't loaded content yet, load it
    const tab = this.state.tabs.find(t => t.id === tabId);
    if (tab && !tab.content && !tab.isLoading && !tab.error) {
      this.loadTabContent(tabId, tab.url);
    }
  }

  public getActiveTab(): SingleDocsTab | null {
    return this.state.tabs.find(tab => tab.id === this.state.activeTabId) || null;
  }

  public hasAnyTabs(): boolean {
    return this.state.tabs.length > 0;
  }
}

function SingleDocsPanelRenderer({ model }: SceneComponentProps<SingleDocsPanel>) {
  const { tabs, activeTabId } = model.useState();
  const styles = useStyles2(getStyles);
  const contentRef = useRef<HTMLDivElement>(null);
  const activeTab = model.getActiveTab();

  // Process code snippets and add copy buttons
  useEffect(() => {
    const contentElement = contentRef.current;
    if (!contentElement) {return;}

    // Find all <pre> elements with code for copy functionality
    const preElements = contentElement.querySelectorAll('pre.docs-code-snippet');
    
    preElements.forEach((preElement, index) => {
      // Skip if this pre element already has our copy button
      if (preElement.parentElement?.querySelector('.docs-copy-button')) {return;}
      
      const codeElement = preElement.querySelector('code') || preElement;
      const codeText = codeElement.textContent || '';
      if (!codeText.trim()) {return;}
      
      console.log(`Processing docs pre element ${index + 1}:`, {
        hasCode: !!preElement.querySelector('code'),
        codeLength: codeText.length,
      });
      
      // Create copy button
      const copyButton = document.createElement('button');
      copyButton.className = 'docs-copy-button';
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
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span class="copy-text">Copy</span>
            `;
            copyButton.classList.remove('copied');
          }, 2000);
          
        } catch (err) {
          console.warn('Failed to copy docs code:', err);
        }
      });
      
      // Add button to the pre element
      (preElement as HTMLElement).style.position = 'relative';
      preElement.appendChild(copyButton);
      console.log(`Added copy button to docs pre element`);
    });
  }, [activeTab?.content]);

  // Handle keyboard shortcuts for tab navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (tabs.length === 0) {return;}

      // Ctrl/Cmd + W to close current tab
      if ((event.ctrlKey || event.metaKey) && event.key === 'w') {
        event.preventDefault();
        if (activeTab) {
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
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [model, tabs, activeTabId, activeTab]);

  // Don't render if no tabs
  if (!model.hasAnyTabs()) {
    return null;
  }

  return (
    <div className={styles.container}>
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
                <Icon name="file-alt" size="xs" className={styles.tabIcon} />
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
                <IconButton
                  name="times"
                  size="sm"
                  aria-label="Close docs tab"
                  onClick={(e) => {
                    e.stopPropagation();
                    model.closeTab(tab.id);
                  }}
                  className={styles.closeButton}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.content}>
        {activeTab?.isLoading && (
          <div className={styles.loadingContainer}>
            <Spinner size="lg" />
            <span>Loading documentation...</span>
          </div>
        )}
        
        {activeTab?.error && !activeTab.isLoading && (
          <Alert severity="error" title="Documentation">
            {activeTab.error}
          </Alert>
        )}
        
        {activeTab?.content && !activeTab.isLoading && (
          <div className={styles.docsContent}>
            <div className={styles.contentMeta}>
              <div className={styles.metaInfo}>
                <span>Documentation</span>
                {activeTab.content.breadcrumbs && activeTab.content.breadcrumbs.length > 0 && (
                  <span className={styles.breadcrumbs}>
                    {activeTab.content.breadcrumbs.join(' > ')}
                  </span>
                )}
              </div>
              <small>
                Last updated: {new Date(activeTab.content.lastFetched).toLocaleString()}
              </small>
            </div>
            
            {activeTab.content.labels && activeTab.content.labels.length > 0 && (
              <div className={styles.labelsContainer}>
                {activeTab.content.labels.map((label, index) => (
                  <span key={index} className={styles.label}>
                    {label}
                  </span>
                ))}
              </div>
            )}
            
            <div 
              ref={contentRef}
              className={styles.docsContentHtml}
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
    label: 'single-docs-container',
    backgroundColor: theme.colors.background.primary,
    borderRadius: '0',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    border: `1px solid ${theme.colors.border.weak}`,
    borderTop: 'none',
    borderBottom: 'none',
    height: '100%',
    width: '100%',
  }),
  tabBar: css({
    label: 'single-docs-tab-bar',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing(0.5, 1),
    backgroundColor: theme.colors.background.canvas,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    overflow: 'hidden',
  }),
  tabList: css({
    label: 'single-docs-tab-list',
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
    label: 'single-docs-tab',
    display: 'flex',
    alignItems: 'center',
    padding: theme.spacing(0.75, 1.5),
    cursor: 'pointer',
    backgroundColor: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderBottom: 'none',
    borderRadius: `${theme.shape.radius.default}px ${theme.shape.radius.default}px 0 0`,
    minWidth: '140px',
    maxWidth: '220px',
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
    label: 'single-docs-active-tab',
    backgroundColor: theme.colors.background.primary,
    borderColor: theme.colors.border.medium,
    borderBottomColor: theme.colors.background.primary,
    zIndex: 1,
    '&:hover': {
      backgroundColor: theme.colors.background.primary,
    },
  }),
  tabContent: css({
    label: 'single-docs-tab-content',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(1),
    width: '100%',
    minWidth: 0,
  }),
  tabIcon: css({
    label: 'single-docs-tab-icon',
    color: theme.colors.text.secondary,
    flexShrink: 0,
  }),
  tabTitle: css({
    label: 'single-docs-tab-title',
    textOverflow: 'ellipsis',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    flex: 1,
    minWidth: 0,
  }),
  closeButton: css({
    label: 'single-docs-close-button',
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
  content: css({
    label: 'single-docs-content',
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
  docsContent: css({
    backgroundColor: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    overflow: 'hidden',
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
  }),
  contentMeta: css({
    padding: theme.spacing(1.5, 2),
    backgroundColor: theme.colors.background.canvas,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    flexShrink: 0,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  }),
  metaInfo: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
  }),
  breadcrumbs: css({
    fontSize: '11px',
    color: theme.colors.text.disabled,
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
    backgroundColor: theme.colors.primary.main,
    color: theme.colors.primary.contrastText,
    borderRadius: theme.shape.radius.default,
    fontSize: '11px',
    fontWeight: theme.typography.fontWeightMedium,
  }),
  docsContentHtml: css({
    padding: theme.spacing(3),
    overflow: 'auto',
    flex: 1,
    lineHeight: 1.6,
    fontSize: theme.typography.body.fontSize,
    
    // Enhanced image styling for docs
    '& img.docs-image': {
      maxWidth: '100%',
      height: 'auto',
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
      margin: `${theme.spacing(2)} auto`,
      display: 'block',
      boxShadow: theme.shadows.z1,
    },
    
    // Code styling
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
    
    // Docs admonitions (notes, warnings)
    '& .docs-admonition': {
      margin: `${theme.spacing(2)} 0`,
      padding: theme.spacing(2),
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.medium}`,
      backgroundColor: theme.colors.background.canvas,
      
      '& .title': {
        fontWeight: theme.typography.fontWeightBold,
        marginBottom: theme.spacing(1),
        color: theme.colors.text.primary,
      },
      
      '&.admonition-note': {
        borderLeftColor: theme.colors.info.main,
        borderLeftWidth: '4px',
      },
      
      '&.admonition-warning': {
        borderLeftColor: theme.colors.warning.main,
        borderLeftWidth: '4px',
      },
    },
    
    // Copy button styling for docs
    '& .docs-copy-button': {
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
      
      '&.copied': {
        backgroundColor: theme.colors.success.main,
        borderColor: theme.colors.success.border,
        color: theme.colors.success.contrastText,
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
    
    // Pre/code blocks
    '& pre.docs-code-snippet': {
      position: 'relative',
      backgroundColor: theme.colors.background.canvas,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      margin: `${theme.spacing(2)} 0`,
      padding: `${theme.spacing(2)} ${theme.spacing(10)} ${theme.spacing(2)} ${theme.spacing(2)}`,
      overflow: 'auto',
      fontFamily: theme.typography.fontFamilyMonospace,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: 1.5,
      color: theme.colors.text.primary,
      
      '& code': {
        backgroundColor: 'transparent',
        padding: 0,
        border: 'none',
        borderRadius: 0,
        fontFamily: 'inherit',
        fontSize: 'inherit',
        color: 'inherit',
      },
    },
    
    // Links
    '& a[data-docs-link="true"]': {
      color: theme.colors.primary.main,
      textDecoration: 'none',
      '&:hover': {
        textDecoration: 'underline',
      },
    },
    
    // Headings
    '& h1, & h2, & h3, & h4, & h5, & h6': {
      color: theme.colors.text.primary,
      fontWeight: theme.typography.fontWeightMedium,
      marginTop: theme.spacing(3),
      marginBottom: theme.spacing(2),
      
      '&:first-child': {
        marginTop: 0,
      },
    },
    
    '& h1': {
      fontSize: theme.typography.h2.fontSize,
      borderBottom: `2px solid ${theme.colors.border.medium}`,
      paddingBottom: theme.spacing(1),
    },
    
    '& h2': {
      fontSize: theme.typography.h3.fontSize,
    },
    
    '& h3': {
      fontSize: theme.typography.h4.fontSize,
    },
    
    // Lists
    '& ul, & ol': {
      marginBottom: theme.spacing(2),
      paddingLeft: theme.spacing(3),
    },
    
    '& li': {
      marginBottom: theme.spacing(1),
    },
    
    // Paragraphs
    '& p': {
      marginBottom: theme.spacing(2),
      lineHeight: 1.7,
    },
  }),
});

export default SingleDocsPanel; 
