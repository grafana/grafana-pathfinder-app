import { useEffect, useRef, useCallback } from 'react';
import { LearningJourneyContent } from './docs-fetcher';
import { SingleDocsContent } from './single-docs-fetcher';
import { useInteractiveElements } from './interactive.hook';
import { getDocsBaseUrl } from '../constants';
import { checkAllElementRequirements, waitForReactUpdates } from './requirements.util';
import { safeEventHandler } from './safe-event-handler.util';

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
  
  // Get the interactive elements functions
  const { checkElementRequirements } = useInteractiveElements();

  // Create a ref to store the requirement checking function so we can call it from other effects
  const recheckRequirementsRef = useRef<(() => Promise<void>) | null>(null);

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
          safeEventHandler(e, {
            preventDefault: true,
            stopPropagation: true,
          });
          
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
      'pre' // This will catch all remaining pre elements including new plain ones
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
      
      // Ensure pre element has proper styling class if it doesn't already have one
      if (!preElement.classList.contains('journey-code-block') && 
          !preElement.classList.contains('docs-code-snippet') && 
          !preElement.classList.contains('journey-standalone-code') && 
          !preElement.classList.contains('docs-standalone-code') &&
          !preElement.className.includes('language-')) {
        // Add appropriate class based on content type
        if (activeTabContent && activeTabContent.content) {
          preElement.classList.add('journey-code-block');
        } else if (activeTabDocsContent && activeTabDocsContent.content) {
          preElement.classList.add('docs-code-snippet');
        } else {
          // Default fallback
          preElement.classList.add('docs-code-snippet');
        }
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
        safeEventHandler(e, {
          preventDefault: true,
          stopPropagation: true,
        });
        
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
            // Fallback for older browsers - execCommand is deprecated but still needed for compatibility
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
        safeEventHandler(e, {
          preventDefault: true,
          stopPropagation: true,
        });
        
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
            // Fallback for older browsers - execCommand is deprecated but still needed for compatibility
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
          safeEventHandler(e, {
            preventDefault: true,
            stopPropagation: true,
          });
          
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
              safeEventHandler(e, { preventDefault: true });
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

    // Handle lazy loading videos and ensure proper rendering
    const lazyVideos = contentElement.querySelectorAll('video.lazyload, video[data-src], video[src]');
    lazyVideos.forEach((video) => {
      const videoElement = video as HTMLVideoElement;
      const dataSrc = videoElement.getAttribute('data-src');
      const currentSrc = videoElement.getAttribute('src');
      const originalSrc = dataSrc || currentSrc;
      
      // Fix video URL to use proper docs base URL (similar to image handling)
      if (originalSrc) {
        const fixedSrc = originalSrc.startsWith('http') || originalSrc.startsWith('data:') 
          ? originalSrc
          : originalSrc.startsWith('/') 
            ? `${getDocsBaseUrl()}${originalSrc}`
            : originalSrc.startsWith('./') 
              ? `${getDocsBaseUrl()}/docs/${originalSrc.substring(2)}`
              : originalSrc.startsWith('../') 
                ? `${getDocsBaseUrl()}/docs/${originalSrc.replace(/^\.\.\//, '')}`
                : `${getDocsBaseUrl()}/docs/${originalSrc}`;
        
        // If video has data-src, set up lazy loading
        if (dataSrc && !videoElement.src) {
          videoElement.setAttribute('data-src', fixedSrc);
          
          const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting) {
                const target = entry.target as HTMLVideoElement;
                const src = target.getAttribute('data-src');
                if (src) {
                  target.src = src;
                  target.removeAttribute('data-src');
                  target.load(); // Reload video with new source
                  observer.unobserve(target);
                }
              }
            });
          }, {
            rootMargin: '100px', // Larger margin for videos to preload
            threshold: 0.1,
          });
          
          observer.observe(videoElement);
        } else {
          // Set the fixed src directly
          videoElement.src = fixedSrc;
          videoElement.load();
        }
      }
      
      // Add accessibility and UX improvements
      if (!videoElement.hasAttribute('data-video-enhanced')) {
        // Ensure proper accessibility attributes
        if (!videoElement.getAttribute('aria-label') && !videoElement.getAttribute('title')) {
          const videoTitle = videoElement.getAttribute('alt') || 
                           videoElement.getAttribute('data-title') || 
                           'Documentation video';
          videoElement.setAttribute('aria-label', videoTitle);
        }
        
        // Add keyboard navigation support
        videoElement.setAttribute('tabindex', '0');
        
        // Handle video loading errors gracefully
        const handleVideoError = () => {
          console.warn('Video failed to load:', videoElement.src || videoElement.getAttribute('data-src'));
          
          // Create fallback message
          const fallback = document.createElement('div');
          fallback.className = 'video-error-fallback';
          fallback.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            background-color: #f5f5f5;
            border: 1px solid #ddd;
            border-radius: 4px;
            min-height: 200px;
            padding: 20px;
            text-align: center;
            color: #666;
          `;
          fallback.innerHTML = `
            <div>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <polygon points="5,3 19,12 5,21 5,3"></polygon>
              </svg>
              <p>Video content unavailable</p>
              <p><small>Please check your connection or try refreshing the page</small></p>
            </div>
          `;
          
          // Replace video with fallback only if video becomes visible and fails
          const replaceWithFallback = () => {
            if (videoElement.offsetParent !== null) {
              videoElement.parentNode?.replaceChild(fallback, videoElement);
            }
          };
          
          // Delay replacement to avoid immediate replacement during loading
          setTimeout(replaceWithFallback, 2000);
        };
        
        videoElement.addEventListener('error', handleVideoError);
        
        // Add loading state handling
        const handleVideoLoad = () => {
          videoElement.style.opacity = '1';
        };
        
        const handleVideoLoadStart = () => {
          videoElement.style.opacity = '0.7';
        };
        
        videoElement.addEventListener('loadstart', handleVideoLoadStart);
        videoElement.addEventListener('canplay', handleVideoLoad);
        
        // Mark as enhanced to avoid duplicate processing
        videoElement.setAttribute('data-video-enhanced', 'true');
      }
    });

    // Handle video containers for better styling (using more compatible approach)
    const allVideos = contentElement.querySelectorAll('video');
    allVideos.forEach((video) => {
      const container = video.parentElement;
      if (container && !container.hasAttribute('data-video-container')) {
        // Only add container styling to direct parent elements that aren't already styled
        const tagName = container.tagName.toLowerCase();
        if (['div', 'p', 'section', 'article'].includes(tagName)) {
          container.classList.add('video-container');
          container.setAttribute('data-video-container', 'true');
          
          // Ensure responsive video styling
          if (!container.style.position) {
            container.style.position = 'relative';
          }
        }
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
          // Analytics placeholder
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

  // Check requirements for interactive elements and enable/disable buttons
  useEffect(() => {
    const contentElement = contentRef.current;
    if (!contentElement) {return;}

    // Use unified requirements checking with sequential mode (implicit requirements)
    const checkAllRequirements = async (): Promise<void> => {
      try {
        const result = await checkAllElementRequirements(
          contentElement, 
          checkElementRequirements, 
          true // Enable sequential mode for implicit requirements
        );
        
        // Log the result for debugging
        console.log('Requirements check completed:', {
          total: result.totalElements,
          satisfied: result.satisfied,
          failed: result.failed,
          completed: result.completed,
          disabled: result.disabled,
          failedAtIndex: result.failedAtIndex
        });
      } catch (error) {
        console.error('Error in unified requirements checking:', error);
      }
    };

    // Add video and other non-requirement styles if not already present
    if (!document.querySelector('#content-processing-styles')) {
      const style = document.createElement('style');
      style.id = 'content-processing-styles';
      style.textContent = `
        /* Anchor link styling */
        a[data-docs-anchor-link] {
          color: #1f77b4;
          text-decoration: underline;
          cursor: pointer;
          transition: color 0.2s ease;
        }
        
        a[data-docs-anchor-link]:hover {
          color: #0d5fa3;
          text-decoration: underline;
        }
        
        a[data-docs-anchor-link]:focus {
          outline: 2px solid #1f77b4;
          outline-offset: 2px;
        }
        
        /* Video styling for better rendering - responsive sizing */
        .video-container {
          position: relative;
          width: 100%;
          max-width: 100%;
          margin: 1rem 0;
        }
        
        .video-container video {
          width: 100%;
          height: auto;
          min-width: 320px;
          min-height: 180px;
          max-width: 100%;
          border-radius: 6px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
          margin: 0;
        }
        
        /* Enhanced video sizing for all video elements */
        video {
          width: 100%;
          height: auto;
          min-width: 320px;
          min-height: 180px;
          max-width: 100%;
          border-radius: 6px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
          margin: 1rem 0;
          vertical-align: middle;
        }
        
        /* Responsive breakpoints for videos */
        @media (max-width: 480px) {
          video, .video-container video {
            min-width: 280px;
            min-height: 160px;
          }
        }
        
        @media (min-width: 1200px) {
          video, .video-container video {
            max-width: 800px;
            margin-left: auto;
            margin-right: auto;
            display: block;
          }
        }
        
        video.lazyload {
          background: #f5f5f5;
          border: 1px solid #ddd;
          border-radius: 6px;
          min-width: 320px;
          min-height: 180px;
        }
        
        video.docs-video {
          min-width: 320px;
          min-height: 180px;
          border-radius: 6px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }
        
        .video-error-fallback {
          margin: 1rem 0;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          min-height: 200px;
          width: 100%;
          max-width: 800px;
        }
        
        .video-error-fallback svg {
          opacity: 0.5;
          margin-bottom: 8px;
        }
        
        .video-error-fallback p {
          margin: 4px 0;
        }
        
        /* Loading state for videos */
        video[data-video-enhanced] {
          transition: opacity 0.3s ease;
        }
      `;
      document.head.appendChild(style);
    }

    // Store the function in ref so other effects can call it
    recheckRequirementsRef.current = checkAllRequirements;

    // Start the requirement checking process
    checkAllRequirements();

    // Listen specifically for interactive action completion to trigger requirements rechecking
    // This is the one remaining case where content-processing needs to react to interactive events
    const handleInteractiveActionCompleted = (event: Event) => {
      const customEvent = event as CustomEvent;
      console.log('🔔 Interactive action completed, triggering requirements recheck:', {
        type: customEvent.type,
        detail: customEvent.detail,
        timestamp: new Date().toISOString()
      });

      // Wait for React updates then re-check requirements
      waitForReactUpdates().then(() => {
        // Small delay to ensure DOM updates are complete
        setTimeout(() => {
          if (recheckRequirementsRef.current) {
            console.log('🔄 Executing requirements recheck after interactive completion');
            recheckRequirementsRef.current().catch(error => {
              console.error('💥 Error during requirements re-check:', error);
            });
          }
        }, 50);
      }).catch(error => {
        console.error('💥 Error in waitForReactUpdates:', error);
      });
    };

    // Set up single focused event listener for interactive completions
    document.addEventListener('interactive-action-completed', handleInteractiveActionCompleted);
    
    // Cleanup function
    return () => {
      document.removeEventListener('interactive-action-completed', handleInteractiveActionCompleted);
    };

  }, [activeTabContent, activeTabDocsContent, checkElementRequirements, contentRef]);

  // Add DOM mutation observer and event listeners for automatic re-checking
  useEffect(() => {
    const contentElement = contentRef.current;
    if (!contentElement) {
      return;
    }

    let recheckTimeout: NodeJS.Timeout;



    // Debounced re-check function to avoid excessive calls
    const debouncedRecheck = () => {
      if (recheckTimeout) {
        clearTimeout(recheckTimeout);
      }
      recheckTimeout = setTimeout(() => {
        if (recheckRequirementsRef.current) {
          recheckRequirementsRef.current();
        }
      }, 500); // Wait 500ms after last change
    };



         // Listen for DOM mutations that might affect requirements (avoiding infinite loops)
     const mutationObserver = new MutationObserver((mutations) => {
       let shouldRecheck = false;

       mutations.forEach((mutation) => {
         // Check for added/removed nodes that might contain interactive elements
         if (mutation.type === 'childList') {
           const addedNodes = Array.from(mutation.addedNodes);
           const removedNodes = Array.from(mutation.removedNodes);
           
           // Only recheck if interactive elements are added/removed
           const hasInteractiveChanges = [...addedNodes, ...removedNodes].some(node => {
             if (node.nodeType !== Node.ELEMENT_NODE) {
               return false;
             }
             const element = node as Element;
             
             // Check if the node itself or any descendant has interactive attributes
             return element.hasAttribute('data-requirements') || 
                    element.querySelector('[data-requirements]') !== null;
           });

           if (hasInteractiveChanges) {
             shouldRecheck = true;
           }
         }

         // Only recheck for attribute changes that actually affect requirements logic
         if (mutation.type === 'attributes' && mutation.attributeName) {
           const attrName = mutation.attributeName;
           // Only recheck if the core requirements attributes change
           // Do NOT recheck for disabled/aria-disabled as those are OUTPUTS of requirements checking
           if (attrName === 'data-requirements' || attrName === 'data-reftarget') {
             shouldRecheck = true;
           }
         }
       });

       if (shouldRecheck) {
         console.log('🔄 DOM changes detected that may affect requirements, scheduling recheck');
         debouncedRecheck();
       }
     });

    // Start observing - only watch for changes that actually affect requirements
    mutationObserver.observe(contentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-requirements', 'data-reftarget'] // Removed disabled/aria-disabled to prevent loops
    });






         return () => {
       // Cleanup
       mutationObserver.disconnect();
       if (recheckTimeout) {
         clearTimeout(recheckTimeout);
       }
     };
   }, [contentRef]);

   // Expose manual re-check function
   const manualRecheck = useCallback(() => {
     if (recheckRequirementsRef.current) {
       recheckRequirementsRef.current();
     }
   }, []);

   return {
     recheckRequirements: manualRecheck
   };
}  
