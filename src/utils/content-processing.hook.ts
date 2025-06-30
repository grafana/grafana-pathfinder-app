import { useEffect } from 'react';
import { LearningJourneyContent } from './docs-fetcher';
import { SingleDocsContent } from './single-docs-fetcher';

interface UseContentProcessingProps {
  contentRef: React.RefObject<HTMLDivElement>;
  activeTabContent?: LearningJourneyContent | null;
  activeTabDocsContent?: SingleDocsContent | null;
}

export function useContentProcessing({ 
  contentRef, 
  activeTabContent, 
  activeTabDocsContent 
}: UseContentProcessingProps) {

  // Process tables and add expand/collapse functionality
  useEffect(() => {
    const contentElement = contentRef.current;
    if (!contentElement) {return;}

    const expandTableButtons = contentElement.querySelectorAll('.expand-table-btn');
    
    expandTableButtons.forEach((button) => {
      if (button.hasAttribute('data-table-listener')) {return;}
      
      const expandWrapper = button.closest('.expand-table-wrapper');
      const tableWrapper = expandWrapper?.querySelector('.responsive-table-wrapper');
      
      if (tableWrapper) {
        tableWrapper.classList.remove('collapsed');
        button.classList.add('expanded');
        
        const handleClick = (e: Event) => {
          e.preventDefault();
          e.stopPropagation();
          
          const isExpanded = !tableWrapper.classList.contains('collapsed');
          
          if (isExpanded) {
            tableWrapper.classList.add('collapsed');
            button.classList.remove('expanded');
            button.textContent = 'Expand table';
          } else {
            tableWrapper.classList.remove('collapsed');
            button.classList.add('expanded');
            button.textContent = 'Collapse table';
          }
        };
        
        button.addEventListener('click', handleClick);
        button.setAttribute('data-table-listener', 'true');
        button.textContent = 'Collapse table';
      }
    });
  }, [activeTabContent, contentRef]);

  // Process code snippets and add copy buttons
  useEffect(() => {
    const contentElement = contentRef.current;
    if (!contentElement) {return;}

    const codeBlockSelectors = [
      'pre.journey-code-block',
      'pre.docs-code-snippet',
      'pre.journey-standalone-code',
      'pre.docs-standalone-code',
      'pre[class*="language-"]',
      'pre:has(code)',
      'pre'
    ];
    
    const allPreElements = new Set<HTMLPreElement>();
    const allInlineCodeElements = new Set<HTMLElement>();
    
    // Collect all unique pre elements
    codeBlockSelectors.forEach(selector => {
      try {
        const elements = contentElement.querySelectorAll(selector) as NodeListOf<HTMLPreElement>;
        elements.forEach(el => allPreElements.add(el));
      } catch (e) {
        // Skip selectors that don't work
      }
    });
    
    // Collect inline code elements (excluding those in pre blocks and standalone code blocks)
    const inlineCodeElements = contentElement.querySelectorAll('code') as NodeListOf<HTMLElement>;
    inlineCodeElements.forEach(codeEl => {
      if (!codeEl.closest('pre') && 
          !codeEl.classList.contains('docs-block-code') && 
          !codeEl.classList.contains('journey-block-code') && 
          codeEl.textContent && 
          codeEl.textContent.trim().length > 0) {
        allInlineCodeElements.add(codeEl);
      }
    });
    
    // Process pre elements (code blocks)
    Array.from(allPreElements).forEach((preElement, index) => {
      if (preElement.querySelector('.code-copy-button')) {
        return;
      }
      
      const codeElement = preElement.querySelector('code') || preElement;
      const codeText = codeElement.textContent || '';
      if (!codeText.trim()) {
        return;
      }
      
      // Remove existing copy buttons
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
      
      // Add click handler
      copyButton.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        try {
          await navigator.clipboard.writeText(codeText);
          
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
          
        } catch (err) {
          console.warn('Failed to copy code:', err);
          
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
            }
          } catch (fallbackErr) {
            console.error('Fallback copy also failed:', fallbackErr);
          } finally {
            document.body.removeChild(textArea);
          }
        }
      });
      
      // Ensure proper positioning
      const computedStyle = window.getComputedStyle(preElement);
      if (computedStyle.position === 'static') {
        (preElement as HTMLElement).style.position = 'relative';
      }
      
      preElement.appendChild(copyButton);
    });
    
    // Process inline code elements
    Array.from(allInlineCodeElements).forEach((codeElement, index) => {
      if (codeElement.querySelector('.inline-code-copy-button')) {
        return;
      }
      
      const codeText = codeElement.textContent || '';
      if (!codeText.trim()) {
        return;
      }
      
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
      
      // Add click handler
      copyButton.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        try {
          await navigator.clipboard.writeText(codeText);
          
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
          
        } catch (err) {
          console.warn('Failed to copy inline code:', err);
          
          // Fallback implementation
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
            console.error('Fallback copy also failed:', fallbackErr);
          } finally {
            document.body.removeChild(textArea);
          }
        }
      });
      
      // Ensure proper positioning and space
      const computedStyle = window.getComputedStyle(codeElement);
      if (computedStyle.position === 'static') {
        codeElement.style.position = 'relative';
      }
      
      const currentPadding = computedStyle.paddingRight;
      const paddingValue = parseInt(currentPadding, 10) || 4;
      if (paddingValue < 24) {
        codeElement.style.paddingRight = '24px';
      }
      
      codeElement.appendChild(copyButton);
    });
  }, [activeTabContent, activeTabDocsContent, contentRef]);

  // Process collapsible sections
  useEffect(() => {
    const contentElement = contentRef.current;
    if (!contentElement) {return;}

    const collapsibleSections = contentElement.querySelectorAll('.journey-collapse');
    
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
          } else {
            // Expand
            content.style.display = 'block';
            if (icon) {
              icon.classList.add('journey-collapse-icon-open');
            }
          }
        });
      }
    });
  }, [activeTabContent, activeTabDocsContent, contentRef]);

  // Process card grids for better accessibility and interactions
  useEffect(() => {
    const contentElement = contentRef.current;
    if (!contentElement) {return;}

    const cardGrids = contentElement.querySelectorAll('.card-content-grid');
    
    cardGrids.forEach((grid) => {
      // Add accessibility attributes
      grid.setAttribute('role', 'grid');
      grid.setAttribute('aria-label', 'Documentation topics');
      
      const cards = grid.querySelectorAll('.card');
      cards.forEach((card, index) => {
        // Add accessibility attributes to cards
        card.setAttribute('role', 'gridcell');
        card.setAttribute('tabindex', '0');
        
        const title = card.querySelector('.card-title')?.textContent || `Card ${index + 1}`;
        const description = card.querySelector('.card-description')?.textContent || '';
        card.setAttribute('aria-label', `${title}. ${description}`);
        
        // Add keyboard navigation
        if (!card.hasAttribute('data-card-listener')) {
          const handleKeyDown = (e: Event) => {
            const keyEvent = e as KeyboardEvent;
            if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
              e.preventDefault();
              (card as HTMLElement).click();
            }
          };
          
          card.addEventListener('keydown', handleKeyDown);
          card.setAttribute('data-card-listener', 'true');
        }
      });
    });
  }, [activeTabContent, activeTabDocsContent, contentRef]);

  // Process Grafana Play components for enhanced accessibility and lazy loading
  useEffect(() => {
    const contentElement = contentRef.current;
    if (!contentElement) {return;}

    // Handle lazy loading images
    const lazyImages = contentElement.querySelectorAll('.lazyload[data-src]');
    lazyImages.forEach((img) => {
      const imgElement = img as HTMLImageElement;
      const dataSrc = imgElement.getAttribute('data-src');
      
      if (dataSrc && !imgElement.src) {
        // Create intersection observer for lazy loading
        const observer = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              const target = entry.target as HTMLImageElement;
              const src = target.getAttribute('data-src');
              if (src) {
                target.src = src;
                target.removeAttribute('data-src');
                observer.unobserve(target);
              }
            }
          });
        }, {
          rootMargin: '50px',
          threshold: 0.1,
        });
        
        observer.observe(imgElement);
      }
    });

    // Enhance Grafana Play buttons with better interaction feedback
    const playButtons = contentElement.querySelectorAll('.btn--primary[href*="play.grafana.org"]');
    playButtons.forEach((button) => {
      if (!button.hasAttribute('data-play-enhanced')) {
        button.setAttribute('aria-label', 'Try this feature in Grafana Play (opens in new tab)');
        button.setAttribute('data-play-enhanced', 'true');
        
        // Add click analytics if needed (placeholder for future implementation)
        button.addEventListener('click', () => {
          console.log('Grafana Play button clicked:', button.getAttribute('href'));
        });
      }
    });

    // Enhance Grafana Play containers with proper semantic markup
    const playContainers = contentElement.querySelectorAll('.d-sm-flex.bg-gray-1');
    playContainers.forEach((container) => {
      if (!container.hasAttribute('data-play-container')) {
        container.setAttribute('role', 'region');
        container.setAttribute('aria-label', 'Try this feature with Grafana Play');
        container.setAttribute('data-play-container', 'true');
      }
    });
  }, [activeTabContent, activeTabDocsContent, contentRef]);
} 