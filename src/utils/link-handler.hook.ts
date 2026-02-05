import { useEffect } from 'react';
import { GrafanaTheme2 } from '@grafana/data';
import { safeEventHandler } from './safe-event-handler.util';
import {
  reportAppInteraction,
  UserInteraction,
  enrichWithJourneyContext,
  enrichWithStepContext,
  getContentTypeForAnalytics,
} from '../lib/analytics';
import { getJourneyProgress } from '../docs-retrieval/learning-journey-helpers';
import {
  parseUrlSafely,
  isAllowedContentUrl,
  isLocalhostUrl,
  isInteractiveLearningUrl,
  isGitHubRawUrl,
} from '../security';
import { isDevModeEnabledGlobal } from './dev-mode';
import { LearningJourneyTab } from '../types/content-panel.types';

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
 * SECURITY: Validate URL is from a trusted Grafana source
 * Interactive learning URLs are handled separately in the link handler
 * This function is for Grafana.com docs and localhost/GitHub (dev mode)
 */
function isValidGrafanaContentUrl(url: string): boolean {
  const isDevMode = isDevModeEnabledGlobal();
  return isAllowedContentUrl(url) || (isDevMode && isLocalhostUrl(url)) || (isDevMode && isGitHubRawUrl(url));
}

export function useLinkClickHandler({ contentRef, activeTab, theme, model }: UseLinkClickHandlerProps) {
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
            content_title: activeTab.title,
            content_url: activeTab.baseUrl,
            interaction_location: 'ready_to_begin_button',
            total_milestones: activeTab.content?.metadata?.learningJourney?.totalMilestones || 0,
          });

          // Navigate directly to the first milestone URL
          model.loadTabContent(activeTab.id, milestoneUrl);
        } else if (
          activeTab?.content?.metadata?.learningJourney?.milestones &&
          activeTab.content.metadata.learningJourney.milestones.length > 0
        ) {
          // Fallback: use the first milestone from content metadata
          const firstMilestone = activeTab.content.metadata.learningJourney.milestones[0];
          if (firstMilestone.url) {
            // Track analytics for fallback case
            reportAppInteraction(UserInteraction.StartLearningJourneyClick, {
              content_title: activeTab.title,
              content_url: activeTab.baseUrl,
              interaction_location: 'ready_to_begin_button_fallback',
              total_milestones: activeTab.content.metadata.learningJourney.milestones.length,
            });

            model.loadTabContent(activeTab.id, firstMilestone.url);
          }
        } else {
          console.warn('No milestone URL found to navigate to');
        }
      }

      // Handle regular anchor links for Grafana docs and bundled interactives
      const anchor = target.closest('a[href]') as HTMLAnchorElement;

      if (
        anchor &&
        !startElement &&
        !target.closest('[data-side-journey-link]') &&
        !target.closest('[data-related-journey-link]') &&
        !target.closest('img.content-image')
      ) {
        const href = anchor.getAttribute('href');

        if (href) {
          // Support bundled interactives: href like bundled:prometheus-grafana-101
          if (href.startsWith('bundled:')) {
            safeEventHandler(event, {
              preventDefault: true,
              stopPropagation: true,
            });
            const linkText = anchor.textContent?.trim() || 'interactive guide';
            if ('openDocsPage' in model && typeof model.openDocsPage === 'function') {
              (model as any).openDocsPage(href, linkText);
            } else {
              model.openLearningJourney(href, linkText);
            }
            reportAppInteraction(
              UserInteraction.OpenExtraResource,
              enrichWithStepContext({
                content_url: href,
                content_type: getContentTypeForAnalytics(href, 'docs'),
                link_text: linkText,
                source_page: activeTab?.content?.url || 'unknown',
                link_type: 'bundled_interactive',
                interaction_location: 'bundled_link',
              })
            );
            return;
          }
          // Handle relative fragment links (like #section-name)
          if (href.startsWith('#')) {
            // Let the browser handle fragment navigation naturally
            return;
          }

          // Resolve relative URLs against current page base URL
          let resolvedUrl = href;
          if (!href.startsWith('http') && !href.startsWith('/')) {
            // This is a relative link like "alertmanager/" or "../parent/"
            const currentPageUrl = activeTab?.content?.url;
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

          // Handle Grafana docs and guides links (including resolved relative links)
          // Use secure URL validation to prevent domain hijacking
          // Resolve any remaining relative paths against the current page's base URL
          let fullUrl: string;
          if (resolvedUrl.startsWith('http')) {
            fullUrl = resolvedUrl;
          } else {
            // Absolute path like "/docs/something" - resolve against current page base
            const baseUrl = activeTab?.content?.url || 'https://grafana.com';
            try {
              fullUrl = new URL(resolvedUrl, baseUrl).href;
            } catch (error) {
              console.warn('Failed to resolve URL against base:', resolvedUrl, baseUrl, error);
              // Fallback to grafana.com only if resolution fails
              fullUrl = `https://grafana.com${resolvedUrl}`;
            }
          }

          if (isValidGrafanaContentUrl(fullUrl)) {
            safeEventHandler(event, {
              preventDefault: true,
              stopPropagation: true,
            });

            const linkText = anchor.textContent?.trim() || 'Documentation';

            // Parse URL to check pathname (already validated by isValidGrafanaContentUrl)
            const urlObj = parseUrlSafely(fullUrl);
            const isLearningJourney = urlObj?.pathname.startsWith('/learning-journeys/');

            // Determine if it's a learning journey or regular docs/tutorials
            if (isLearningJourney) {
              model.openLearningJourney(fullUrl, linkText);
            } else {
              // For regular docs and guides, use openDocsPage if available, otherwise openLearningJourney
              if ('openDocsPage' in model && typeof model.openDocsPage === 'function') {
                (model as any).openDocsPage(fullUrl, linkText);
              } else {
                model.openLearningJourney(fullUrl, linkText);
              }
            }

            // Track analytics for opening extra resources (docs/tutorials)
            const contentType = isLearningJourney ? 'learning-journey' : 'docs';
            const isTutorial = urlObj?.pathname.startsWith('/tutorials/');
            reportAppInteraction(
              UserInteraction.OpenExtraResource,
              enrichWithStepContext({
                content_url: fullUrl,
                content_type: getContentTypeForAnalytics(fullUrl, contentType),
                link_text: linkText,
                source_page: activeTab?.content?.url || 'unknown',
                link_type: isTutorial ? 'tutorial' : 'docs',
                interaction_location: 'content_link',
              })
            );
          }
          // Handle interactive learning links - open in app
          else if (isInteractiveLearningUrl(href)) {
            safeEventHandler(event, {
              preventDefault: true,
              stopPropagation: true,
            });

            const linkText = anchor.textContent?.trim() || 'Interactive Learning';

            // Open interactive learning content in app
            if ('openDocsPage' in model && typeof model.openDocsPage === 'function') {
              (model as any).openDocsPage(resolvedUrl, linkText);
            } else {
              model.openLearningJourney(resolvedUrl, linkText);
            }

            // Track analytics for interactive learning link
            reportAppInteraction(
              UserInteraction.OpenExtraResource,
              enrichWithStepContext(
                enrichWithJourneyContext(
                  {
                    content_url: resolvedUrl,
                    content_type: getContentTypeForAnalytics(resolvedUrl, 'docs'),
                    link_text: linkText,
                    source_page: activeTab?.content?.url || 'unknown',
                    link_type: 'interactive_learning',
                    interaction_location: 'interactive_learning_link',
                  },
                  activeTab?.content
                )
              )
            );
          }
          // For ALL other external links, immediately open in new browser tab
          else if (href.startsWith('http')) {
            safeEventHandler(event, {
              preventDefault: true,
              stopPropagation: true,
            });

            const linkText = anchor.textContent?.trim() || 'External Link';

            // Track analytics for external link clicks opening in browser
            reportAppInteraction(
              UserInteraction.OpenExtraResource,
              enrichWithStepContext(
                enrichWithJourneyContext(
                  {
                    content_url: resolvedUrl,
                    content_type: getContentTypeForAnalytics(resolvedUrl, 'docs'),
                    link_text: linkText,
                    source_page: activeTab?.content?.url || 'unknown',
                    link_type: 'external_browser',
                    interaction_location: 'external_link',
                  },
                  activeTab?.content
                )
              )
            );

            // Delay to ensure analytics event is sent before opening new tab
            setTimeout(() => {
              window.open(resolvedUrl, '_blank', 'noopener,noreferrer');
            }, 100);
          }
        }
      }

      // Handle image lightbox clicks
      const image = target.closest('img.content-image') as HTMLImageElement;

      if (image) {
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
          // Side journey links come from metadata and should resolve against the journey base
          let fullUrl: string;
          if (linkUrl.startsWith('http')) {
            fullUrl = linkUrl;
          } else {
            // Resolve against current learning journey's base URL
            const baseUrl = activeTab?.content?.metadata?.learningJourney?.baseUrl || 'https://grafana.com';
            try {
              fullUrl = new URL(linkUrl, baseUrl).href;
            } catch (error) {
              console.warn('Failed to resolve side journey URL:', linkUrl, error);
              // Fallback to grafana.com only if resolution fails
              fullUrl = linkUrl.startsWith('/')
                ? `https://grafana.com${linkUrl}`
                : `https://grafana.com/docs/${linkUrl}`;
            }
          }

          // Check if URL passes security validation for in-app opening
          if (isValidGrafanaContentUrl(fullUrl)) {
            // Open side journey links in new app tabs (as docs pages)
            if ('openDocsPage' in model && typeof model.openDocsPage === 'function') {
              (model as any).openDocsPage(fullUrl, linkTitle);
            } else {
              // Fallback to learning journey handler
              model.openLearningJourney(fullUrl, linkTitle);
            }

            // Track analytics for side journey clicks as extra resource
            reportAppInteraction(
              UserInteraction.OpenExtraResource,
              enrichWithStepContext(
                enrichWithJourneyContext(
                  {
                    content_url: fullUrl,
                    content_type: getContentTypeForAnalytics(fullUrl, 'docs'),
                    link_text: linkTitle,
                    source_page: activeTab?.content?.url || 'unknown',
                    link_type: 'side_journey',
                    interaction_location: 'side_journey_link',
                  },
                  activeTab?.content
                )
              )
            );
          } else if (fullUrl.startsWith('http')) {
            // External URL - open in browser tab instead of blocking
            // Track analytics for external side journey link clicks
            reportAppInteraction(
              UserInteraction.OpenExtraResource,
              enrichWithStepContext(
                enrichWithJourneyContext(
                  {
                    content_url: fullUrl,
                    content_type: getContentTypeForAnalytics(fullUrl, 'docs'),
                    link_text: linkTitle,
                    source_page: activeTab?.content?.url || 'unknown',
                    link_type: 'side_journey_external',
                    interaction_location: 'side_journey_link',
                  },
                  activeTab?.content
                )
              )
            );

            // Delay to ensure analytics event is sent before opening new tab
            setTimeout(() => {
              window.open(fullUrl, '_blank', 'noopener,noreferrer');
            }, 100);
          }
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
          // Convert relative URLs to full URLs
          // Related journey links come from metadata and should resolve against the journey base
          let fullUrl: string;
          if (linkUrl.startsWith('http')) {
            fullUrl = linkUrl;
          } else {
            // Resolve against current learning journey's base URL
            const baseUrl = activeTab?.content?.metadata?.learningJourney?.baseUrl || 'https://grafana.com';
            try {
              fullUrl = new URL(linkUrl, baseUrl).href;
            } catch (error) {
              console.warn('Failed to resolve related journey URL:', linkUrl, error);
              // Fallback to grafana.com only if resolution fails
              fullUrl = linkUrl.startsWith('/')
                ? `https://grafana.com${linkUrl}`
                : `https://grafana.com/docs/${linkUrl}`;
            }
          }

          // Check if URL passes security validation for in-app opening
          if (isValidGrafanaContentUrl(fullUrl)) {
            model.openLearningJourney(fullUrl, linkTitle);

            // Track analytics for related journey clicks
            reportAppInteraction(
              UserInteraction.OpenExtraResource,
              enrichWithStepContext(
                enrichWithJourneyContext(
                  {
                    content_url: fullUrl,
                    content_type: getContentTypeForAnalytics(fullUrl, 'learning-journey'),
                    link_text: linkTitle,
                    source_page: activeTab?.content?.url || 'unknown',
                    link_type: 'related_journey',
                    interaction_location: 'related_journey_link',
                  },
                  activeTab?.content
                )
              )
            );
          } else if (fullUrl.startsWith('http')) {
            // External URL - open in browser tab instead of blocking
            // Track analytics for external related journey link clicks
            reportAppInteraction(
              UserInteraction.OpenExtraResource,
              enrichWithStepContext(
                enrichWithJourneyContext(
                  {
                    content_url: fullUrl,
                    content_type: getContentTypeForAnalytics(fullUrl, 'docs'),
                    link_text: linkTitle,
                    source_page: activeTab?.content?.url || 'unknown',
                    link_type: 'related_journey_external',
                    interaction_location: 'related_journey_link',
                  },
                  activeTab?.content
                )
              )
            );

            // Delay to ensure analytics event is sent before opening new tab
            setTimeout(() => {
              window.open(fullUrl, '_blank', 'noopener,noreferrer');
            }, 100);
          }
        }
      }

      // Handle bottom navigation buttons (Previous/Next) with data-journey-nav attribute
      const journeyNavButton = target.closest('[data-journey-nav]') as HTMLElement;

      if (journeyNavButton) {
        safeEventHandler(event, {
          preventDefault: true,
          stopPropagation: true,
        });

        const navDirection = journeyNavButton.getAttribute('data-journey-nav');
        const activeTab = model.getActiveTab();

        if (navDirection === 'prev' && model.canNavigatePrevious()) {
          reportAppInteraction(UserInteraction.MilestoneArrowInteractionClick, {
            content_title: activeTab?.title || 'unknown',
            content_url: activeTab?.baseUrl || 'unknown',
            current_milestone: activeTab?.content?.metadata.learningJourney?.currentMilestone || 0,
            total_milestones: activeTab?.content?.metadata.learningJourney?.totalMilestones || 0,
            direction: 'backward',
            interaction_location: 'bottom_navigation',
            completion_percentage: activeTab?.content ? getJourneyProgress(activeTab.content) : 0,
          });
          model.navigateToPreviousMilestone();
        } else if (navDirection === 'next' && model.canNavigateNext()) {
          reportAppInteraction(UserInteraction.MilestoneArrowInteractionClick, {
            content_title: activeTab?.title || 'unknown',
            content_url: activeTab?.baseUrl || 'unknown',
            current_milestone: activeTab?.content?.metadata.learningJourney?.currentMilestone || 0,
            total_milestones: activeTab?.content?.metadata.learningJourney?.totalMilestones || 0,
            direction: 'forward',
            interaction_location: 'bottom_navigation',
            completion_percentage: activeTab?.content ? getJourneyProgress(activeTab.content) : 0,
          });
          model.navigateToNextMilestone();
        }
      }

      // Also handle buttons with specific text content as fallback
      const button = target.closest('button') as HTMLButtonElement;

      if (button && !journeyNavButton) {
        const buttonText = button.textContent?.trim().toLowerCase();

        // Check if this looks like a navigation button in the content area
        if (
          (buttonText?.includes('previous') || buttonText?.includes('prev') || buttonText?.includes('←')) &&
          button.closest('[class*="content"]')
        ) {
          safeEventHandler(event, {
            preventDefault: true,
            stopPropagation: true,
          });
          if (model.canNavigatePrevious()) {
            model.navigateToPreviousMilestone();
          }
        } else if (
          (buttonText?.includes('next') || buttonText?.includes('→')) &&
          button.closest('[class*="content"]')
        ) {
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
  }, [contentRef, theme, activeTab?.content, activeTab?.baseUrl, activeTab?.title, model]);
}

function createImageLightbox(imageSrc: string, imageAlt: string, theme: GrafanaTheme2) {
  // Prevent multiple modals
  if (document.querySelector('.journey-image-modal')) {
    return;
  }

  // SECURITY: Use DOM methods instead of innerHTML to prevent XSS
  // Building the modal structure safely using createElement and textContent

  const imageModal = document.createElement('div');
  imageModal.className = 'journey-image-modal';

  const backdrop = document.createElement('div');
  backdrop.className = 'journey-image-modal-backdrop';

  const container = document.createElement('div');
  container.className = 'journey-image-modal-container';

  // Header section
  const header = document.createElement('div');
  header.className = 'journey-image-modal-header';

  // Title - SECURITY: Use textContent to prevent HTML injection
  const title = document.createElement('h3');
  title.className = 'journey-image-modal-title';
  title.textContent = imageAlt; // Safe: textContent escapes HTML

  // Close button
  const closeButton = document.createElement('button');
  closeButton.className = 'journey-image-modal-close';
  closeButton.setAttribute('aria-label', 'Close image');

  // SVG close icon (safe - no user input)
  closeButton.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  `;

  header.appendChild(title);
  header.appendChild(closeButton);

  // Content section
  const content = document.createElement('div');
  content.className = 'journey-image-modal-content';

  // Image - SECURITY: Use setAttribute to safely set src and alt
  const image = document.createElement('img');
  image.className = 'journey-image-modal-image';
  image.setAttribute('src', imageSrc); // Safe: setAttribute escapes
  image.setAttribute('alt', imageAlt); // Safe: setAttribute escapes

  content.appendChild(image);

  // Assemble modal structure
  container.appendChild(header);
  container.appendChild(content);
  backdrop.appendChild(container);
  imageModal.appendChild(backdrop);

  document.body.appendChild(imageModal);

  // Close modal utility
  const closeModal = () => {
    document.body.removeChild(imageModal);
    document.body.style.overflow = '';
  };

  // Close on backdrop click - use direct reference instead of querySelector
  backdrop.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      closeModal();
    }
  });

  // Close on close button click - use direct reference instead of querySelector
  closeButton.addEventListener('click', closeModal);

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
