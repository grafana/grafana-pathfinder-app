import { useEffect } from 'react';
import { GrafanaTheme2 } from '@grafana/data';

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

      // Handle image lightbox clicks
      const image = target.closest('img') as HTMLImageElement;
      
      if (image && !image.classList.contains('journey-conclusion-header')) {
        event.preventDefault();
        event.stopPropagation();
        
        const imageSrc = image.src;
        const imageAlt = image.alt || 'Image';
        
        // Create image lightbox modal with theme awareness
        createImageLightbox(imageSrc, imageAlt, theme);
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

      // Handle bottom navigation buttons (Previous/Next)
      const bottomNavButton = target.closest('.journey-bottom-nav-button') as HTMLElement;
      
      if (bottomNavButton) {
        event.preventDefault();
        event.stopPropagation();
        
        const buttonText = bottomNavButton.textContent?.trim().toLowerCase();
        
        if (buttonText?.includes('previous') || buttonText?.includes('prev')) {
          console.log('🔗 Bottom Previous button clicked');
          if (model.canNavigatePrevious()) {
            model.navigateToPreviousMilestone();
          } else {
            console.log('⚠️ Cannot navigate to previous milestone');
          }
        } else if (buttonText?.includes('next')) {
          console.log('🔗 Bottom Next button clicked');
          if (model.canNavigateNext()) {
            model.navigateToNextMilestone();
          } else {
            console.log('⚠️ Cannot navigate to next milestone');
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
          event.preventDefault();
          event.stopPropagation();
          console.log('🔗 Generic Previous button clicked');
          if (model.canNavigatePrevious()) {
            model.navigateToPreviousMilestone();
          }
        } else if ((buttonText?.includes('next') || buttonText?.includes('→')) && 
                   button.closest('[class*="content"]')) {
          event.preventDefault();
          event.stopPropagation();
          console.log('🔗 Generic Next button clicked');
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
