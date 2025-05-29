import { css } from '@emotion/css';
import React, { useEffect, useRef } from 'react';

import { GrafanaTheme2 } from '@grafana/data';
import { SceneComponentProps, SceneObjectBase, SceneObjectState } from '@grafana/scenes';
import { Icon, IconButton, useStyles2, Spinner, Alert } from '@grafana/ui';
import { locationService } from '@grafana/runtime';
import { getDocsForRoute, DocsContent, clearDocsCache } from '../../utils/docs-fetcher';

interface DocsTab {
  id: string;
  title: string;
  url: string;
  content: DocsContent | null;
  isLoading: boolean;
  error: string | null;
}

interface DocsPanelState extends SceneObjectState {
  currentPath: string;
  currentUrl: string;
  pluginPath: string;
  pathSegments: string[];
  timestamp: string;
  tabs: DocsTab[];
  activeTabId: string;
}

export class DocsPanel extends SceneObjectBase<DocsPanelState> {
  public static Component = DocsPanelRenderer;

  public get renderBeforeActivation(): boolean {
    return true;
  }

  public constructor() {
    super({
      currentPath: '',
      currentUrl: '',
      pluginPath: '',
      pathSegments: [],
      timestamp: '',
      tabs: [],
      activeTabId: '',
    });

    this.updatePageContext();
  }

  private async updatePageContext() {
    const currentPath = window.location.pathname;
    const currentUrl = window.location.href;
    const pathSegments = currentPath.split('/').filter(Boolean);
    const timestamp = new Date().toISOString();

    this.setState({
      currentPath,
      currentUrl,
      pathSegments,
      timestamp,
    });

    // Create initial tab if none exist
    if (this.state.tabs.length === 0) {
      await this.createNewTab(currentPath, 'Context Documentation', true);
    }
  }

  public refreshContext() {
    this.updatePageContext();
  }

  public clearCache() {
    clearDocsCache();
    // Refresh all tabs
    this.state.tabs.forEach(tab => {
      this.loadTabContent(tab.id, tab.url);
    });
  }

  private generateTabId(): string {
    return `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  public async createNewTab(routePath: string, title?: string, makeActive: boolean = true): Promise<string> {
    const tabId = this.generateTabId();
    const newTab: DocsTab = {
      id: tabId,
      title: title || 'Loading...',
      url: routePath,
      content: null,
      isLoading: true,
      error: null,
    };

    const updatedTabs = [...this.state.tabs, newTab];
    
    this.setState({
      tabs: updatedTabs,
      activeTabId: makeActive ? tabId : this.state.activeTabId,
    });

    // Load content for the new tab
    await this.loadTabContent(tabId, routePath);
    
    return tabId;
  }

  public async loadTabContent(tabId: string, routePath: string) {
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
      const docsContent = await getDocsForRoute(routePath);
      
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
      }
    } catch (error) {
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
    const updatedTabs = this.state.tabs.filter(tab => tab.id !== tabId);
    
    // If we're closing the active tab, switch to another tab
    let newActiveTabId = this.state.activeTabId;
    if (this.state.activeTabId === tabId) {
      if (updatedTabs.length > 0) {
        // Find the tab that was to the right of the closed tab, or the last tab
        const closedTabIndex = this.state.tabs.findIndex(tab => tab.id === tabId);
        if (closedTabIndex < updatedTabs.length) {
          newActiveTabId = updatedTabs[closedTabIndex].id;
        } else {
          newActiveTabId = updatedTabs[updatedTabs.length - 1].id;
        }
      } else {
        newActiveTabId = '';
      }
    }

    this.setState({
      tabs: updatedTabs,
      activeTabId: newActiveTabId,
    });
  }

  public setActiveTab(tabId: string) {
    this.setState({ activeTabId: tabId });
  }

  public async openInternalLink(url: string) {
    // Create a new tab for the internal link
    const tabId = await this.createNewTab(url, 'Loading...', true);
    
    // If the content fails to load after a reasonable time, fall back to opening in browser
    setTimeout(async () => {
      const tab = this.state.tabs.find(t => t.id === tabId);
      if (tab && tab.error && !tab.content) {
        console.log('Content failed to load, opening in browser instead');
        window.open(url, '_blank', 'noopener,noreferrer');
        // Close the failed tab
        this.closeTab(tabId);
      }
    }, 5000); // Wait 5 seconds for content to load
  }

  public openSourceInBrowser() {
    const activeTab = this.getActiveTab();
    if (activeTab?.content?.url) {
      window.open(activeTab.content.url, '_blank', 'noopener,noreferrer');
    }
  }

  public getActiveTab(): DocsTab | null {
    return this.state.tabs.find(tab => tab.id === this.state.activeTabId) || null;
  }
}

function DocsPanelRenderer({ model }: SceneComponentProps<DocsPanel>) {
  const { tabs, activeTabId } = model.useState();
  const styles = useStyles2(getStyles, false);
  const contentRef = useRef<HTMLDivElement>(null);
  const activeTab = model.getActiveTab();

  // Handle link clicks for internal navigation
  useEffect(() => {
    const handleLinkClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const link = target.closest('a[href]') as HTMLAnchorElement;
      
      if (link) {
        const href = link.getAttribute('href');
        
        if (href) {
          console.log(`Link clicked: ${href}, has data-docs-link: ${link.hasAttribute('data-docs-link')}`);
          
          // Handle anchor links (same page navigation)
          if (href.startsWith('#')) {
            console.log('Anchor link, allowing default behavior');
            return;
          }
          
          // Be more aggressive - intercept ANY link that could be docs-related
          const shouldIntercept = 
            link.hasAttribute('data-docs-link') ||           // Explicitly marked
            href.includes('grafana.com/docs') ||             // Absolute docs links
            href.startsWith('/docs') ||                      // Root-relative docs
            href.startsWith('./') ||                         // Same-directory relative
            href.startsWith('../') ||                        // Parent-directory relative
            href.startsWith('/') ||                          // Any root-relative
            (!href.startsWith('http') &&                     // Any relative link
             !href.startsWith('mailto:') && 
             !href.startsWith('tel:') && 
             !href.startsWith('javascript:') &&
             !href.startsWith('ftp:'));
          
          if (shouldIntercept) {
            console.log('Intercepting docs link');
            event.preventDefault();
            event.stopPropagation();
            
            // Resolve the URL using URL constructor (this doesn't navigate)
            let resolvedUrl: string;
            
            if (activeTab?.content?.url) {
              try {
                console.log(`Resolving ${href} relative to ${activeTab.content.url}`);
                // The URL constructor resolves relative URLs without navigation
                const resolvedUrlObj = new URL(href, activeTab.content.url);
                resolvedUrl = resolvedUrlObj.href;
                console.log(`Resolved to: ${resolvedUrl}`);
              } catch (error) {
                // Fallback if URL parsing fails
                console.warn('URL resolution failed, using fallback:', error);
                if (href.startsWith('http')) {
                  resolvedUrl = href;
                } else if (href.startsWith('/')) {
                  resolvedUrl = `https://grafana.com${href}`;
                } else {
                  // Manual resolution as fallback
                  const baseUrl = activeTab.content.url.endsWith('/') ? activeTab.content.url : activeTab.content.url + '/';
                  resolvedUrl = baseUrl + href;
                }
              }
            } else {
              // No current URL context, make best guess
              if (href.startsWith('http')) {
                resolvedUrl = href;
              } else if (href.startsWith('/')) {
                resolvedUrl = `https://grafana.com${href}`;
              } else {
                resolvedUrl = `https://grafana.com/docs/${href}`;
              }
            }
            
            console.log(`Opening in new tab: ${resolvedUrl}`);
            
            // Try to open in plugin first, with fallback to browser
            try {
              model.openInternalLink(resolvedUrl);
            } catch (error) {
              console.warn('Failed to open in plugin, opening in browser:', error);
              window.open(resolvedUrl, '_blank', 'noopener,noreferrer');
            }
            return; // Ensure we don't continue processing
          }
          
          // For external links, ensure they open in new tab
          if (href.startsWith('http') && !href.includes('grafana.com')) {
            console.log('External link, ensuring new tab');
            if (!link.hasAttribute('target')) {
              link.setAttribute('target', '_blank');
              link.setAttribute('rel', 'noopener noreferrer');
            }
            return; // Let the default behavior handle it
          }
          
          console.log('Link not intercepted, allowing default behavior');
        }
      }
    };

    const handleImageClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const img = target.closest('img') as HTMLImageElement;
      
      if (img && img.src && !img.closest('a')) {
        // Only handle images that aren't already inside links
        event.preventDefault();
        event.stopPropagation();
        
        // Create a modal-like overlay to show the full-size image
        const overlay = document.createElement('div');
        overlay.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.8);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
          cursor: pointer;
        `;
        
        const fullImg = document.createElement('img');
        fullImg.src = img.src;
        fullImg.alt = img.alt;
        fullImg.style.cssText = `
          max-width: 90%;
          max-height: 90%;
          object-fit: contain;
          border-radius: 8px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        `;
        
        overlay.appendChild(fullImg);
        document.body.appendChild(overlay);
        
        // Close on click
        overlay.addEventListener('click', () => {
          document.body.removeChild(overlay);
        });
        
        // Close on escape key
        const handleEscape = (e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            document.body.removeChild(overlay);
            document.removeEventListener('keydown', handleEscape);
          }
        };
        document.addEventListener('keydown', handleEscape);
      }
    };

    const contentElement = contentRef.current;
    if (contentElement) {
      contentElement.addEventListener('click', handleLinkClick);
      contentElement.addEventListener('click', handleImageClick);
      return () => {
        contentElement.removeEventListener('click', handleLinkClick);
        contentElement.removeEventListener('click', handleImageClick);
      };
    }
  }, [model, activeTab?.content]);

  // Handle keyboard shortcuts for tab navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ctrl/Cmd + W to close current tab
      if ((event.ctrlKey || event.metaKey) && event.key === 'w') {
        event.preventDefault();
        if (activeTab && tabs.length > 1) {
          model.closeTab(activeTab.id);
        }
      }
      
      // Ctrl/Cmd + T to open new tab
      if ((event.ctrlKey || event.metaKey) && event.key === 't') {
        event.preventDefault();
        model.createNewTab(window.location.pathname, 'New Tab', true);
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

  return (
    <div className={styles.container}>
      <div className={styles.topBar}>
        <div className={styles.title}>
          <div className={styles.titleContent}>
            <div className={styles.appIcon}>
              <Icon name="question-circle" size="lg" />
            </div>
            <div className={styles.titleText}>
              Documentation
            </div>
          </div>
        </div>
        <div className={styles.actions}>
          <IconButton
            name="plus"
            aria-label="New tab"
            onClick={() => model.createNewTab(window.location.pathname, 'New Tab', true)}
            tooltip="Open new tab"
            tooltipPlacement="left"
          />
          <IconButton
            name="external-link-alt"
            aria-label="Open source"
            onClick={() => model.openSourceInBrowser()}
            tooltip="Open source page in browser"
            tooltipPlacement="left"
            disabled={!activeTab?.content?.url}
          />
          <IconButton
            name="trash-alt"
            aria-label="Clear cache"
            onClick={() => model.clearCache()}
            tooltip="Clear documentation cache"
            tooltipPlacement="left"
          />
          <IconButton
            name="sync"
            aria-label="Refresh context"
            onClick={() => model.refreshContext()}
            tooltip="Refresh page context"
            tooltipPlacement="left"
          />
        </div>
      </div>

      {/* Tab Bar */}
      {tabs.length > 0 && (
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
                  {tabs.length > 1 && (
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
      )}

      <div className={styles.content}>
        {activeTab?.isLoading && (
          <div className={styles.loadingContainer}>
            <Spinner size="lg" />
            <span>Loading documentation...</span>
          </div>
        )}
        
        {activeTab?.error && !activeTab.isLoading && (
          <Alert severity="info" title="Documentation">
            {activeTab.error}
          </Alert>
        )}
        
        {activeTab?.content && !activeTab.isLoading && (
          <div className={styles.dynamicDocContent}>
            <div className={styles.docMeta}>
              <small>
                Last updated: {new Date(activeTab.content.lastFetched).toLocaleString()}
              </small>
            </div>
            <div 
              ref={contentRef}
              className={styles.docContentHtml}
              dangerouslySetInnerHTML={{ __html: activeTab.content.content }}
            />
            {/* Debug info for images */}
            {process.env.NODE_ENV === 'development' && (
              <div style={{ 
                padding: '8px', 
                backgroundColor: '#f0f0f0', 
                fontSize: '12px', 
                borderTop: '1px solid #ccc',
                color: '#666'
              }}>
                <strong>Debug:</strong> Content contains {(activeTab.content.content.match(/<img[^>]*>/g) || []).length} img tags
              </div>
            )}
          </div>
        )}
        
        {tabs.length === 0 && (
          <div className={styles.fallbackContent}>
            <p>No documentation tabs open.</p>
            <p>Click the + button to create a new tab or navigate to a supported Grafana page.</p>
          </div>
        )}
      </div>
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2, withVersions: boolean) => ({
  container: css({
    label: 'docs-container',
    backgroundColor: theme.colors.background.primary,
    borderRadius: '0',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    border: `1px solid ${theme.colors.border.weak}`,
    borderTop: 'none',
    borderBottom: 'none',
    // hacky way of getting around the 8px padding
    margin: theme.spacing(-1),
    height: `calc(100% + ${theme.spacing(2)})`,
    width: `calc(100% + ${theme.spacing(2)})`,
  }),
  topBar: css({
    label: 'docs-top-bar',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
    padding: theme.spacing(1),
    backgroundColor: theme.colors.background.canvas,
  }),
  title: css({
    label: 'docs-title',
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
    label: 'docs-icon',
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
    label: 'docs-title-content',
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),
  titleText: css({
    fontSize: theme.typography.h5.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  actions: css({
    label: 'docs-actions',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: theme.spacing(1),
  }),
  content: css({
    label: 'docs-content',
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
  dynamicDocContent: css({
    backgroundColor: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    overflow: 'hidden',
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
  }),
  docMeta: css({
    padding: theme.spacing(1, 2),
    backgroundColor: theme.colors.background.canvas,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    flexShrink: 0,
    '& a': {
      color: theme.colors.primary.main,
      textDecoration: 'none',
      '&:hover': {
        textDecoration: 'underline',
      },
    },
  }),
  docContentHtml: css({
    padding: theme.spacing(3),
    overflow: 'auto',
    flex: 1,
    lineHeight: 1.6,
    fontSize: theme.typography.body.fontSize,
    
    // Reset and normalize all text sizes
    '& *': {
      fontSize: 'inherit !important',
      lineHeight: 'inherit !important',
    },
    
    // Base typography with controlled sizes
    '& .docs-heading, & h1, & h2, & h3, & h4, & h5, & h6': {
      color: theme.colors.text.primary,
      fontWeight: theme.typography.fontWeightMedium,
      lineHeight: '1.3 !important',
      marginBottom: theme.spacing(2),
      '&:first-child': {
        marginTop: 0,
      },
      '&:not(:first-child)': {
        marginTop: theme.spacing(4),
      },
    },
    
    '& .docs-heading-h1, & h1': {
      fontSize: `${theme.typography.h2.fontSize} !important`,
      fontWeight: theme.typography.fontWeightBold,
      borderBottom: `2px solid ${theme.colors.border.medium}`,
      paddingBottom: theme.spacing(1),
      marginBottom: theme.spacing(3),
    },
    
    '& .docs-heading-h2, & h2': {
      fontSize: `${theme.typography.h3.fontSize} !important`,
      fontWeight: theme.typography.fontWeightMedium,
      marginTop: theme.spacing(4),
      marginBottom: theme.spacing(2),
    },
    
    '& .docs-heading-h3, & h3': {
      fontSize: `${theme.typography.h4.fontSize} !important`,
      marginTop: theme.spacing(3),
      marginBottom: theme.spacing(1.5),
    },
    
    '& .docs-heading-h4, & h4': {
      fontSize: `${theme.typography.h5.fontSize} !important`,
      marginTop: theme.spacing(2),
      marginBottom: theme.spacing(1),
    },
    
    '& .docs-heading-h5, & h5': {
      fontSize: `${theme.typography.body.fontSize} !important`,
      fontWeight: theme.typography.fontWeightMedium,
      marginTop: theme.spacing(2),
      marginBottom: theme.spacing(1),
    },
    
    '& .docs-heading-h6, & h6': {
      fontSize: `${theme.typography.bodySmall.fontSize} !important`,
      fontWeight: theme.typography.fontWeightMedium,
      marginTop: theme.spacing(1),
      marginBottom: theme.spacing(0.5),
    },
    
    // Paragraphs with controlled size
    '& .docs-paragraph, & p': {
      margin: `0 0 ${theme.spacing(2)} 0`,
      lineHeight: '1.7 !important',
      fontSize: `${theme.typography.body.fontSize} !important`,
      color: theme.colors.text.primary,
      '&:last-child': {
        marginBottom: 0,
      },
    },
    
    // Lists
    '& .docs-list, & ul, & ol': {
      margin: `${theme.spacing(2)} 0`,
      paddingLeft: theme.spacing(3),
      fontSize: `${theme.typography.body.fontSize} !important`,
      '& .docs-list, & ul, & ol': {
        marginTop: theme.spacing(1),
        marginBottom: theme.spacing(1),
      },
    },
    
    '& .docs-list-item, & li': {
      marginBottom: theme.spacing(1),
      lineHeight: '1.6 !important',
      fontSize: `${theme.typography.body.fontSize} !important`,
      '&:last-child': {
        marginBottom: 0,
      },
    },
    
    // Code styling
    '& .docs-inline-code, & code': {
      backgroundColor: theme.colors.background.canvas,
      color: theme.colors.text.primary,
      padding: theme.spacing(0.25, 0.75),
      borderRadius: theme.shape.radius.default,
      fontFamily: theme.typography.fontFamilyMonospace,
      fontSize: `${theme.typography.bodySmall.fontSize} !important`,
      border: `1px solid ${theme.colors.border.weak}`,
      fontWeight: theme.typography.fontWeightMedium,
    },
    
    '& .docs-code-block, & pre': {
      backgroundColor: theme.colors.background.canvas,
      padding: theme.spacing(2),
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
      overflow: 'auto',
      margin: `${theme.spacing(2)} 0`,
      fontFamily: theme.typography.fontFamilyMonospace,
      fontSize: `${theme.typography.bodySmall.fontSize} !important`,
      lineHeight: '1.5 !important',
      '& code': {
        backgroundColor: 'transparent',
        padding: 0,
        border: 'none',
        fontSize: 'inherit !important',
      },
    },
    
    // Links
    '& a': {
      color: theme.colors.primary.main,
      textDecoration: 'none',
      fontWeight: theme.typography.fontWeightMedium,
      fontSize: 'inherit !important',
      '&:hover': {
        textDecoration: 'underline',
        color: theme.colors.primary.shade,
      },
      '&[data-internal-link="true"]': {
        cursor: 'pointer',
        borderBottom: `1px dotted ${theme.colors.primary.main}`,
        '&:hover': {
          backgroundColor: theme.colors.action.hover,
          borderBottom: `1px solid ${theme.colors.primary.main}`,
        },
      },
    },
    
    // Blockquotes
    '& .docs-blockquote, & blockquote': {
      borderLeft: `4px solid ${theme.colors.primary.main}`,
      paddingLeft: theme.spacing(2),
      margin: `${theme.spacing(2)} 0`,
      fontStyle: 'italic',
      fontSize: `${theme.typography.body.fontSize} !important`,
      color: theme.colors.text.secondary,
      backgroundColor: theme.colors.background.canvas,
      padding: theme.spacing(2),
      borderRadius: `0 ${theme.shape.radius.default}px ${theme.shape.radius.default}px 0`,
    },
    
    // Images
    '& .docs-image-wrapper': {
      margin: `${theme.spacing(3)} 0`,
      textAlign: 'center',
      position: 'relative',
      overflow: 'hidden',
      borderRadius: theme.shape.radius.default,
      '&:empty': {
        display: 'none',
      },
    },
    
    '& .docs-image, & img': {
      maxWidth: '100%',
      width: 'auto',
      height: 'auto',
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
      boxShadow: theme.shadows.z1,
      backgroundColor: theme.colors.background.secondary,
      cursor: 'pointer',
      transition: 'transform 0.2s ease, box-shadow 0.2s ease',
      display: 'block',
      margin: '0 auto',
      // Better size constraints for sidebar
      maxHeight: '250px',
      objectFit: 'contain',
      // Add debugging styles
      minHeight: '20px',
      minWidth: '20px',
      '&:hover': {
        transform: 'scale(1.02)',
        boxShadow: theme.shadows.z2,
      },
      '&[src=""], &:not([src])': {
        display: 'none',
      },
      // Show loading state
      '&[data-load-failed="true"]': {
        display: 'none !important',
      },
      '&[data-load-success="true"]': {
        border: `2px solid ${theme.colors.success.main}`,
      },
      // Handle broken images gracefully
      '&[alt]:after': {
        content: 'attr(alt)',
        display: 'block',
        padding: theme.spacing(1),
        fontSize: theme.typography.bodySmall.fontSize,
        color: theme.colors.text.secondary,
        fontStyle: 'italic',
        backgroundColor: theme.colors.background.canvas,
        border: `1px solid ${theme.colors.border.weak}`,
        borderRadius: theme.shape.radius.default,
      },
      // Handle loading state
      '&[loading]': {
        backgroundColor: theme.colors.background.canvas,
        minHeight: '100px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        '&:before': {
          content: '"Loading image..."',
          color: theme.colors.text.secondary,
          fontSize: theme.typography.bodySmall.fontSize,
        },
      },
    },
    
    // Large images that might need special handling
    '& .docs-image-large, & img[width], & img[height]': {
      maxWidth: '100% !important',
      width: 'auto !important',
      height: 'auto !important',
      maxHeight: '200px !important',
    },
    
    // Very wide images (like screenshots) get more restrictive sizing
    '& img[width="794"], & img[width="800"], & img[width="1000"], & img[width="1200"]': {
      maxHeight: '180px !important',
      width: 'auto !important',
      height: 'auto !important',
    },
    
    // Small icons and inline images
    '& .docs-image-inline, & img[width="16"], & img[width="24"], & img[width="32"]': {
      display: 'inline-block',
      verticalAlign: 'middle',
      margin: '0 4px',
      maxHeight: '24px',
      width: 'auto',
      border: 'none',
      boxShadow: 'none',
      cursor: 'default',
      '&:hover': {
        transform: 'none',
      },
    },
    
    // Tables
    '& .docs-table-wrapper': {
      margin: `${theme.spacing(2)} 0`,
      overflow: 'auto',
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
    },
    
    '& .docs-table, & table': {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: `${theme.typography.bodySmall.fontSize} !important`,
      '& th, & td': {
        padding: theme.spacing(1.5),
        textAlign: 'left',
        borderBottom: `1px solid ${theme.colors.border.weak}`,
        fontSize: `${theme.typography.bodySmall.fontSize} !important`,
      },
      '& th': {
        backgroundColor: theme.colors.background.canvas,
        fontWeight: theme.typography.fontWeightMedium,
        color: theme.colors.text.primary,
        borderBottom: `2px solid ${theme.colors.border.medium}`,
      },
      '& tr:hover': {
        backgroundColor: theme.colors.action.hover,
      },
    },
    
    // Special styling for documentation content
    '& .docs-section': {
      margin: `${theme.spacing(3)} 0`,
      padding: theme.spacing(2),
      backgroundColor: theme.colors.background.canvas,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
    },
    
    // Code examples and snippets
    '& .docs-example': {
      margin: `${theme.spacing(2)} 0`,
      padding: theme.spacing(2),
      backgroundColor: theme.colors.background.canvas,
      border: `1px solid ${theme.colors.border.weak}`,
      borderLeft: `4px solid ${theme.colors.info.main}`,
      borderRadius: theme.shape.radius.default,
    },
    
    // Warning and info boxes
    '& .docs-warning, & .admonition': {
      margin: `${theme.spacing(2)} 0`,
      padding: theme.spacing(2),
      backgroundColor: theme.colors.background.canvas,
      border: `1px solid ${theme.colors.warning.border}`,
      borderLeft: `4px solid ${theme.colors.warning.main}`,
      borderRadius: theme.shape.radius.default,
    },
    
    '& .docs-info': {
      margin: `${theme.spacing(2)} 0`,
      padding: theme.spacing(2),
      backgroundColor: theme.colors.background.canvas,
      border: `1px solid ${theme.colors.info.border}`,
      borderLeft: `4px solid ${theme.colors.info.main}`,
      borderRadius: theme.shape.radius.default,
    },
    
    // Breadcrumbs
    '& nav, & .breadcrumb': {
      margin: `0 0 ${theme.spacing(2)} 0`,
      fontSize: `${theme.typography.bodySmall.fontSize} !important`,
      color: theme.colors.text.secondary,
      '& a': {
        color: theme.colors.primary.main,
        '&:hover': {
          textDecoration: 'underline',
        },
      },
    },
    
    // Page navigation (Page 1 of 9)
    '& .docs-page-navigation': {
      textAlign: 'center',
      margin: `${theme.spacing(2)} 0`,
      padding: theme.spacing(1),
      backgroundColor: theme.colors.background.canvas,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      fontSize: `${theme.typography.bodySmall.fontSize} !important`,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.secondary,
    },
    
    // Learning journey overview/summary
    '& .docs-journey-overview': {
      margin: `${theme.spacing(3)} 0`,
      padding: theme.spacing(2),
      backgroundColor: theme.colors.background.canvas,
      border: `1px solid ${theme.colors.primary.border}`,
      borderLeft: `4px solid ${theme.colors.primary.main}`,
      borderRadius: theme.shape.radius.default,
    },
    
    // Milestone progress bar
    '& .docs-progress-bar': {
      width: '100%',
      height: '4px',
      backgroundColor: theme.colors.background.secondary,
      borderRadius: '2px',
      margin: `${theme.spacing(1)} 0`,
      overflow: 'hidden',
      '& .progress-fill': {
        height: '100%',
        backgroundColor: theme.colors.success.main,
        transition: 'width 0.3s ease',
      },
    },
    
    // Time estimates
    '& .time-estimate': {
      display: 'inline-flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
      fontSize: `${theme.typography.bodySmall.fontSize} !important`,
      color: theme.colors.text.secondary,
      '&:before': {
        content: '"⏱"',
        fontSize: '0.8em',
      },
    },
    
    // Responsive adjustments
    '@media (max-width: 768px)': {
      padding: theme.spacing(2),
      fontSize: `${theme.typography.bodySmall.fontSize} !important`,
      
      '& .docs-heading-h1, & h1': {
        fontSize: `${theme.typography.h3.fontSize} !important`,
      },
      
      '& .docs-heading-h2, & h2': {
        fontSize: `${theme.typography.h4.fontSize} !important`,
      },
      
      '& .docs-table-wrapper': {
        fontSize: `${theme.typography.bodySmall.fontSize} !important`,
      },
    },
  }),
  fallbackContent: css({
    padding: theme.spacing(2),
    textAlign: 'center',
    color: theme.colors.text.secondary,
  }),
  tabBar: css({
    label: 'docs-tab-bar',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing(0.5, 1),
    backgroundColor: theme.colors.background.canvas,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    overflow: 'hidden',
  }),
  tabList: css({
    label: 'docs-tab-list',
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
    label: 'docs-tab',
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
    label: 'docs-active-tab',
    backgroundColor: theme.colors.background.primary,
    borderColor: theme.colors.border.medium,
    borderBottomColor: theme.colors.background.primary,
    zIndex: 1,
    '&:hover': {
      backgroundColor: theme.colors.background.primary,
    },
  }),
  tabContent: css({
    label: 'docs-tab-content',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(1),
    width: '100%',
    minWidth: 0, // Allow shrinking
  }),
  tabTitle: css({
    label: 'docs-tab-title',
    textOverflow: 'ellipsis',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    flex: 1,
    minWidth: 0, // Allow shrinking
  }),
  closeButton: css({
    label: 'docs-close-button',
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
