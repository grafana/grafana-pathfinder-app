import { useEffect, useRef, useCallback } from 'react';
import { LearningJourneyContent } from './docs-fetcher';
import { SingleDocsContent } from './single-docs-fetcher';
import { useInteractiveElements } from './interactive.hook';

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
            // eslint-disable-next-line deprecation/deprecation
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
            // eslint-disable-next-line deprecation/deprecation
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

  // Check requirements for interactive elements and enable/disable buttons
  useEffect(() => {
    const contentElement = contentRef.current;
    if (!contentElement) {return;}

    const elementsWithRequirements = contentElement.querySelectorAll('[data-requirements]');
    
    if (elementsWithRequirements.length === 0) {
      console.log('No elements with data-requirements found');
      return;
    }

    console.log(`Found ${elementsWithRequirements.length} elements with data-requirements`);
    
    // Function to update element state based on requirement check
    const updateElementState = (element: HTMLElement, satisfied: boolean, isChecking = false) => {
      const elementInfo = `${element.tagName}[${element.getAttribute('data-reftarget')}] "${element.textContent?.trim()}"`;
      console.log(`🔧 Updating element state: ${elementInfo} - satisfied: ${satisfied}, checking: ${isChecking}`);
      
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
      console.log('🔍 Starting requirement checks for ALL elements...');
      console.log(`🔍 Found ${elementsWithRequirements.length} elements with requirements to check`);
      
      // Log all elements that will be checked
      Array.from(elementsWithRequirements).forEach((element, index) => {
        const htmlElement = element as HTMLElement;
        console.log(`🔍 Element ${index + 1} to check: ${htmlElement.tagName}[${htmlElement.getAttribute('data-reftarget')}] "${htmlElement.textContent?.trim()}"`);
      });
      
      // Set all elements to checking state first
      Array.from(elementsWithRequirements).forEach(element => {
        updateElementState(element as HTMLElement, false, true);
      });

      // Check requirements in parallel for better performance
      const checkPromises = Array.from(elementsWithRequirements).map(async (element, index) => {
        const htmlElement = element as HTMLElement;
        const requirements = htmlElement.getAttribute('data-requirements') || '';
        const reftarget = htmlElement.getAttribute('data-reftarget') || '';
        
        console.log(`Checking requirements for element ${index + 1}:`, {
          requirements,
          reftarget,
          tagName: htmlElement.tagName.toLowerCase(),
          textContent: htmlElement.textContent?.trim()
        });

        try {
          const result = await checkElementRequirements(htmlElement);
          console.log(`📋 Element ${index + 1} requirement check result:`, result);
          console.log(`📋 Element ${index + 1} current state - tag: ${htmlElement.tagName}, disabled: ${(htmlElement as HTMLButtonElement).disabled}, text: "${htmlElement.textContent?.trim()}"`);
          
          // Test if the reftarget actually exists right now
          if (reftarget) {
            const testElement = document.querySelector(reftarget);
            console.log(`🔍 Direct test for "${reftarget}": ${testElement ? 'FOUND' : 'NOT FOUND'}`, testElement);
          }
          
          updateElementState(htmlElement, result.pass, false);
          
          // Log the state after update
          console.log(`📋 Element ${index + 1} after update - disabled: ${(htmlElement as HTMLButtonElement).disabled}, classes: ${htmlElement.className}`);
          
          return { element: htmlElement, result, index };
        } catch (error) {
          console.error(`Error checking requirements for element ${index + 1}:`, error);
          updateElementState(htmlElement, false, false);
          
          return { element: htmlElement, result: null, index, error };
        }
      });

      try {
        const results = await Promise.allSettled(checkPromises);
        const fulfilled = results.filter((result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled');
        const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
        
        console.log(`Requirement checks completed: ${fulfilled.length} successful, ${rejected.length} failed`);
        
        if (rejected.length > 0) {
          console.warn('Some requirement checks failed:', rejected.map(r => r.reason));
        }
      } catch (error) {
        console.error('Error in requirement checking process:', error);
      }
    };

    // Add some CSS for the requirement states if not already present
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
      `;
      document.head.appendChild(style);
    }

    // Store the function in ref so other effects can call it
    recheckRequirementsRef.current = checkAllRequirements;

    // Start the requirement checking process
    console.log("Starting full interactive elements requirements checking exercise");
    checkAllRequirements();

  }, [activeTabContent, activeTabDocsContent, contentRef, checkElementRequirements]);

  // Add DOM mutation observer and event listeners for automatic re-checking
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
        console.log('🔄 Re-checking requirements due to DOM changes...');
        if (recheckRequirementsRef.current) {
          recheckRequirementsRef.current();
        }
      }, 500); // Wait 500ms after last change
    };

    // Listen for interactive element completion events
    const handleInteractiveCompletion = (event: Event) => {
      const target = event.target as HTMLElement;
      if (target && target.classList.contains('interactive-completed')) {
        console.log('🎯 Interactive action completed, re-checking requirements...');
        debouncedRecheck();
      }
    };

         // Listen for DOM mutations that might affect requirements
     const mutationObserver = new MutationObserver((mutations) => {
       let shouldRecheck = false;
       const detectedChanges: string[] = [];

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
             detectedChanges.push(`childList: ${addedNodes.length} added, ${removedNodes.length} removed`);
             
             // Log what was added for debugging
             addedNodes.forEach(node => {
               if (node.nodeType === Node.ELEMENT_NODE) {
                 const element = node as Element;
                 console.log('🆕 Added element:', element.tagName, element.className, element.id);
               }
             });
           }
         }

         // Check for attribute changes that might affect requirements
         if (mutation.type === 'attributes') {
           shouldRecheck = true;
           detectedChanges.push(`attribute: ${mutation.attributeName} on ${(mutation.target as Element).tagName}`);
         }
       });

       if (shouldRecheck) {
         console.log('🔍 DOM mutation detected:', detectedChanges.join(', '));
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
        console.log('🎯 Focus changed, checking if requirements need update...');
        debouncedRecheck();
      }, 100);
    };

    document.addEventListener('focusin', handleFocusChange);
    document.addEventListener('focusout', handleFocusChange);

         // Listen for custom events that indicate state changes
     const handleStateChange = (event: Event) => {
       console.log('📡 State change event detected:', event.type);
       
                // For interactive action completions or backup recheck, re-check immediately instead of debounced
         if (event.type === 'interactive-action-completed' || event.type === 'force-requirements-recheck') {
           const eventSource = event.type === 'force-requirements-recheck' ? 'BACKUP SYSTEM' : 'PRIMARY SYSTEM';
           console.log(`⚡ Interactive action completed (${eventSource}) - immediate FULL re-check of ALL elements`);
                    setTimeout(() => {
             if (recheckRequirementsRef.current) {
               console.log('🔄 Calling full requirements re-check function...');
               recheckRequirementsRef.current().then(() => {
                 console.log('✅ Full requirements re-check completed');
               }).catch(error => {
                 console.error('❌ Error during requirements re-check:', error);
               });
             } else {
               console.warn('⚠️ recheckRequirementsRef.current is not available, doing direct re-check');
               
               // Fallback: directly find and check all elements with requirements
               const currentElementsWithRequirements = contentElement.querySelectorAll('[data-requirements]');
               console.log(`🔄 Direct fallback: Found ${currentElementsWithRequirements.length} elements with requirements`);
               
               if (currentElementsWithRequirements.length > 0) {
                 // Run requirement checks directly
                 Array.from(currentElementsWithRequirements).forEach(async (element, index) => {
                   const htmlElement = element as HTMLElement;
                   const requirements = htmlElement.getAttribute('data-requirements') || '';
                   const reftarget = htmlElement.getAttribute('data-reftarget') || '';
                   
                   console.log(`🔄 Fallback checking element ${index + 1}: ${htmlElement.tagName}[${reftarget}] "${htmlElement.textContent?.trim()}"`);
                   
                   try {
                     const result = await checkElementRequirements(htmlElement);
                     console.log(`🔄 Fallback result for element ${index + 1}:`, result);
                     
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
                     console.error(`🔄 Fallback error for element ${index + 1}:`, error);
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
       console.log(`📡 Adding listener for event: ${eventType}`);
       document.addEventListener(eventType, handleStateChange);
     });
     
     // Also add a direct listener to verify the event is being dispatched
     const debugListener = (event: Event) => {
       console.log(`🐛 DEBUG: Received event ${event.type} on document`);
     };
     document.addEventListener('interactive-action-completed', debugListener);

         return () => {
       // Cleanup
       mutationObserver.disconnect();
       contentElement.removeEventListener('DOMSubtreeModified', handleInteractiveCompletion);
       document.removeEventListener('focusin', handleFocusChange);
       document.removeEventListener('focusout', handleFocusChange);
       stateChangeEvents.forEach(eventType => {
         document.removeEventListener(eventType, handleStateChange);
       });
       document.removeEventListener('interactive-action-completed', debugListener);
       if (recheckTimeout) {
         clearTimeout(recheckTimeout);
       }
     };
   }, [contentRef]);

   // Expose manual re-check function
   const manualRecheck = useCallback(() => {
     console.log('🔧 Manual requirement re-check triggered');
     if (recheckRequirementsRef.current) {
       recheckRequirementsRef.current();
     }
   }, []);

   return {
     recheckRequirements: manualRecheck
   };
}  
