import { useEffect } from 'react';
import { GrafanaTheme2 } from '@grafana/data';
import { safeEventHandler } from './safe-event-handler.util';
import { reportAppInteraction, UserInteraction } from '../lib/analytics';

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
      
      if (anchor && !startElement && !target.closest('[data-side-journey-link]') && !target.closest('[data-related-journey-link]')) {
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
          
          // Handle Grafana docs links (including resolved relative links)
          if (resolvedUrl.includes('grafana.com/docs/') || href.startsWith('/docs/')) {
            safeEventHandler(event, {
              preventDefault: true,
              stopPropagation: true,
            });
            
            const fullUrl = resolvedUrl.startsWith('http') ? resolvedUrl : `https://grafana.com${resolvedUrl}`;
            const linkText = anchor.textContent?.trim() || 'Documentation';
            
            // Determine if it's a learning journey or regular docs
            if (fullUrl.includes('/learning-journeys/')) {
              model.openLearningJourney(fullUrl, linkText);
            } else {
              // For regular docs, use openDocsPage if available, otherwise openLearningJourney
              if ('openDocsPage' in model && typeof model.openDocsPage === 'function') {
                (model as any).openDocsPage(fullUrl, linkText);
              } else {
                model.openLearningJourney(fullUrl, linkText);
              }
            }
            
            // Track analytics for docs link clicks
            reportAppInteraction('docs_link_click' as UserInteraction, {
              link_url: fullUrl,
              link_text: linkText,
              source_page: activeTab?.content?.url || 'unknown'
            });
          }
          // For external links (non-Grafana), let them open in new browser window naturally
          else if (href.startsWith('http') && !href.includes('grafana.com')) {
            // Let external links work normally - don't prevent default
            return;
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
      const relatedJourneyLink = target.closest('[data-related-journey-link]') as HTMLElement;
      
      if (relatedJourneyLink) {
        safeEventHandler(event, {
          preventDefault: true,
          stopPropagation: true,
        });
        
        const linkUrl = relatedJourneyLink.getAttribute('data-related-journey-url');
        const linkTitle = relatedJourneyLink.getAttribute('data-related-journey-title');
        
        if (linkUrl) {
          // Related journey links open in new app tabs (learning journeys)
          const fullUrl = linkUrl.startsWith('http') ? linkUrl : `https://grafana.com${linkUrl}`;
          model.openLearningJourney(fullUrl, linkTitle || 'Related Journey');
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
  if (document.querySelector('.journey-image-modal')) return;
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

