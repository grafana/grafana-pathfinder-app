import { useEffect } from 'react';
import { GrafanaTheme2 } from '@grafana/data';
import { safeEventHandler } from './safe-event-handler.util';
import { reportAppInteraction, UserInteraction } from '../lib/analytics';

// Allowed GitHub URLs that can open in app tabs (from context.service.ts defaultRecommendations)
const ALLOWED_GITHUB_URLS = [
  'https://raw.githubusercontent.com/moxious/',
  'https://raw.githubusercontent.com/Jayclifford345/',
];

interface LearningJourneyTab {
  id: string;
  title: string;
  baseUrl: string;
  content: any;
  isLoading: boolean;
  error: string | null;
  type?: 'learning-journey' | 'docs';
  docsContent?: any;
}

interface UseLinkClickHandlerProps {
  contentRef: React.RefObject<HTMLDivElement>;
  activeTab: LearningJourneyTab | null;
  theme: GrafanaTheme2;
  model: {
    loadTabContent: (tabId: string, url: string) => void;
    openLearningJourney: (url: string, title: string) => void;
    openDocsPage?: (url: string, title: string) => void;
    getActiveTab: () => LearningJourneyTab | null;
    navigateToNextMilestone: () => void;
    navigateToPreviousMilestone: () => void;
    canNavigateNext: () => boolean;
    canNavigatePrevious: () => boolean;
  };
}

/**
 * Attempts to construct an unstyled.html URL for external content
 * This is used to try to embed external documentation in our app
 */
function tryConstructUnstyledUrl(originalUrl: string): string | null {
  try {
    // Common patterns for unstyled content
    const unstyledPatterns = [
      // Add /unstyled.html to the path
      () => {
        const newUrl = new URL(originalUrl);
        newUrl.pathname = newUrl.pathname.replace(/\/$/, '') + '/unstyled.html';
        return newUrl.href;
      },
      // Replace .html with /unstyled.html
      () => {
        if (originalUrl.endsWith('.html')) {
          return originalUrl.replace(/\.html$/, '/unstyled.html');
        }
        return null;
      },
      // Add unstyled query parameter
      () => {
        const newUrl = new URL(originalUrl);
        newUrl.searchParams.set('unstyled', 'true');
        return newUrl.href;
      },
    ];
    
    // Try the first pattern (most common)
    return unstyledPatterns[0]();
    
  } catch (error) {
    console.warn('Failed to construct unstyled URL for:', originalUrl, error);
    return null;
  }
}

export function useLinkClickHandler({ 
  contentRef, 
  activeTab, 
  theme, 
  model 
}: UseLinkClickHandlerProps) {
  useEffect(() => {
    const handleLinkClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      
      // Handle both button and anchor elements with data-journey-start
      const startElement = target.closest('[data-journey-start="true"]') as HTMLElement;
      
      if (startElement) {
        safeEventHandler(event, {
          preventDefault: true,
          stopPropagation: true,
        });
        
        // Get the milestone URL from the button's data attribute
        const milestoneUrl = startElement.getAttribute('data-milestone-url');
        const activeTab = model.getActiveTab();
        
        if (milestoneUrl && activeTab) {
          // Track analytics for starting journey
          reportAppInteraction(UserInteraction.StartLearningJourneyClick, {
            journey_title: activeTab.title,
            journey_url: activeTab.baseUrl,
            interaction_location: 'ready_to_begin_button',
            total_milestones: activeTab.content?.metadata?.learningJourney?.totalMilestones || 0
          });
          
          // Navigate directly to the first milestone URL
          model.loadTabContent(activeTab.id, milestoneUrl);
        } else if (activeTab?.content?.milestones && activeTab.content.milestones.length > 0) {
          // Fallback: use the first milestone from content
          const firstMilestone = activeTab.content.milestones[0];
          if (firstMilestone.url) {
            // Track analytics for fallback case
            reportAppInteraction(UserInteraction.StartLearningJourneyClick, {
              journey_title: activeTab.title,
              journey_url: activeTab.baseUrl,
              interaction_location: 'ready_to_begin_button_fallback',
              total_milestones: activeTab.content.milestones.length
            });
            
            model.loadTabContent(activeTab.id, firstMilestone.url);
          }
        } else {
          console.warn('No milestone URL found to navigate to');
        }
      }

      // Handle regular anchor links for Grafana docs
      const anchor = target.closest('a[href]') as HTMLAnchorElement;
      
      if (anchor && !startElement && !target.closest('[data-side-journey-link]') && !target.closest('[data-related-journey-link]') && !target.closest('img.content-image')) {
        const href = anchor.getAttribute('href');
        
        if (href) {
          // Handle relative fragment links (like #section-name)
          if (href.startsWith('#')) {
            // Let the browser handle fragment navigation naturally
            return;
          }
          
          // Resolve relative URLs against current page base URL
          let resolvedUrl = href;
          if (!href.startsWith('http') && !href.startsWith('/')) {
            // This is a relative link like "alertmanager/" or "../parent/"
            const currentPageUrl = activeTab?.content?.url || activeTab?.content?.metadata?.url;
            if (currentPageUrl) {
              try {
                const baseUrl = new URL(currentPageUrl);
                resolvedUrl = new URL(href, baseUrl).href;
              } catch (error) {
                console.warn('Failed to resolve relative URL:', href, 'against base:', currentPageUrl, error);
                // Fallback: assume it's relative to Grafana docs root
                resolvedUrl = `https://grafana.com/docs/${href}`;
              }
            } else {
              // No base URL available, assume it's relative to Grafana docs root
              resolvedUrl = `https://grafana.com/docs/${href}`;
            }
          }
          
          // Handle Grafana docs and tutorials links (including resolved relative links)
          if (resolvedUrl.includes('grafana.com/docs/') || resolvedUrl.includes('grafana.com/tutorials/') || 
              href.startsWith('/docs/') || href.startsWith('/tutorials/')) {
            safeEventHandler(event, {
              preventDefault: true,
              stopPropagation: true,
            });
            
            const fullUrl = resolvedUrl.startsWith('http') ? resolvedUrl : `https://grafana.com${resolvedUrl}`;
            const linkText = anchor.textContent?.trim() || 'Documentation';
            
            // Determine if it's a learning journey or regular docs/tutorials
            if (fullUrl.includes('/learning-journeys/')) {
              model.openLearningJourney(fullUrl, linkText);
            } else {
              // For regular docs and tutorials, use openDocsPage if available, otherwise openLearningJourney
              if ('openDocsPage' in model && typeof model.openDocsPage === 'function') {
                (model as any).openDocsPage(fullUrl, linkText);
              } else {
                model.openLearningJourney(fullUrl, linkText);
              }
            }
            
            // Track analytics for docs/tutorials link clicks
            reportAppInteraction('docs_link_click' as UserInteraction, {
              link_url: fullUrl,
              link_text: linkText,
              source_page: activeTab?.content?.url || 'unknown',
              link_type: fullUrl.includes('/tutorials/') ? 'tutorial' : 'docs'
            });
          }
          // Handle GitHub links - check if allowed to open in app
          else if (href.includes('github.com') || href.includes('raw.githubusercontent.com')) {
            safeEventHandler(event, {
              preventDefault: true,
              stopPropagation: true,
            });
            
            const linkText = anchor.textContent?.trim() || 'GitHub Link';
            
            // Check if this URL is in the allowed list for app tabs
            const isAllowedUrl = ALLOWED_GITHUB_URLS.some(allowedUrl => 
              resolvedUrl === allowedUrl || resolvedUrl.startsWith(allowedUrl)
            );
            
            if (isAllowedUrl) {
              // This is an allowed URL - try to open in app with unstyled.html fallback
              const unstyledUrl = tryConstructUnstyledUrl(resolvedUrl);
              
              if (unstyledUrl) {
                // Try to open in app first
                if ('openDocsPage' in model && typeof model.openDocsPage === 'function') {
                  (model as any).openDocsPage(unstyledUrl, linkText);
                } else {
                  model.openLearningJourney(unstyledUrl, linkText);
                }
                
                // Track analytics for allowed GitHub link attempts
                reportAppInteraction('docs_link_click' as UserInteraction, {
                  link_url: unstyledUrl,
                  link_text: linkText,
                  source_page: activeTab?.content?.url || 'unknown',
                  link_type: 'github_allowed_unstyled'
                });
              } else {
                // Even allowed URLs fallback to opening in app without unstyled
                if ('openDocsPage' in model && typeof model.openDocsPage === 'function') {
                  (model as any).openDocsPage(resolvedUrl, linkText);
                } else {
                  model.openLearningJourney(resolvedUrl, linkText);
                }
                
                // Track analytics for allowed GitHub direct attempts
                reportAppInteraction('docs_link_click' as UserInteraction, {
                  link_url: resolvedUrl,
                  link_text: linkText,
                  source_page: activeTab?.content?.url || 'unknown',
                  link_type: 'github_allowed_direct'
                });
              }
            } else {
              // Not in allowed list - open in new browser tab immediately
              window.open(resolvedUrl, '_blank', 'noopener,noreferrer');
              
              // Track analytics for GitHub browser opening
              reportAppInteraction('docs_link_click' as UserInteraction, {
                link_url: resolvedUrl,
                link_text: linkText,
                source_page: activeTab?.content?.url || 'unknown',
                link_type: 'github_browser_external'
              });
            }
          }
          // For ALL other external links, immediately open in new browser tab
          else if (href.startsWith('http')) {
            safeEventHandler(event, {
              preventDefault: true,
              stopPropagation: true,
            });
            
            // Open all other external links in new browser tab to keep user in Grafana
            window.open(resolvedUrl, '_blank', 'noopener,noreferrer');
            
            const linkText = anchor.textContent?.trim() || 'External Link';
            
            // Track analytics for external link clicks
            reportAppInteraction('docs_link_click' as UserInteraction, {
              link_url: resolvedUrl,
              link_text: linkText,
              source_page: activeTab?.content?.url || 'unknown',
              link_type: 'external_browser'
            });
          }
        }
      }

      // Handle image lightbox clicks
      const image = target.closest('img.content-image') as HTMLImageElement;
      
      if (image ) {
        safeEventHandler(event, {
          preventDefault: true,
          stopPropagation: true,
        });
        
        const imageSrc = image.src;
        const imageAlt = image.alt || 'Image';
        
        // Create image lightbox modal with theme awareness
        createImageLightbox(imageSrc, imageAlt, theme);
      }

      // Handle side journey links
      const sideJourneyLink = target.closest('[data-side-journey-link]') as HTMLAnchorElement;
      
      if (sideJourneyLink) {
        safeEventHandler(event, {
          preventDefault: true,
          stopPropagation: true,
        });
        
        // Get URL from href attribute instead of data attribute
        const linkUrl = sideJourneyLink.getAttribute('href');
        const linkTitle = sideJourneyLink.textContent?.trim() || 'Side Journey';
        
        if (linkUrl) {
          // Convert relative URLs to full URLs
          const fullUrl = linkUrl.startsWith('http') ? linkUrl : `https://grafana.com${linkUrl}`;
          
          // Open side journey links in new app tabs (as docs pages)
          if ('openDocsPage' in model && typeof model.openDocsPage === 'function') {
            (model as any).openDocsPage(fullUrl, linkTitle);
          } else {
            // Fallback to learning journey handler
            model.openLearningJourney(fullUrl, linkTitle);
          }
          
          // Track analytics for side journey clicks
          reportAppInteraction('docs_link_click' as UserInteraction, {
            link_url: fullUrl,
            link_text: linkTitle,
            source_page: activeTab?.content?.url || 'unknown',
            link_type: 'side_journey'
          });
        }
      }

      // Handle related journey links (open in new app tabs)
      const relatedJourneyLink = target.closest('[data-related-journey-link]') as HTMLAnchorElement;
      
      if (relatedJourneyLink) {
        safeEventHandler(event, {
          preventDefault: true,
          stopPropagation: true,
        });
        
        // Get URL from href attribute and title from text content (like side journeys)
        const linkUrl = relatedJourneyLink.getAttribute('href');
        const linkTitle = relatedJourneyLink.textContent?.trim() || 'Related Journey';
        
        if (linkUrl) {
          // Related journey links open in new app tabs (learning journeys)
          const fullUrl = linkUrl.startsWith('http') ? linkUrl : `https://grafana.com${linkUrl}`;
          model.openLearningJourney(fullUrl, linkTitle);
          
          // Track analytics for related journey clicks
          reportAppInteraction('docs_link_click' as UserInteraction, {
            link_url: fullUrl,
            link_text: linkTitle,
            source_page: activeTab?.content?.url || 'unknown',
            link_type: 'related_journey'
          });
        }
      }

      // Handle bottom navigation buttons (Previous/Next)
      const bottomNavButton = target.closest('.journey-bottom-nav-button') as HTMLElement;
      
      if (bottomNavButton) {
        safeEventHandler(event, {
          preventDefault: true,
          stopPropagation: true,
        });
        
        const buttonText = bottomNavButton.textContent?.trim().toLowerCase();
        
        if (buttonText?.includes('previous') || buttonText?.includes('prev')) {
          if (model.canNavigatePrevious()) {
            model.navigateToPreviousMilestone();
          }
        } else if (buttonText?.includes('next')) {
          if (model.canNavigateNext()) {
            model.navigateToNextMilestone();
          }
        }
      }

      // Also handle buttons with specific text content as fallback
      const button = target.closest('button') as HTMLButtonElement;
      
      if (button && !bottomNavButton) {
        const buttonText = button.textContent?.trim().toLowerCase();
        
        // Check if this looks like a navigation button in the content area
        if ((buttonText?.includes('previous') || buttonText?.includes('prev') || buttonText?.includes('←')) && 
            button.closest('[class*="content"]')) {
          safeEventHandler(event, {
            preventDefault: true,
            stopPropagation: true,
          });
          if (model.canNavigatePrevious()) {
            model.navigateToPreviousMilestone();
          }
        } else if ((buttonText?.includes('next') || buttonText?.includes('→')) && 
                   button.closest('[class*="content"]')) {
          safeEventHandler(event, {
            preventDefault: true,
            stopPropagation: true,
          });
          if (model.canNavigateNext()) {
            model.navigateToNextMilestone();
          }
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
    return undefined;
  }, [contentRef, theme, model, activeTab?.content, activeTab?.docsContent]);
}

function createImageLightbox(imageSrc: string, imageAlt: string, theme: GrafanaTheme2) {
  // Prevent multiple modals
  if (document.querySelector('.journey-image-modal')) {return;}
  const imageModal = document.createElement('div');
  imageModal.className = 'journey-image-modal';

  // Modal HTML, no inline styles, all sizing is CSS!
  imageModal.innerHTML = `
    <div class="journey-image-modal-backdrop">
      <div class="journey-image-modal-container">
        <div class="journey-image-modal-header">
          <h3 class="journey-image-modal-title">${imageAlt}</h3>
          <button class="journey-image-modal-close" aria-label="Close image">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div class="journey-image-modal-content">
          <img src="${imageSrc}" alt="${imageAlt}" class="journey-image-modal-image" />
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(imageModal);

  // Close modal utility
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

  // Close on Escape key
  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeModal();
      document.removeEventListener('keydown', handleEscape);
    }
  };
  document.addEventListener('keydown', handleEscape);

  // Prevent background scroll
  document.body.style.overflow = 'hidden';
}

