import { css } from '@emotion/css';
import React, { useEffect, useRef } from 'react';

import { GrafanaTheme2 } from '@grafana/data';
import { SceneComponentProps, SceneObjectBase, SceneObjectState } from '@grafana/scenes';
import { Icon, IconButton, useStyles2, Spinner, Alert, useTheme2 } from '@grafana/ui';
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
  const theme = useTheme2();
  const contentRef = useRef<HTMLDivElement>(null);
  const activeTab = model.getActiveTab();

  // Add global modal styles on component mount
  useEffect(() => {
    addGlobalModalStyles();
  }, []);

  // Handle link clicks for image lightbox
  useEffect(() => {
    const handleLinkClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      
      // Handle image lightbox clicks
      const image = target.closest('img') as HTMLImageElement;
      
      if (image && !image.classList.contains('journey-conclusion-header')) {
        event.preventDefault();
        event.stopPropagation();
        
        const imageSrc = image.src;
        const imageAlt = image.alt || 'Image';
        
        // Create image lightbox modal with theme awareness
        const imageModal = document.createElement('div');
        imageModal.className = 'journey-image-modal';
        
        // Create a temporary image to get natural dimensions
        const tempImg = new Image();
        tempImg.onload = () => {
          const naturalWidth = tempImg.naturalWidth;
          const naturalHeight = tempImg.naturalHeight;
          
          // Calculate responsive sizing
          const viewportWidth = window.innerWidth;
          const viewportHeight = window.innerHeight;
          
          // Account for modal padding and header (roughly 120px total)
          const availableWidth = Math.min(viewportWidth * 0.9, viewportWidth - 40);
          const availableHeight = Math.min(viewportHeight * 0.8, viewportHeight - 120);
          
          // Don't upscale small images beyond their natural size
          const maxWidth = Math.min(availableWidth, naturalWidth);
          const maxHeight = Math.min(availableHeight, naturalHeight);
          
          // Maintain aspect ratio
          const aspectRatio = naturalWidth / naturalHeight;
          let displayWidth = maxWidth;
          let displayHeight = displayWidth / aspectRatio;
          
          if (displayHeight > maxHeight) {
            displayHeight = maxHeight;
            displayWidth = displayHeight * aspectRatio;
          }
          
          // Ensure minimum sizes for very small images
          const minDisplaySize = 200;
          if (displayWidth < minDisplaySize && displayHeight < minDisplaySize) {
            if (aspectRatio >= 1) {
              displayWidth = Math.min(minDisplaySize, naturalWidth);
              displayHeight = displayWidth / aspectRatio;
            } else {
              displayHeight = Math.min(minDisplaySize, naturalHeight);
              displayWidth = displayHeight * aspectRatio;
            }
          }
          
          const containerWidth = Math.min(displayWidth + 40, viewportWidth - 20);
          
          // Use theme colors directly
          const backgroundColor = theme.colors.background.primary;
          const headerBackgroundColor = theme.colors.background.canvas;
          const borderColor = theme.colors.border.weak;
          const textColor = theme.colors.text.primary;
          const textSecondaryColor = theme.colors.text.secondary;
          
          imageModal.innerHTML = `
            <div class="journey-image-modal-backdrop">
              <div class="journey-image-modal-container" style="
                width: ${containerWidth}px;
                background: ${backgroundColor};
                border: 1px solid ${borderColor};
              ">
                <div class="journey-image-modal-header" style="
                  background: ${headerBackgroundColor};
                  border-bottom: 1px solid ${borderColor};
                ">
                  <h3 class="journey-image-modal-title" style="color: ${textColor};">${imageAlt}</h3>
                  <button class="journey-image-modal-close" aria-label="Close image" style="color: ${textSecondaryColor};">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                </div>
                <div class="journey-image-modal-content" style="background: ${backgroundColor};">
                  <img src="${imageSrc}" alt="${imageAlt}" class="journey-image-modal-image" 
                       style="max-width: ${displayWidth}px; max-height: ${displayHeight}px;" />
                </div>
              </div>
            </div>
          `;
          
          // Add to body
          document.body.appendChild(imageModal);
          
          // Add close functionality
          const closeModal = () => {
            document.body.removeChild(imageModal);
            document.body.style.overflow = '';
          };
          
          // Close on backdrop click
          imageModal.querySelector('.journey-image-modal-backdrop')?.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) {
              closeModal();
            }
          });
          
          // Close on close button click
          imageModal.querySelector('.journey-image-modal-close')?.addEventListener('click', closeModal);
          
          // Close on escape key
          const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
              closeModal();
              document.removeEventListener('keydown', handleEscape);
            }
          };
          document.addEventListener('keydown', handleEscape);
          
          // Prevent body scroll
          document.body.style.overflow = 'hidden';
        };
        
        // Load the image to get dimensions
        tempImg.src = imageSrc;
      }
    };

    const contentElement = contentRef.current;
    if (contentElement) {
      contentElement.addEventListener('click', handleLinkClick);
      return () => {
        contentElement.removeEventListener('click', handleLinkClick);
      };
    }
    return undefined;
  }, [activeTab?.content, theme.colors.background.primary, theme.colors.background.canvas, theme.colors.border.weak, theme.colors.text.primary, theme.colors.text.secondary]);

  // Process code snippets and add copy buttons for both code blocks and inline code
  useEffect(() => {
    const contentElement = contentRef.current;
    if (!contentElement) {return;}

    // Target both code blocks (pre) and inline code elements
    const codeBlockSelectors = [
      'pre.docs-code-snippet',        // Single docs code blocks  
      'pre[class*="language-"]',      // Language-specific blocks
      'pre:has(code)',                // Any pre with code inside
      'pre'                           // Fallback to any pre element
    ];
    
    const allPreElements = new Set<HTMLPreElement>();
    const allInlineCodeElements = new Set<HTMLElement>();
    
    // Collect all unique pre elements using different selectors
    codeBlockSelectors.forEach(selector => {
      try {
        const elements = contentElement.querySelectorAll(selector) as NodeListOf<HTMLPreElement>;
        elements.forEach(el => allPreElements.add(el));
      } catch (e) {
        // Skip selectors that don't work (like :has() in older browsers)
      }
    });
    
    // Collect inline code elements that aren't inside pre blocks
    const inlineCodeElements = contentElement.querySelectorAll('code') as NodeListOf<HTMLElement>;
    inlineCodeElements.forEach(codeEl => {
      // Only add if it's not inside a pre element and has meaningful content
      if (!codeEl.closest('pre') && codeEl.textContent && codeEl.textContent.trim().length > 0) {
        allInlineCodeElements.add(codeEl);
      }
    });
    
    console.log(`📝 Found ${allPreElements.size} code blocks and ${allInlineCodeElements.size} inline code elements to process`);
    
    // Process pre elements (code blocks)
    Array.from(allPreElements).forEach((preElement, index) => {
      // Skip if this pre element already has our copy button
      if (preElement.querySelector('.code-copy-button')) {
        return;
      }
      
      // Must contain code to be processed
      const codeElement = preElement.querySelector('code') || preElement;
      const codeText = codeElement.textContent || '';
      if (!codeText.trim()) {
        return;
      }
      
      console.log(`📝 Processing pre element ${index + 1} with ${codeText.length} characters of code`);
      
      // Remove any existing copy buttons from this element
      const existingButtons = preElement.querySelectorAll('.code-copy-button, button[title*="copy" i], button[aria-label*="copy" i], .copy-button, .copy-btn, .btn-copy');
      existingButtons.forEach(btn => btn.remove());
      
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
      copyButton.setAttribute('aria-label', 'Copy code to clipboard');
      
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
          console.warn('📝 Failed to copy code:', err);
          
          // Fallback for browsers that don't support clipboard API
          const textArea = document.createElement('textarea');
          textArea.value = codeText;
          textArea.style.position = 'fixed';
          textArea.style.left = '-999999px';
          textArea.style.top = '-999999px';
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          
          try {
            const success = document.execCommand('copy');
            if (success) {
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
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2 2v1"></path>
                  </svg>
                  <span class="copy-text">Copy</span>
                `;
                copyButton.classList.remove('copied');
              }, 2000);
            }
          } catch (fallbackErr) {
            console.error('📝 Fallback copy also failed:', fallbackErr);
          } finally {
            document.body.removeChild(textArea);
          }
        }
      });
      
      // Ensure the pre element is positioned relatively for button positioning  
      const computedStyle = window.getComputedStyle(preElement);
      if (computedStyle.position === 'static') {
        (preElement as HTMLElement).style.position = 'relative';
      }
      
      // Add button directly to the pre element
      preElement.appendChild(copyButton);
      console.log(`📝 Added copy button to pre element ${index + 1}`);
    });
    
    // Process inline code elements
    Array.from(allInlineCodeElements).forEach((codeElement, index) => {
      // Skip if this code element already has our copy button
      if (codeElement.querySelector('.inline-code-copy-button')) {
        return;
      }
      
      const codeText = codeElement.textContent || '';
      if (!codeText.trim()) {
        return;
      }
      
      console.log(`📝 Processing inline code element ${index + 1} with ${codeText.length} characters`);
      
      // Create copy button for inline code
      const copyButton = document.createElement('button');
      copyButton.className = 'inline-code-copy-button';
      copyButton.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
      `;
      copyButton.title = 'Copy code to clipboard';
      copyButton.setAttribute('aria-label', 'Copy code to clipboard');
      
      // Add click handler for copy functionality
      copyButton.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        try {
          await navigator.clipboard.writeText(codeText);
          
          // Update button to show success
          copyButton.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20,6 9,17 4,12"></polyline>
            </svg>
          `;
          copyButton.classList.add('copied');
          
          // Reset after 1.5 seconds (shorter for inline)
          setTimeout(() => {
            copyButton.innerHTML = `
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2 2v1"></path>
              </svg>
            `;
            copyButton.classList.remove('copied');
          }, 1500);
          
        } catch (err) {
          console.warn('📝 Failed to copy inline code:', err);
          
          // Fallback for browsers that don't support clipboard API
          const textArea = document.createElement('textarea');
          textArea.value = codeText;
          textArea.style.position = 'fixed';
          textArea.style.left = '-999999px';
          textArea.style.top = '-999999px';
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          
          try {
            const success = document.execCommand('copy');
            if (success) {
              copyButton.innerHTML = `
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="20,6 9,17 4,12"></polyline>
                </svg>
              `;
              copyButton.classList.add('copied');
              
              setTimeout(() => {
                copyButton.innerHTML = `
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2 2v1"></path>
                  </svg>
                `;
                copyButton.classList.remove('copied');
              }, 1500);
            }
          } catch (fallbackErr) {
            console.error('📝 Fallback copy also failed:', fallbackErr);
          } finally {
            document.body.removeChild(textArea);
          }
        }
      });
      
      // Wrap the code element in a relative container if needed
      const computedStyle = window.getComputedStyle(codeElement);
      if (computedStyle.position === 'static') {
        codeElement.style.position = 'relative';
      }
      
      // Ensure there's space for the button
      const currentPadding = computedStyle.paddingRight;
      const paddingValue = parseInt(currentPadding, 10) || 4;
      if (paddingValue < 24) { // Need at least 24px for the button
        codeElement.style.paddingRight = '24px';
      }
      
      // Add button to the code element
      codeElement.appendChild(copyButton);
      console.log(`📝 Added copy button to inline code element ${index + 1}`);
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
              </div>
              <small>
                Last updated: {new Date(activeTab.content.lastFetched).toLocaleString()}
              </small>
            </div>
            
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
  docsContentHtml: css({
    padding: theme.spacing(3),
    overflow: 'auto',
    flex: 1,
    lineHeight: 1.6,
    fontSize: theme.typography.body.fontSize,
    
    // Basic HTML elements styling
    '& h1, & h2, & h3, & h4, & h5, & h6': {
      color: theme.colors.text.primary,
      fontWeight: theme.typography.fontWeightMedium,
      marginBottom: theme.spacing(2),
      marginTop: theme.spacing(3),
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
      marginTop: theme.spacing(4),
    },
    
    '& h3': {
      fontSize: theme.typography.h4.fontSize,
      marginTop: theme.spacing(3),
    },
    
    '& h4': {
      fontSize: theme.typography.h5.fontSize,
      marginTop: theme.spacing(2),
    },
    
    '& p': {
      marginBottom: theme.spacing(2),
      lineHeight: 1.7,
      color: theme.colors.text.primary,
      wordWrap: 'break-word',
      overflowWrap: 'break-word',
    },
    
    '& ul, & ol': {
      marginBottom: theme.spacing(2),
      paddingLeft: theme.spacing(3),
      
      '& li': {
        marginBottom: theme.spacing(1),
        lineHeight: 1.6,
      },
    },
    
    // Images - responsive and well-styled with lightbox cursor
    '& img': {
      maxWidth: '100%',
      height: 'auto',
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
      margin: `${theme.spacing(2)} auto`,
      display: 'block',
      boxShadow: theme.shadows.z1,
      transition: 'all 0.2s ease',
      cursor: 'zoom-in',
      
      '&:hover': {
        boxShadow: theme.shadows.z2,
        transform: 'scale(1.02)',
        borderColor: theme.colors.primary.main,
      },
    },

    // Responsive iframe styling
    '& iframe.journey-iframe': {
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      boxShadow: theme.shadows.z1,
    },

    // General iframe responsiveness
    '& iframe.journey-general-iframe': {
      maxWidth: '100%',
      height: 'auto',
      minHeight: '200px',
      margin: `${theme.spacing(2)} auto`,
      display: 'block',
    },

    // Video iframe wrapper for maintaining aspect ratio
    '& .journey-iframe-wrapper.journey-video-wrapper': {
      position: 'relative',
      width: '100%',
      maxWidth: '100%',
      margin: `${theme.spacing(2)} auto`,
      paddingBottom: '56.25%', // 16:9 aspect ratio (9/16 * 100%)
      height: 0,
      overflow: 'hidden',
      borderRadius: theme.shape.radius.default,
      boxShadow: theme.shadows.z1,
    },

    // Video iframe positioned absolutely within wrapper
    '& .journey-video-wrapper iframe.journey-video-iframe': {
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      border: 'none',
      borderRadius: theme.shape.radius.default,
    },
    
    // Inline code styling
    '& code:not(pre code)': {
      position: 'relative',
      backgroundColor: theme.colors.background.canvas,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: '3px',
      padding: `2px 4px`,
      paddingRight: '24px', // Space for copy button
      fontFamily: theme.typography.fontFamilyMonospace,
      fontSize: '0.9em',
      color: theme.colors.text.primary,
      fontWeight: theme.typography.fontWeightMedium,
      wordBreak: 'break-word',
      overflowWrap: 'break-word',
      whiteSpace: 'nowrap',
      display: 'inline-block',
      maxWidth: '100%',
      verticalAlign: 'baseline',
    },
    
    // Code blocks with copy button support
    '& pre': {
      position: 'relative',
      backgroundColor: theme.colors.background.canvas,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      margin: `${theme.spacing(2)} 0`,
      padding: `${theme.spacing(2)} ${theme.spacing(10)} ${theme.spacing(2)} ${theme.spacing(2)}`, // Extra right padding for copy button
      overflow: 'auto',
      fontFamily: theme.typography.fontFamilyMonospace,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: 1.5,
      color: theme.colors.text.primary,
      wordBreak: 'break-all',
      whiteSpace: 'pre-wrap',
      overflowWrap: 'break-word',
      
      '& code': {
        backgroundColor: 'transparent',
        padding: 0,
        border: 'none',
        borderRadius: 0,
        fontFamily: 'inherit',
        fontSize: 'inherit',
        color: 'inherit',
        fontWeight: 'inherit',
      },
      
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
    
    // Code block copy button
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
    
    // Inline code copy button
    '& .inline-code-copy-button': {
      position: 'absolute',
      top: '50%',
      right: '2px',
      transform: 'translateY(-50%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '16px',
      height: '16px',
      padding: '2px',
      backgroundColor: theme.colors.background.secondary,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: '2px',
      color: theme.colors.text.secondary,
      fontSize: '10px',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      zIndex: 2,
      opacity: 0.7,
      
      '&:hover': {
        backgroundColor: theme.colors.action.hover,
        borderColor: theme.colors.border.medium,
        color: theme.colors.text.primary,
        opacity: 1,
        transform: 'translateY(-50%) scale(1.1)',
      },
      
      '&:active': {
        transform: 'translateY(-50%) scale(1)',
      },
      
      '&.copied': {
        backgroundColor: theme.colors.success.main,
        borderColor: theme.colors.success.border,
        color: theme.colors.success.contrastText,
        opacity: 1,
        
        '&:hover': {
          backgroundColor: theme.colors.success.main,
          borderColor: theme.colors.success.border,
          color: theme.colors.success.contrastText,
        },
      },
      
      '& svg': {
        flexShrink: 0,
        width: '12px',
        height: '12px',
      },
    },
    
    // Admonitions
    '& .admonition': {
      margin: `${theme.spacing(2)} 0`,
      padding: theme.spacing(2),
      backgroundColor: theme.colors.background.canvas,
      borderRadius: theme.shape.radius.default,
      border: `2px solid ${theme.colors.primary.main}`,
      fontSize: theme.typography.bodySmall.fontSize,
      
      '& .title': {
        fontSize: theme.typography.bodySmall.fontSize,
        fontWeight: theme.typography.fontWeightBold,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        marginBottom: theme.spacing(1),
        marginTop: 0,
      },
      
      '& p:not(.title)': {
        margin: `${theme.spacing(0.5)} 0`,
        fontSize: theme.typography.bodySmall.fontSize,
        lineHeight: 1.4,
        
        '&:last-child': {
          marginBottom: 0,
        },
      },
      
      // Remove default styling from blockquotes inside admonitions
      '& blockquote': {
        margin: 0,
        padding: 0,
        border: 'none',
        borderLeft: 'none',
        backgroundColor: 'transparent',
        borderRadius: 0,
        fontSize: 'inherit',
      },
    },
    
    // Standalone blockquotes (not inside admonitions)
    '& blockquote:not(.admonition blockquote)': {
      margin: `${theme.spacing(2)} 0`,
      padding: theme.spacing(2),
      borderLeft: `4px solid ${theme.colors.border.medium}`,
      backgroundColor: theme.colors.background.secondary,
      borderRadius: theme.shape.radius.default,
      fontSize: theme.typography.bodySmall.fontSize,
      fontStyle: 'italic',
      color: theme.colors.text.secondary,
    },
    
    // Specific admonition types
    '& .admonition-note': {
      borderColor: theme.colors.info.main,
      backgroundColor: theme.colors.info.transparent,
      
      '& .title': {
        color: theme.colors.info.main,
        
        '&:before': {
          content: '"ℹ️ "',
        },
      },
    },
    
    '& .admonition-warning, & .admonition-caution': {
      borderColor: theme.colors.warning.main,
      backgroundColor: theme.colors.warning.transparent,
      
      '& .title': {
        color: theme.colors.warning.main,
        
        '&:before': {
          content: '"⚠️ "',
        },
      },
    },
    
    '& .admonition-tip': {
      borderColor: theme.colors.success.main,
      backgroundColor: theme.colors.success.transparent,
      
      '& .title': {
        color: theme.colors.success.main,
        
        '&:before': {
          content: '"💡 "',
        },
      },
    },
    
    // Tables
    '& table': {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: theme.typography.body.fontSize,
      lineHeight: 1.5,
      margin: `${theme.spacing(2)} 0`,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      overflow: 'hidden',
      
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
          
          '& p': {
            margin: `${theme.spacing(0.5)} 0`,
            
            '&:first-child': {
              marginTop: 0,
            },
            
            '&:last-child': {
              marginBottom: 0,
            },
          },
          
          '& ul, & ol': {
            margin: `${theme.spacing(0.5)} 0`,
            paddingLeft: theme.spacing(2.5),
          },
          
          '& code': {
            backgroundColor: theme.colors.background.canvas,
            border: `1px solid ${theme.colors.border.weak}`,
            borderRadius: '2px',
            padding: '2px 4px',
            fontSize: '0.9em',
            fontFamily: theme.typography.fontFamilyMonospace,
          },
        },
      },
    },
    
    // Links
    '& a': {
      color: theme.colors.primary.main,
      textDecoration: 'none',
      '&:hover': {
        textDecoration: 'underline',
      },
    },
    
    // Mobile responsive adjustments
    '@media (max-width: 768px)': {
      '& img': {
        margin: `${theme.spacing(1)} auto`,
      },

      // Mobile iframe adjustments
      '& .journey-iframe-wrapper.journey-video-wrapper': {
        margin: `${theme.spacing(1.5)} auto`,
        paddingBottom: '56.25%',
      },

      '& iframe.journey-general-iframe': {
        margin: `${theme.spacing(1.5)} auto`,
        minHeight: '180px',
      },
      
      '& .code-copy-button': {
        padding: `${theme.spacing(0.5)} ${theme.spacing(0.75)}`,
        minWidth: '60px',
        fontSize: '11px',
      },
      
      '& pre': {
        paddingRight: theme.spacing(8),
        fontSize: '13px',
      },
    },
    
    '@media (max-width: 480px)': {
      // Very small mobile iframe adjustments
      '& .journey-iframe-wrapper.journey-video-wrapper': {
        margin: `${theme.spacing(1)} auto`,
        paddingBottom: '62.5%',
      },

      '& iframe.journey-general-iframe': {
        margin: `${theme.spacing(1)} auto`,
        minHeight: '150px',
      },

      '& .code-copy-button': {
        padding: theme.spacing(0.5),
        minWidth: '32px',
        top: theme.spacing(0.5),
        right: theme.spacing(0.5),
        
        '& .copy-text': {
          display: 'none',
        },
      },
      
      '& pre': {
        paddingRight: theme.spacing(6),
        fontSize: '12px',
        padding: `${theme.spacing(1.5)} ${theme.spacing(6)} ${theme.spacing(1.5)} ${theme.spacing(1.5)}`,
      },
    },
  }),
});

// Add global styles for image modals when component mounts
const addGlobalModalStyles = () => {
  const modalStyleId = 'journey-modal-styles';
  
  // Check if styles already exist
  if (document.getElementById(modalStyleId)) {
    return;
  }
  
  const style = document.createElement('style');
  style.id = modalStyleId;
  style.textContent = `
    /* Image Modal Styles - Simplified with theme integration */
    .journey-image-modal {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .journey-image-modal-backdrop {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: rgba(0, 0, 0, 0.85);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    
    .journey-image-modal-container {
      border-radius: 8px;
      overflow: hidden;
      max-width: 95vw;
      max-height: 95vh;
      position: relative;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      display: flex;
      flex-direction: column;
    }
    
    .journey-image-modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      flex-shrink: 0;
    }
    
    .journey-image-modal-title {
      margin: 0;
      font-size: 16px;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: calc(100% - 40px);
    }
    
    .journey-image-modal-close {
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px;
      border-radius: 4px;
      transition: all 0.2s ease;
      flex-shrink: 0;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .journey-image-modal-close:hover {
      opacity: 0.7;
    }
    
    .journey-image-modal-content {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      overflow: hidden;
      min-height: 0;
    }
    
    .journey-image-modal-image {
      width: auto;
      height: auto;
      object-fit: contain;
      border-radius: 4px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      transition: all 0.3s ease;
    }
    
    /* Mobile responsive adjustments */
    @media (max-width: 768px) {
      .journey-image-modal-container {
        max-width: 95vw !important;
        max-height: 95vh;
        margin: 10px;
      }
      
      .journey-image-modal-header {
        padding: 12px 16px;
      }
      
      .journey-image-modal-title {
        font-size: 14px;
        max-width: calc(100% - 32px);
      }
      
      .journey-image-modal-content {
        padding: 15px;
      }
      
      .journey-image-modal-close {
        width: 28px;
        height: 28px;
        padding: 2px;
      }
      
      .journey-image-modal-close svg {
        width: 18px;
        height: 18px;
      }
    }
    
    @media (max-width: 480px) {
      .journey-image-modal-backdrop {
        padding: 10px;
      }
      
      .journey-image-modal-container {
        max-width: 100vw !important;
        max-height: 100vh;
        margin: 0;
        border-radius: 0;
      }
      
      .journey-image-modal-header {
        padding: 10px 12px;
      }
      
      .journey-image-modal-title {
        font-size: 14px;
        max-width: calc(100% - 28px);
      }
      
      .journey-image-modal-content {
        padding: 10px;
      }
      
      .journey-image-modal-close {
        width: 24px;
        height: 24px;
        padding: 2px;
      }
      
      .journey-image-modal-close svg {
        width: 16px;
        height: 16px;
      }
    }
  `;
  
  document.head.appendChild(style);
};

export default SingleDocsPanel; 
