import { useEffect, useRef, useCallback } from 'react';
import { LearningJourneyContent } from './docs-fetcher';
import { SingleDocsContent } from './single-docs-fetcher';
import { useInteractiveElements } from './interactive.hook';
import { getDocsBaseUrl } from '../constants';

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

    const elementsWithRequirements = contentElement.querySelectorAll('[data-requirements]');
    
    if (elementsWithRequirements.length === 0) {
      return;
    }
    
    // Function to update element state based on requirement check
    const updateElementState = (element: HTMLElement, satisfied: boolean, isChecking = false) => {
      // Remove all requirement state classes
      element.classList.remove('requirements-satisfied', 'requirements-failed', 'requirements-checking');
      
      if (isChecking) {
        element.classList.add('requirements-checking');
        
        // For buttons, show loading state but don't disable
        if (element.tagName.toLowerCase() === 'button') {
          const originalText = element.getAttribute('data-original-text') || element.textContent || '';
          if (!element.getAttribute('data-original-text')) {
            element.setAttribute('data-original-text', originalText);
          }
          element.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline-block; margin-right: 4px; animation: spin 1s linear infinite;">
              <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/>
            </svg>
            Checking...
          `;
        }
      } else {
        const originalText = element.getAttribute('data-original-text');
        
        if (satisfied) {
          element.classList.add('requirements-satisfied');
          
          if (element.tagName.toLowerCase() === 'button') {
            (element as HTMLButtonElement).disabled = false;
            element.setAttribute('aria-disabled', 'false');
            if (originalText) {
              element.textContent = originalText;
            }
          }
        } else {
          element.classList.add('requirements-failed');
          
          if (element.tagName.toLowerCase() === 'button') {
            (element as HTMLButtonElement).disabled = true;
            element.setAttribute('aria-disabled', 'true');
            if (originalText) {
              element.textContent = originalText;
            }
            
            // Add tooltip or title to explain why it's disabled
            const requirements = element.getAttribute('data-requirements') || '';
            element.title = `Requirements not met: ${requirements}`;
          }
        }
      }
    };

    // Check requirements for all elements
    const checkAllRequirements = async () => {
      // Set all elements to checking state first
      Array.from(elementsWithRequirements).forEach(element => {
        updateElementState(element as HTMLElement, false, true);
      });

      // Check requirements in parallel for better performance
      const checkPromises = Array.from(elementsWithRequirements).map(async (element, index) => {
        const htmlElement = element as HTMLElement;

        try {
          const result = await checkElementRequirements(htmlElement);
          updateElementState(htmlElement, result.pass, false);
          return { element: htmlElement, result, index };
        } catch (error) {
          console.error(`Error checking requirements for element ${index + 1}:`, error);
          updateElementState(htmlElement, false, false);
          return { element: htmlElement, result: null, index, error };
        }
      });

      try {
        const results = await Promise.allSettled(checkPromises);
        const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
        
        if (rejected.length > 0) {
          console.warn('Some requirement checks failed:', rejected.map(r => r.reason));
        }
      } catch (error) {
        console.error('Error in requirement checking process:', error);
      }
    };

    // Add some CSS for the requirement states and video styling if not already present
    if (!document.querySelector('#requirement-styles')) {
      const style = document.createElement('style');
      style.id = 'requirement-styles';
      style.textContent = `
        .requirements-checking {
          opacity: 0.7;
        }
        
        .requirements-satisfied {
          /* Visual feedback for satisfied requirements */
        }
        
        .requirements-failed {
          opacity: 0.5;
          cursor: not-allowed;
        }
        
        .requirements-failed button {
          opacity: 0.5;
          cursor: not-allowed;
        }
        
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
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

  }, [activeTabContent, activeTabDocsContent, contentRef, checkElementRequirements]);

  // Add DOM mutation observer and event listeners for automatic re-checking
  // disabling missing dependency warning for time being till better solution is found
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const contentElement = contentRef.current;
    if (!contentElement) {return;}

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

    // Listen for interactive element completion events
    const handleInteractiveCompletion = (event: Event) => {
      const target = event.target as HTMLElement;
      if (target && target.classList.contains('interactive-completed')) {
        debouncedRecheck();
      }
    };

         // Listen for DOM mutations that might affect requirements
     const mutationObserver = new MutationObserver((mutations) => {
       let shouldRecheck = false;

       mutations.forEach((mutation) => {
         // Check for added/removed nodes that might affect requirements
         if (mutation.type === 'childList') {
           const addedNodes = Array.from(mutation.addedNodes);
           const removedNodes = Array.from(mutation.removedNodes);
           
           // Be more aggressive about detecting changes - any new element could affect requirements
           const hasElementChanges = [...addedNodes, ...removedNodes].some(node => {
             return node.nodeType === Node.ELEMENT_NODE;
           });

           if (hasElementChanges) {
             shouldRecheck = true;
           }
         }

         // Check for attribute changes that might affect requirements
         if (mutation.type === 'attributes') {
           shouldRecheck = true;
         }
       });

       if (shouldRecheck) {
         debouncedRecheck();
       }
     });

    // Start observing
    mutationObserver.observe(contentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'aria-disabled', 'data-requirements', 'data-reftarget']
    });

    // Listen for interactive completion events
    contentElement.addEventListener('DOMSubtreeModified', handleInteractiveCompletion);
    
    // Listen for focus changes that might indicate state changes
    const handleFocusChange = () => {
      // Small delay to allow any state changes to complete
      setTimeout(() => {
        debouncedRecheck();
      }, 100);
    };

    document.addEventListener('focusin', handleFocusChange);
    document.addEventListener('focusout', handleFocusChange);

         // Listen for custom events that indicate state changes
         /* eslint-disable react-hooks/exhaustive-deps */
     const handleStateChange = (event: Event) => {
       // For interactive action completions or backup recheck, re-check immediately instead of debounced
         if (event.type === 'interactive-action-completed' || event.type === 'force-requirements-recheck') {
                    setTimeout(() => {
             if (recheckRequirementsRef.current) {
               recheckRequirementsRef.current().catch(error => {
                 console.error('Error during requirements re-check:', error);
               });
             } else {
               console.warn('recheckRequirementsRef.current is not available, doing direct re-check');
               
               // Fallback: directly find and check all elements with requirements
               const currentElementsWithRequirements = contentElement.querySelectorAll('[data-requirements]');
               
               if (currentElementsWithRequirements.length > 0) {
                 // Run requirement checks directly
                 Array.from(currentElementsWithRequirements).forEach(async (element) => {
                   const htmlElement = element as HTMLElement;
                   
                   try {
                     const result = await checkElementRequirements(htmlElement);
                     
                     // Update the element state (inline version)
                     htmlElement.classList.remove('requirements-satisfied', 'requirements-failed', 'requirements-checking');
                     if (result.pass) {
                       htmlElement.classList.add('requirements-satisfied');
                       if (htmlElement.tagName.toLowerCase() === 'button') {
                         (htmlElement as HTMLButtonElement).disabled = false;
                         htmlElement.setAttribute('aria-disabled', 'false');
                       }
                     } else {
                       htmlElement.classList.add('requirements-failed');
                       if (htmlElement.tagName.toLowerCase() === 'button') {
                         (htmlElement as HTMLButtonElement).disabled = true;
                         htmlElement.setAttribute('aria-disabled', 'true');
                       }
                     }
                   } catch (error) {
                     console.error('Fallback error for element:', error);
                     // Set failed state (inline version)
                     htmlElement.classList.remove('requirements-satisfied', 'requirements-failed', 'requirements-checking');
                     htmlElement.classList.add('requirements-failed');
                     if (htmlElement.tagName.toLowerCase() === 'button') {
                       (htmlElement as HTMLButtonElement).disabled = true;
                       htmlElement.setAttribute('aria-disabled', 'true');
                     }
                   }
                 });
               }
             }
           }, 100); // Small delay to let DOM settle
       } else {
         debouncedRecheck();
       }
     };

         // Listen for events that might indicate data source changes
     const stateChangeEvents = [
       'datasource-added',
       'datasource-removed', 
       'datasource-updated',
       'connection-established',
       'navigation-complete',
       'interactive-action-completed',  // Our custom event from interactive.hook.ts
       'force-requirements-recheck'     // Backup event from interactive.hook.ts
     ];

         stateChangeEvents.forEach(eventType => {
       document.addEventListener(eventType, handleStateChange);
     });

         return () => {
       // Cleanup
       mutationObserver.disconnect();
       contentElement.removeEventListener('DOMSubtreeModified', handleInteractiveCompletion);
       document.removeEventListener('focusin', handleFocusChange);
       document.removeEventListener('focusout', handleFocusChange);
       stateChangeEvents.forEach(eventType => {
         document.removeEventListener(eventType, handleStateChange);
       });
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
