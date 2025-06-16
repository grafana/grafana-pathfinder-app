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
      console.log('🔧 About to call fetchLearningJourneyContent with URL:', url);
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
            console.log('🚀 Starting learning journey, navigating to first milestone:');
            console.log('🚀 First milestone URL:', firstMilestone.url);
            console.log('🚀 First milestone object:', firstMilestone);
            model.loadTabContent(activeTab.id, firstMilestone.url);
          }
        } else {
          console.warn('No milestones found to navigate to');
        }
      }

      // Handle side journey links
      const sideJourneyLink = target.closest('[data-side-journey-link]') as HTMLElement;
      
      if (sideJourneyLink) {
        event.preventDefault();
        event.stopPropagation();
        
        const linkUrl = sideJourneyLink.getAttribute('data-side-journey-url');
        const linkTitle = sideJourneyLink.getAttribute('data-side-journey-title');
        
        if (linkUrl) {
          console.log('🔗 Side journey link clicked:', { url: linkUrl, title: linkTitle });
          
          // All side journey links open in new browser tab for simplicity
          const fullUrl = linkUrl.startsWith('http') ? linkUrl : `https://grafana.com${linkUrl}`;
          window.open(fullUrl, '_blank', 'noopener,noreferrer');
        }
      }

      // Handle related journey links (open in new app tabs)
      const relatedJourneyLink = target.closest('[data-related-journey-link]') as HTMLElement;
      
      if (relatedJourneyLink) {
        event.preventDefault();
        event.stopPropagation();
        
        const linkUrl = relatedJourneyLink.getAttribute('data-related-journey-url');
        const linkTitle = relatedJourneyLink.getAttribute('data-related-journey-title');
        
        if (linkUrl) {
          console.log('🔗 Related journey link clicked:', { url: linkUrl, title: linkTitle });
          
          // Related journey links open in new app tabs (learning journeys)
          const fullUrl = linkUrl.startsWith('http') ? linkUrl : `https://grafana.com${linkUrl}`;
          model.openLearningJourney(fullUrl, linkTitle || 'Related Journey');
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

  // Process code snippets and add copy buttons for both journey and docs content
  useEffect(() => {
    const contentElement = contentRef.current;
    if (!contentElement) return;

    // Target both code blocks (pre) and inline code elements
    const codeBlockSelectors = [
      'pre.journey-code-block',      // Learning journey code blocks
      'pre.docs-code-snippet',       // Single docs code blocks  
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
        console.debug(`Selector "${selector}" not supported, skipping`);
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
        console.log(`📝 Pre element ${index + 1} already has copy button, skipping`);
        return;
      }
      
      // Must contain code to be processed
      const codeElement = preElement.querySelector('code') || preElement;
      const codeText = codeElement.textContent || '';
      if (!codeText.trim()) {
        console.log(`📝 Pre element ${index + 1} has no code text, skipping`);
        return;
      }
      
      console.log(`📝 Processing pre element ${index + 1}:`, {
        classes: preElement.className,
        hasCode: !!preElement.querySelector('code'),
        codeLength: codeText.length,
        selector: Array.from(preElement.classList).find(c => 
          c.includes('journey-code-block') || 
          c.includes('docs-code-snippet') || 
          c.includes('language-')
        ) || 'generic'
      });
      
      // Remove any existing copy buttons from this element
      const existingButtons = preElement.querySelectorAll('.code-copy-button, button[title*="copy" i], button[aria-label*="copy" i], .copy-button, .copy-btn, .btn-copy');
      existingButtons.forEach(btn => {
        console.log('📝 Removing existing copy button:', btn.className);
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
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
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
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                  <span class="copy-text">Copy</span>
                `;
                copyButton.classList.remove('copied');
              }, 2000);
            } else {
              console.error('📝 Fallback copy command failed');
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
      console.log(`📝 Added copy button to pre element ${index + 1} (${preElement.className || 'no classes'})`);
    });
    
    // Process inline code elements
    Array.from(allInlineCodeElements).forEach((codeElement, index) => {
      // Skip if this code element already has our copy button
      if (codeElement.querySelector('.inline-code-copy-button')) {
        console.log(`📝 Inline code element ${index + 1} already has copy button, skipping`);
        return;
      }
      
      const codeText = codeElement.textContent || '';
      if (!codeText.trim()) {
        console.log(`📝 Inline code element ${index + 1} has no text, skipping`);
        return;
      }
      
      console.log(`📝 Processing inline code element ${index + 1}:`, {
        text: codeText.substring(0, 50) + (codeText.length > 50 ? '...' : ''),
        length: codeText.length
      });
      
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
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
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
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
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
      const paddingValue = parseInt(currentPadding) || 4;
      if (paddingValue < 24) { // Need at least 24px for the button
        codeElement.style.paddingRight = '24px';
      }
      
      // Add button to the code element
      codeElement.appendChild(copyButton);
      console.log(`📝 Added copy button to inline code element ${index + 1}`);
    });
  }, [activeTab?.content, activeTab?.docsContent]);

  // Process collapsible sections and add toggle functionality
  useEffect(() => {
    const contentElement = contentRef.current;
    if (!contentElement) return;

    // Find all collapsible sections (including side journeys and related journeys)
    const collapsibleSections = contentElement.querySelectorAll('.journey-collapse');
    console.log(`📁 Found ${collapsibleSections.length} collapsible sections`);
    
    collapsibleSections.forEach((section) => {
      const trigger = section.querySelector('.journey-collapse-trigger') as HTMLElement;
      const content = section.querySelector('.journey-collapse-content') as HTMLElement;
      const icon = section.querySelector('.journey-collapse-icon') as HTMLElement;
      
      if (trigger && content) {
        // Remove any existing event listeners
        const newTrigger = trigger.cloneNode(true) as HTMLElement;
        trigger.parentNode?.replaceChild(newTrigger, trigger);
        
        // Add click handler
        newTrigger.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          
          const isExpanded = content.style.display !== 'none';
          
          if (isExpanded) {
            // Collapse
            content.style.display = 'none';
            if (icon) {
              icon.classList.remove('journey-collapse-icon-open');
            }
            console.log('📁 Collapsed section');
          } else {
            // Expand
            content.style.display = 'block';
            if (icon) {
              icon.classList.add('journey-collapse-icon-open');
            }
            console.log('📁 Expanded section');
          }
        });
        
        console.log('📁 Added collapse/expand functionality to section');
      }
    });
  }, [activeTab?.content, activeTab?.docsContent]);

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
    border: 'none', // Remove the outer border
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
      wordWrap: 'break-word', // Better handling of long words in paragraphs
      overflowWrap: 'break-word', // Ensure content doesn't overflow
    },
    
    '& ul, & ol': {
      marginBottom: theme.spacing(2),
      paddingLeft: theme.spacing(3),
      
      '& li': {
        marginBottom: theme.spacing(1),
        lineHeight: 1.6,
      },
    },
    
    // Images - responsive and well-styled
    '& img': {
      maxWidth: '100%',
      height: 'auto',
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
      margin: `${theme.spacing(2)} auto`,
      display: 'block',
      boxShadow: theme.shadows.z1,
      transition: 'all 0.2s ease',
      
      '&:hover': {
        boxShadow: theme.shadows.z2,
        transform: 'scale(1.02)',
        cursor: 'pointer',
      },
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
      wordBreak: 'break-all', // Allow breaking long lines
      whiteSpace: 'pre-wrap', // Preserve formatting but allow wrapping
      overflowWrap: 'break-word', // Better handling of long words
      
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
      borderLeft: `4px solid ${theme.colors.primary.main}`,
      backgroundColor: theme.colors.background.canvas,
      borderRadius: theme.shape.radius.default,
      border: `2px solid ${theme.colors.primary.main}`, // Blue border around the entire box
      fontSize: theme.typography.bodySmall.fontSize,
      
      '& .title': {
        fontSize: '11px',
        fontWeight: theme.typography.fontWeightBold,
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
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
      borderLeftColor: theme.colors.info.main,
      borderColor: theme.colors.info.main, // Override main border color
      backgroundColor: theme.colors.info.transparent,
      
      '& .title': {
        color: theme.colors.info.main,
        
        '&:before': {
          content: '"ℹ️ "',
        },
      },
    },
    
    '& .admonition-warning, & .admonition-caution': {
      borderLeftColor: theme.colors.warning.main,
      borderColor: theme.colors.warning.main, // Override main border color
      backgroundColor: theme.colors.warning.transparent,
      
      '& .title': {
        color: theme.colors.warning.main,
        
        '&:before': {
          content: '"⚠️ "',
        },
      },
    },
    
    '& .admonition-tip': {
      borderLeftColor: theme.colors.success.main,
      borderColor: theme.colors.success.main, // Override main border color
      backgroundColor: theme.colors.success.transparent,
      
      '& .title': {
        color: theme.colors.success.main,
        
        '&:before': {
          content: '"💡 "',
        },
      },
    },
    
    '& .admonition-did-you-know': {
      borderLeftColor: theme.colors.primary.main,
      borderColor: theme.colors.primary.main, // Keep blue for did-you-know
      backgroundColor: theme.colors.primary.transparent,
      
      '& .title': {
        color: theme.colors.primary.main,
        
        '&:before': {
          content: '"🤔 "',
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
    
    // Collapsible sections
    '& .journey-collapse': {
      margin: `${theme.spacing(2)} 0`,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      backgroundColor: theme.colors.background.secondary,
      overflow: 'hidden',
    },
    
    '& .journey-collapse-trigger': {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '100%',
      padding: theme.spacing(2),
      backgroundColor: 'transparent',
      border: 'none',
      cursor: 'pointer',
      fontSize: theme.typography.body.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
      textAlign: 'left',
      transition: 'background-color 0.2s ease',
      
      '&:hover': {
        backgroundColor: theme.colors.action.hover,
      },
      
      '&:focus': {
        outline: `2px solid ${theme.colors.primary.main}`,
        outlineOffset: '-2px',
      },
    },
    
    '& .journey-collapse-icon': {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'transform 0.3s ease',
      
      '& svg': {
        width: '20px',
        height: '20px',
        transform: 'rotate(0deg)',
        transition: 'transform 0.3s ease',
      },
      
      '&.journey-collapse-icon-open svg': {
        transform: 'rotate(45deg)',
      },
    },
    
    '& .journey-collapse-content': {
      borderTop: `1px solid ${theme.colors.border.weak}`,
      backgroundColor: theme.colors.background.primary,
      
      '&[style*="display: none"]': {
        display: 'none !important',
      },
      
      '&[style*="display: block"]': {
        display: 'block !important',
      },
    },
    
    '& .journey-collapse-content-inner': {
      padding: theme.spacing(2),
      
      '& p': {
        margin: `${theme.spacing(1)} 0`,
        
        '&:first-child': {
          marginTop: 0,
        },
        
        '&:last-child': {
          marginBottom: 0,
        },
      },
      
      '& ul, & ol': {
        margin: `${theme.spacing(1)} 0`,
        paddingLeft: theme.spacing(3),
        
        '& li': {
          margin: `${theme.spacing(0.5)} 0`,
        },
      },
      
      '& img': {
        maxWidth: '100%',
        height: 'auto',
        margin: `${theme.spacing(2)} 0`,
        borderRadius: theme.shape.radius.default,
        border: `1px solid ${theme.colors.border.weak}`,
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
    
    // Start journey section styling
    '& .journey-start-section': {
      textAlign: 'center',
      margin: `${theme.spacing(4)} 0`,
      padding: `${theme.spacing(3)} ${theme.spacing(2)}`,
      borderTop: `1px solid ${theme.colors.border.weak}`,
      
      '& h3': {
        margin: `0 0 ${theme.spacing(2)} 0`,
        fontSize: theme.typography.h4.fontSize,
        fontWeight: theme.typography.fontWeightMedium,
        color: theme.colors.text.primary,
      },
    },
    
    '& .journey-start-container': {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: theme.spacing(2),
    },
    
    // Start journey button styling
    '& .journey-start-button, & [data-journey-start="true"]': {
      display: 'inline-block',
      padding: `${theme.spacing(1.5)} ${theme.spacing(3)}`,
      backgroundColor: theme.colors.primary.main,
      color: theme.colors.primary.contrastText,
      borderRadius: theme.shape.radius.default,
      fontWeight: theme.typography.fontWeightMedium,
      textDecoration: 'none',
      margin: 0, // Remove default margin since we're using flexbox gap
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
    
    // Journey conclusion image styling
    '& .journey-conclusion-image': {
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      margin: `0 0 ${theme.spacing(3)} 0`,
    },
    
    '& .journey-conclusion-header': {
      maxWidth: '100%',
      height: 'auto',
      maxHeight: '120px', // Limit height for sidebar
      width: 'auto',
      display: 'block',
    },
    
    // Side journeys section styling - collapsible milestone-style design
    '& .journey-side-journeys-section': {
      marginTop: theme.spacing(4),
      marginBottom: theme.spacing(2),
    },
    
    '& .journey-side-journeys-collapse': {
      backgroundColor: theme.colors.background.canvas,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      overflow: 'hidden',
      
      // Use chevron (down arrow) instead of plus icon for side journeys
      '& .journey-collapse-icon': {
        color: theme.colors.text.secondary,
        transition: 'transform 0.3s ease',
        flexShrink: 0,
        
        '& svg': {
          width: '16px',
          height: '16px',
          transform: 'rotate(0deg)',
          transition: 'transform 0.3s ease',
        },
      },
      
      // When expanded, rotate the chevron
      '&:has(.journey-side-journeys-content[style*="display: block"]) .journey-collapse-icon svg': {
        transform: 'rotate(180deg)',
      },
    },
    
    '& .journey-side-journeys-trigger': {
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: theme.spacing(2),
      backgroundColor: 'transparent',
      border: 'none',
      cursor: 'pointer',
      transition: 'background-color 0.2s ease',
      
      '&:hover': {
        backgroundColor: theme.colors.action.hover,
      },
      
      '&:focus': {
        outline: `2px solid ${theme.colors.primary.main}`,
        outlineOffset: '-2px',
      },
    },
    
    '& .journey-side-journeys-title': {
      fontSize: theme.typography.h6.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
      textAlign: 'left',
      flex: 1,
      minWidth: 0,
    },
    
    '& .journey-side-journeys-content': {
      backgroundColor: theme.colors.background.primary,
      borderTop: `1px solid ${theme.colors.border.weak}`,
      
      '&[style*="display: none"]': {
        display: 'none !important',
      },
      
      '&[style*="display: block"]': {
        display: 'block !important',
      },
    },
    
    '& .journey-side-journeys-list': {
      padding: theme.spacing(1, 0),
      display: 'flex',
      flexDirection: 'column',
    },
    
    '& .journey-side-journey-item': {
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(2),
      padding: theme.spacing(1.5, 2),
      textDecoration: 'none',
      color: theme.colors.text.primary,
      transition: 'all 0.2s ease',
      borderBottom: `1px solid ${theme.colors.border.weak}`,
      
      '&:last-child': {
        borderBottom: 'none',
      },
      
      '&:hover': {
        backgroundColor: theme.colors.action.hover,
        textDecoration: 'none',
        
        '& .journey-side-journey-external-icon': {
          opacity: 1,
          transform: 'translate(2px, -2px)',
        },
      },
      
      '&:focus': {
        outline: `2px solid ${theme.colors.primary.main}`,
        outlineOffset: '-2px',
        backgroundColor: theme.colors.action.focus,
      },
    },
    
    '& .journey-side-journey-icon-circle': {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '32px',
      height: '32px',
      borderRadius: '50%',
      backgroundColor: theme.colors.primary.main,
      color: theme.colors.primary.contrastText,
      flexShrink: 0,
      
      '& svg': {
        width: '16px',
        height: '16px',
      },
    },
    
    '& .journey-side-journey-content': {
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(0.25),
    },
    
    '& .journey-side-journey-title': {
      fontSize: theme.typography.body.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
      lineHeight: 1.3,
      margin: 0,
    },
    
    '& .journey-side-journey-type': {
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
      fontWeight: theme.typography.fontWeightRegular,
      margin: 0,
    },
    
    '& .journey-side-journey-external-icon': {
      color: theme.colors.text.disabled,
      opacity: 0.6,
      flexShrink: 0,
      transition: 'all 0.2s ease',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
    
    // Related journeys section styling - for destination-reached milestone
    '& .journey-related-journeys-section': {
      marginTop: theme.spacing(3),
      marginBottom: theme.spacing(2),
    },
    
    '& .journey-related-journeys-collapse': {
      backgroundColor: theme.colors.background.canvas,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      overflow: 'hidden',
      
      // Use chevron (down arrow) for related journeys
      '& .journey-collapse-icon': {
        color: theme.colors.text.secondary,
        transition: 'transform 0.3s ease',
        flexShrink: 0,
        
        '& svg': {
          width: '16px',
          height: '16px',
          transform: 'rotate(0deg)',
          transition: 'transform 0.3s ease',
        },
      },
      
      // When expanded, rotate the chevron
      '&:has(.journey-related-journeys-content[style*="display: block"]) .journey-collapse-icon svg': {
        transform: 'rotate(180deg)',
      },
    },
    
    '& .journey-related-journeys-trigger': {
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: theme.spacing(2),
      backgroundColor: 'transparent',
      border: 'none',
      cursor: 'pointer',
      transition: 'background-color 0.2s ease',
      
      '&:hover': {
        backgroundColor: theme.colors.action.hover,
      },
      
      '&:focus': {
        outline: `2px solid ${theme.colors.primary.main}`,
        outlineOffset: '-2px',
      },
    },
    
    '& .journey-related-journeys-title': {
      fontSize: theme.typography.h6.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
      textAlign: 'left',
      flex: 1,
      minWidth: 0,
    },
    
    '& .journey-related-journeys-content': {
      backgroundColor: theme.colors.background.primary,
      borderTop: `1px solid ${theme.colors.border.weak}`,
      
      '&[style*="display: none"]': {
        display: 'none !important',
      },
      
      '&[style*="display: block"]': {
        display: 'block !important',
      },
    },
    
    '& .journey-related-journeys-list': {
      padding: theme.spacing(1, 0),
      display: 'flex',
      flexDirection: 'column',
    },
    
    '& .journey-related-journey-item': {
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(2),
      padding: theme.spacing(1.5, 2),
      textDecoration: 'none',
      color: theme.colors.text.primary,
      transition: 'all 0.2s ease',
      borderBottom: `1px solid ${theme.colors.border.weak}`,
      
      '&:last-child': {
        borderBottom: 'none',
      },
      
      '&:hover': {
        backgroundColor: theme.colors.action.hover,
        textDecoration: 'none',
        
        '& .journey-related-journey-external-icon': {
          opacity: 1,
          transform: 'translate(2px, -2px)',
        },
      },
      
      '&:focus': {
        outline: `2px solid ${theme.colors.primary.main}`,
        outlineOffset: '-2px',
        backgroundColor: theme.colors.action.focus,
      },
    },
    
    '& .journey-related-journey-icon-circle': {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '32px',
      height: '32px',
      borderRadius: '50%',
      backgroundColor: theme.colors.secondary.main, // Different color to distinguish from side journeys
      color: theme.colors.secondary.contrastText,
      flexShrink: 0,
      
      '& svg': {
        width: '16px',
        height: '16px',
      },
    },
    
    '& .journey-related-journey-content': {
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(0.25),
    },
    
    '& .journey-related-journey-title': {
      fontSize: theme.typography.body.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
      lineHeight: 1.3,
      margin: 0,
    },
    
    '& .journey-related-journey-type': {
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
      fontWeight: theme.typography.fontWeightRegular,
      margin: 0,
    },
    
    '& .journey-related-journey-external-icon': {
      color: theme.colors.text.disabled,
      opacity: 0.6,
      flexShrink: 0,
      transition: 'all 0.2s ease',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
    
    // Mobile responsive adjustments
    '@media (max-width: 768px)': {
      '& img': {
        margin: `${theme.spacing(1)} auto`,
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
      
      // Side journeys tablet adjustments
      '& .journey-side-journeys-section': {
        marginTop: theme.spacing(3),
      },
      
      '& .journey-side-journeys-title': {
        fontSize: theme.typography.h5.fontSize,
      },
      
      '& .journey-side-journey-item': {
        padding: theme.spacing(1.25, 1.5),
        gap: theme.spacing(1.5),
      },
      
      '& .journey-side-journey-icon-circle': {
        width: '28px',
        height: '28px',
        
        '& svg': {
          width: '14px',
          height: '14px',
        },
      },
      
      // Conclusion image tablet adjustments
      '& .journey-conclusion-image': {
        margin: `0 0 ${theme.spacing(2)} 0`,
      },
      
      '& .journey-conclusion-header': {
        maxHeight: '100px',
      },
      
      // Related journeys tablet adjustments
      '& .journey-related-journeys-section': {
        marginTop: theme.spacing(2),
      },
      
      '& .journey-related-journeys-title': {
        fontSize: theme.typography.h5.fontSize,
      },
      
      '& .journey-related-journey-item': {
        padding: theme.spacing(1.25, 1.5),
        gap: theme.spacing(1.5),
      },
      
      '& .journey-related-journey-icon-circle': {
        width: '28px',
        height: '28px',
        
        '& svg': {
          width: '14px',
          height: '14px',
        },
      },
    },
    
    '@media (max-width: 480px)': {
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
      
      // Side journeys mobile adjustments
      '& .journey-side-journeys-section': {
        marginTop: theme.spacing(2),
      },
      
      '& .journey-side-journeys-title': {
        fontSize: theme.typography.bodySmall.fontSize,
      },
      
      '& .journey-side-journey-item': {
        padding: theme.spacing(1, 1.5),
        gap: theme.spacing(1),
      },
      
      '& .journey-side-journey-icon-circle': {
        width: '24px',
        height: '24px',
        
        '& svg': {
          width: '12px',
          height: '12px',
        },
      },
      
      // Related journeys mobile adjustments
      '& .journey-related-journeys-section': {
        marginTop: theme.spacing(1.5),
      },
      
      '& .journey-related-journeys-title': {
        fontSize: theme.typography.bodySmall.fontSize,
      },
      
      '& .journey-related-journey-item': {
        padding: theme.spacing(1, 1.5),
        gap: theme.spacing(1),
      },
      
      '& .journey-related-journey-icon-circle': {
        width: '24px',
        height: '24px',
        
        '& svg': {
          width: '12px',
          height: '12px',
        },
      },
      
      // Conclusion image mobile adjustments
      '& .journey-conclusion-image': {
        margin: `0 0 ${theme.spacing(1.5)} 0`,
      },
      
      '& .journey-conclusion-header': {
        maxHeight: '80px',
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
    border: 'none', // Remove the outer border
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
    
    // Reuse the same styles as journeyContentHtml since we're dealing with the same raw HTML structure
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
    },
    
    '& h3': {
      fontSize: theme.typography.h4.fontSize,
    },
    
    '& p': {
      marginBottom: theme.spacing(2),
      lineHeight: 1.7,
      wordWrap: 'break-word', // Better handling of long words in paragraphs
      overflowWrap: 'break-word', // Ensure content doesn't overflow
    },
    
    '& ul, & ol': {
      marginBottom: theme.spacing(2),
      paddingLeft: theme.spacing(3),
    },
    
    '& li': {
      marginBottom: theme.spacing(1),
    },
    
    '& img': {
      maxWidth: '100%',
      height: 'auto',
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
      margin: `${theme.spacing(2)} auto`,
      display: 'block',
      boxShadow: theme.shadows.z1,
    },
    
    '& code:not(pre code)': {
      position: 'relative',
      backgroundColor: theme.colors.background.canvas,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: '3px',
      padding: `2px 4px`,
      paddingRight: '24px',
      fontFamily: theme.typography.fontFamilyMonospace,
      fontSize: '0.9em',
      color: theme.colors.text.primary,
      fontWeight: theme.typography.fontWeightMedium,
      wordBreak: 'break-word', // Allow breaking but prefer word boundaries
      overflowWrap: 'break-word', // Better wrapping for long lines
      whiteSpace: 'nowrap', // Keep inline code on one line when possible
      display: 'inline-block', // Better control over line breaks
      maxWidth: '100%', // Prevent overflow
      verticalAlign: 'baseline', // Align properly with surrounding text
    },
    
    '& pre': {
      position: 'relative',
      backgroundColor: theme.colors.background.canvas,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      padding: `${theme.spacing(2)} ${theme.spacing(10)} ${theme.spacing(2)} ${theme.spacing(2)}`,
      margin: `${theme.spacing(2)} 0`,
      overflow: 'auto',
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: 1.5,
      wordBreak: 'break-all', // Allow breaking long lines
      whiteSpace: 'pre-wrap', // Preserve formatting but allow wrapping
      overflowWrap: 'break-word', // Better handling of long words
      
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
    },
    
    // Copy button styles (reused from journeyContentHtml)
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
    
    '& a': {
      color: theme.colors.primary.main,
      textDecoration: 'none',
      '&:hover': {
        textDecoration: 'underline',
      },
    },
    
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
    
    '& .admonition, & blockquote': {
      margin: `${theme.spacing(2)} 0`,
      padding: theme.spacing(2),
      borderLeft: `4px solid ${theme.colors.primary.main}`,
      backgroundColor: theme.colors.background.canvas,
      borderRadius: theme.shape.radius.default,
      border: `2px solid ${theme.colors.primary.main}`, // Blue border around the entire box
      fontSize: theme.typography.bodySmall.fontSize,
      
      '& .title': {
        fontSize: '11px',
        fontWeight: theme.typography.fontWeightBold,
        color: theme.colors.primary.main,
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        marginBottom: theme.spacing(1),
        
        '&:before': {
          content: '"ℹ️ "',
          marginRight: theme.spacing(0.5),
        },
      },
      
      '& p:not(.title)': {
        margin: `${theme.spacing(0.5)} 0`,
        fontSize: theme.typography.bodySmall.fontSize,
        lineHeight: 1.4,
        
        '&:last-child': {
          marginBottom: 0,
        },
      },
    },
    
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
