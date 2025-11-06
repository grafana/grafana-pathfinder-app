import { waitForReactUpdates } from './requirements-checker.hook';
import { INTERACTIVE_CONFIG } from '../constants/interactive-config';
import logoSvg from '../img/logo.svg';
import { isElementVisible, getScrollParent, getStickyHeaderOffset } from './element-validator';
import { sanitizeDocumentationHTML } from './security/html-sanitizer';

export interface NavigationOptions {
  checkContext?: boolean;
  logWarnings?: boolean;
  ensureDocked?: boolean;
}

export class NavigationManager {
  private activeCleanupHandlers: Array<() => void> = [];

  /**
   * Calculate optimal position for comment box ensuring it stays fully on screen
   * Tries positions in order: right, left, bottom, top
   * Returns the first position that fits without going off-screen
   */
  private calculateOptimalCommentPosition(
    targetRect: DOMRect,
    scrollTop: number,
    scrollLeft: number,
    commentBox: HTMLElement
  ): { top: number; left: number; arrowPosition: string } {
    const margin = 16; // Space between target and comment
    const padding = 8; // Minimum padding from viewport edges

    // Get comment box dimensions (might vary based on content)
    const commentWidth = 320; // Fixed width from CSS (increased for better readability with step checklists)
    const commentHeight = commentBox.offsetHeight || 130; // Actual height, fallback to 130 (increased for larger font/line-height)

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Helper to check if a position is valid (fully on screen)
    const isValidPosition = (top: number, left: number): boolean => {
      return (
        left >= padding &&
        left + commentWidth <= viewportWidth - padding &&
        top >= padding &&
        top + commentHeight <= viewportHeight + scrollTop - padding
      );
    };

    // Try position 1: Right side (preferred)
    let left = targetRect.right + scrollLeft + margin;
    let top = targetRect.top + scrollTop + (targetRect.height - commentHeight) / 2;
    if (isValidPosition(top, left)) {
      return { top: Math.max(padding, top), left, arrowPosition: 'left' };
    }

    // Try position 2: Left side
    left = targetRect.left + scrollLeft - commentWidth - margin;
    top = targetRect.top + scrollTop + (targetRect.height - commentHeight) / 2;
    if (isValidPosition(top, left)) {
      return { top: Math.max(padding, top), left: Math.max(padding, left), arrowPosition: 'right' };
    }

    // Try position 3: Bottom (below target)
    left = targetRect.left + scrollLeft + (targetRect.width - commentWidth) / 2;
    top = targetRect.bottom + scrollTop + margin;
    if (isValidPosition(top, left)) {
      return {
        top,
        left: Math.max(padding, Math.min(left, viewportWidth - commentWidth - padding)),
        arrowPosition: 'top',
      };
    }

    // Try position 4: Top (above target)
    left = targetRect.left + scrollLeft + (targetRect.width - commentWidth) / 2;
    top = targetRect.top + scrollTop - commentHeight - margin;
    if (isValidPosition(top, left)) {
      return {
        top: Math.max(padding, top),
        left: Math.max(padding, Math.min(left, viewportWidth - commentWidth - padding)),
        arrowPosition: 'bottom',
      };
    }

    // Fallback: Force it to fit on right side with adjustments
    // This ensures we always have a position even if none of the ideal positions work
    left = Math.min(targetRect.right + scrollLeft + margin, viewportWidth - commentWidth - padding);
    top = targetRect.top + scrollTop + (targetRect.height - commentHeight) / 2;
    top = Math.max(padding, Math.min(top, viewportHeight + scrollTop - commentHeight - padding));

    return { top, left, arrowPosition: 'left' };
  }

  /**
   * Clear all existing highlights and comment boxes from the page
   * Called before showing new highlights to prevent stacking
   */
  clearAllHighlights(): void {
    // First, cleanup any active auto-cleanup handlers
    this.cleanupAutoHandlers();
    // Remove all existing highlight outlines
    document.querySelectorAll('.interactive-highlight-outline').forEach((el) => el.remove());

    // Remove all existing comment boxes
    document.querySelectorAll('.interactive-comment-box').forEach((el) => el.remove());

    // Remove highlighted class from all elements
    document.querySelectorAll('.interactive-highlighted, .interactive-guided-active').forEach((el) => {
      el.classList.remove('interactive-highlighted');
      el.classList.remove('interactive-guided-active');
    });
  }

  /**
   * Clean up all active auto-cleanup handlers
   * Disconnects IntersectionObservers and removes click listeners
   */
  private cleanupAutoHandlers(): void {
    // Execute all cleanup functions (disconnect observers, remove listeners)
    this.activeCleanupHandlers.forEach((handler) => handler());
    this.activeCleanupHandlers = [];
  }

  /**
   * Set up position tracking for highlights
   * Updates highlight position when element moves (resize, dynamic content, etc.)
   */
  private setupPositionTracking(
    element: HTMLElement,
    highlightOutline: HTMLElement,
    commentBox: HTMLElement | null
  ): void {
    let updateTimeout: NodeJS.Timeout | null = null;

    const updatePosition = () => {
      // Debounce updates to avoid excessive recalculations
      if (updateTimeout) {
        clearTimeout(updateTimeout);
      }

      updateTimeout = setTimeout(() => {
        // Check if element is still connected to DOM
        if (!element.isConnected) {
          // Element was removed from DOM - hide highlight
          highlightOutline.style.display = 'none';
          if (commentBox) {
            commentBox.style.display = 'none';
          }
          return;
        }

        const rect = element.getBoundingClientRect();
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        const scrollLeft = window.scrollX || document.documentElement.scrollLeft;

        // Check for invalid positions:
        // 1. Element has collapsed to 0,0 (disappeared)
        // 2. Element is at top-left corner (0,0) with no scroll offset
        // 3. Element has zero or near-zero dimensions
        const isAtOrigin = rect.top === 0 && rect.left === 0 && scrollTop === 0 && scrollLeft === 0;
        const hasNoDimensions = rect.width < 1 || rect.height < 1;

        if (isAtOrigin || hasNoDimensions) {
          // Element is in invalid state - hide highlight
          highlightOutline.style.display = 'none';
          if (commentBox) {
            commentBox.style.display = 'none';
          }
          return;
        }

        // Element is valid - ensure highlight is visible and update position
        highlightOutline.style.display = '';
        if (commentBox) {
          commentBox.style.display = '';
        }

        // Update highlight position
        highlightOutline.style.setProperty('--highlight-top', `${rect.top + scrollTop - 4}px`);
        highlightOutline.style.setProperty('--highlight-left', `${rect.left + scrollLeft - 4}px`);
        highlightOutline.style.setProperty('--highlight-width', `${rect.width + 8}px`);
        highlightOutline.style.setProperty('--highlight-height', `${rect.height + 8}px`);

        // Update comment box position if it exists
        if (commentBox) {
          const position = this.calculateOptimalCommentPosition(rect, scrollTop, scrollLeft, commentBox);
          commentBox.style.setProperty('--comment-top', `${position.top}px`);
          commentBox.style.setProperty('--comment-left', `${position.left}px`);
          commentBox.style.setProperty('--comment-arrow-position', position.arrowPosition);
        }
      }, 150); // 150ms debounce for smooth updates
    };

    // 1. ResizeObserver - efficient browser-native API for element size changes
    const resizeObserver = new ResizeObserver(() => {
      updatePosition();
    });

    resizeObserver.observe(element);

    // 2. Window resize - handles browser window resizing
    window.addEventListener('resize', updatePosition);

    // 3. CRITICAL FIX: Listen to scroll events on the actual scroll container
    // Use getScrollParent() to find custom scroll containers (tables, modals, panels, etc.)
    const scrollParent = getScrollParent(element);
    if (scrollParent && scrollParent !== document.documentElement) {
      // Custom scroll container found - listen to its scroll events
      scrollParent.addEventListener('scroll', updatePosition, { passive: true });
    }
    // Also listen to document scroll for cases where element might be in both
    window.addEventListener('scroll', updatePosition, { passive: true });

    // Store cleanup for this tracking
    const trackingCleanup = () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition);
      // Clean up custom scroll container listener
      if (scrollParent && scrollParent !== document.documentElement) {
        scrollParent.removeEventListener('scroll', updatePosition);
      }
      if (updateTimeout) {
        clearTimeout(updateTimeout);
      }
    };

    this.activeCleanupHandlers.push(trackingCleanup);
  }

  /**
   * Set up smart auto-cleanup for highlights
   * Clears highlights when user scrolls or clicks outside
   */
  private setupAutoCleanup(element: HTMLElement): void {
    let hasTriggeredCleanup = false; // Flag to prevent double-cleanup

    const cleanup = () => {
      if (hasTriggeredCleanup) {
        return; // Already cleaned up
      }
      hasTriggeredCleanup = true;

      // Remove this handler from active list before clearing
      const handlerIndex = this.activeCleanupHandlers.indexOf(cleanupHandler);
      if (handlerIndex > -1) {
        this.activeCleanupHandlers.splice(handlerIndex, 1);
      }

      this.clearAllHighlights();
    };

    // 1. Simple scroll detection - clear on any scroll (unless section is running)
    const scrollHandler = () => {
      // Check if section blocking is active - if so, don't clear on scroll
      // This allows users to scroll during section execution without losing highlights
      const sectionBlocker = document.getElementById('interactive-blocking-overlay');
      if (sectionBlocker) {
        return; // Section running - don't clear
      }

      cleanup();
    };

    // Add scroll listeners to both window and document (catches all scrolling)
    window.addEventListener('scroll', scrollHandler, { passive: true, capture: true });
    document.addEventListener('scroll', scrollHandler, { passive: true, capture: true });

    // 2. Click outside - clear if user clicks away from highlight area
    const clickOutsideHandler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // Don't clear if clicking:
      // - The highlight outline itself
      // - The comment box
      // - The close buttons
      // - Inside the highlighted element
      if (
        target.closest('.interactive-highlight-outline') ||
        target.closest('.interactive-comment-box') ||
        target.closest('.interactive-highlighted') ||
        target === element ||
        element.contains(target)
      ) {
        return;
      }

      cleanup();
    };

    // Delay adding click listener to avoid immediate trigger from the "Show me" click
    const clickListenerTimeout = setTimeout(() => {
      document.addEventListener('click', clickOutsideHandler, { capture: true });
    }, INTERACTIVE_CONFIG.cleanup.clickOutsideDelay);

    // Store cleanup function
    const cleanupHandler = () => {
      window.removeEventListener('scroll', scrollHandler, { capture: true });
      document.removeEventListener('scroll', scrollHandler, { capture: true });
      clearTimeout(clickListenerTimeout);
      document.removeEventListener('click', clickOutsideHandler, { capture: true });
    };

    this.activeCleanupHandlers.push(cleanupHandler);
  }

  /**
   * Ensure element is visible in the viewport by scrolling it into view
   * Accounts for sticky/fixed headers that may obstruct visibility
   *
   * @param element - The element to make visible
   * @returns Promise that resolves when element is visible in viewport
   *
   * @example
   * ```typescript
   * await navigationManager.ensureElementVisible(hiddenElement);
   * // Element is now visible and centered in viewport
   * ```
   */
  async ensureElementVisible(element: HTMLElement): Promise<void> {
    // 1. Check if element is visible in DOM (not hidden by CSS)
    if (!isElementVisible(element)) {
      console.warn('Element is hidden or not visible:', element);
      // Continue anyway - element might become visible during interaction
    }

    // 2. Calculate sticky header offset to account for headers blocking view
    const stickyOffset = getStickyHeaderOffset(element);

    // 3. Check if element is already visible - if so, skip scrolling!
    const rect = element.getBoundingClientRect();
    const scrollContainer = getScrollParent(element);
    const containerRect =
      scrollContainer === document.documentElement
        ? { top: 0, bottom: window.innerHeight }
        : scrollContainer.getBoundingClientRect();

    // Element is visible if it's within the container bounds (accounting for sticky offset)
    const isVisible = rect.top >= containerRect.top + stickyOffset && rect.bottom <= containerRect.bottom;

    if (isVisible) {
      return; // Already visible, no need to scroll!
    }

    // 4. Set scroll-padding-top on container (modern CSS solution)
    const originalScrollPadding = scrollContainer.style.scrollPaddingTop;
    if (stickyOffset > 0) {
      scrollContainer.style.scrollPaddingTop = `${stickyOffset + 10}px`; // +10px padding
    }

    // 5. Scroll into view with smooth animation
    element.scrollIntoView({
      behavior: 'smooth', // Smooth animation looks better
      block: 'start', // Position at top (below sticky headers due to scroll-padding-top)
      inline: 'nearest',
    });

    // Wait for browser to finish scrolling using modern scrollend event
    await this.waitForScrollEnd(scrollContainer);

    // Restore original scroll padding after scroll completes
    scrollContainer.style.scrollPaddingTop = originalScrollPadding;
  }

  /**
   * Wait for scroll animation to complete using modern scrollend event
   * Browser-native event that fires when scrolling stops (no guessing!)
   * Per MDN: "If scroll position did not change, then no scrollend event fires"
   *
   * @param scrollContainer - The element that is scrolling
   * @returns Promise that resolves when scrolling completes
   */
  private waitForScrollEnd(scrollContainer: HTMLElement): Promise<void> {
    return new Promise((resolve) => {
      let scrollDetected = false;
      let resolved = false;
      let timeoutId: NodeJS.Timeout;

      const cleanup = () => {
        clearTimeout(timeoutId);
        scrollContainer.removeEventListener('scroll', scrollHandler);
        scrollContainer.removeEventListener('scrollend', scrollendHandler);
        document.removeEventListener('scrollend', docScrollendHandler);
      };

      const handleScrollEnd = () => {
        if (resolved) {
          return;
        }
        resolved = true;
        cleanup();
        resolve();
      };

      const scrollHandler = () => {
        scrollDetected = true;
        // Scroll started - now wait for scrollend
      };

      const scrollendHandler = () => handleScrollEnd();
      const docScrollendHandler = () => handleScrollEnd();

      // Detect if scrolling actually happens
      scrollContainer.addEventListener('scroll', scrollHandler, { once: true, passive: true });

      // Listen for scrollend on both container and document
      // Per Chrome blog: scrollIntoView may fire scrollend on different elements
      scrollContainer.addEventListener('scrollend', scrollendHandler, { once: true });
      document.addEventListener('scrollend', docScrollendHandler, { once: true });

      // Safety timeout: If no scroll detected after 200ms, assume no scroll needed
      // This handles edge cases where scrollIntoView is a no-op
      timeoutId = setTimeout(() => {
        if (!scrollDetected && !resolved) {
          handleScrollEnd();
        }
      }, 200);
    });
  }

  /**
   * Highlight an element with visual feedback
   *
   * @param element - The element to highlight
   * @returns Promise that resolves when highlighting is complete
   */
  async highlight(element: HTMLElement): Promise<HTMLElement> {
    return this.highlightWithComment(element);
  }

  /**
   * Highlight an element with optional comment box
   *
   * @param element - The element to highlight
   * @param comment - Optional comment text to display in a comment box
   * @param enableAutoCleanup - Whether to enable auto-cleanup on scroll/click (default: true, false for guided mode)
   * @param stepInfo - Optional step progress info for guided interactions
   * @returns Promise that resolves when highlighting is complete
   */
  async highlightWithComment(
    element: HTMLElement,
    comment?: string,
    enableAutoCleanup = true,
    stepInfo?: { current: number; total: number; completedSteps: number[] }
  ): Promise<HTMLElement> {
    // Clear any existing highlights before showing new one
    this.clearAllHighlights();

    // First, ensure navigation is open and element is visible
    await this.ensureNavigationOpen(element);
    await this.ensureElementVisible(element);

    // No DOM settling delay needed - scrollend event ensures scroll is complete
    // and DOM is stable. Highlight immediately for better responsiveness!

    // Add highlight class for better styling
    element.classList.add('interactive-highlighted');

    // Create a highlight outline element
    const highlightOutline = document.createElement('div');
    highlightOutline.className = 'interactive-highlight-outline';

    // Position the outline around the target element using CSS custom properties
    const rect = element.getBoundingClientRect();
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const scrollLeft = window.scrollX || document.documentElement.scrollLeft;

    // Validate element position and dimensions before creating highlight
    const isAtOrigin = rect.top === 0 && rect.left === 0 && scrollTop === 0 && scrollLeft === 0;
    const hasNoDimensions = rect.width < 1 || rect.height < 1;

    if (isAtOrigin || hasNoDimensions) {
      // Element is in invalid state - don't show highlight
      console.warn('Cannot highlight element: invalid position or dimensions', {
        rect,
        scrollTop,
        scrollLeft,
      });
      // Return early without creating highlight
      return element;
    }

    // Use CSS custom properties instead of inline styles to avoid CSP violations
    highlightOutline.style.setProperty('--highlight-top', `${rect.top + scrollTop - 4}px`);
    highlightOutline.style.setProperty('--highlight-left', `${rect.left + scrollLeft - 4}px`);
    highlightOutline.style.setProperty('--highlight-width', `${rect.width + 8}px`);
    highlightOutline.style.setProperty('--highlight-height', `${rect.height + 8}px`);

    document.body.appendChild(highlightOutline);

    // Create comment box if comment is provided
    let commentBox: HTMLElement | null = null;
    if (comment && comment.trim()) {
      commentBox = this.createCommentBox(comment, rect, scrollTop, scrollLeft, stepInfo);
      document.body.appendChild(commentBox);
    }

    // Highlights and comments now persist until explicitly cleared
    // They will be removed when:
    // 1. User clicks the close button on highlight
    // 2. A new highlight is shown (clearAllHighlights called)
    // 3. Section/guided execution starts
    // 4. (If auto-cleanup enabled) User scrolls
    // 5. (If auto-cleanup enabled) User clicks outside

    // Always set up position tracking (efficient with ResizeObserver)
    this.setupPositionTracking(element, highlightOutline, commentBox);

    // Set up smart auto-cleanup (unless disabled for guided mode)
    if (enableAutoCleanup) {
      this.setupAutoCleanup(element);
    }

    return element;
  }

  /**
   * Create a themed comment box positioned near the highlighted element
   */
  private createCommentBox(
    comment: string,
    targetRect: DOMRect,
    scrollTop: number,
    scrollLeft: number,
    stepInfo?: { current: number; total: number; completedSteps: number[] }
  ): HTMLElement {
    const commentBox = document.createElement('div');
    commentBox.className = 'interactive-comment-box';

    // Create content structure with logo and text
    const content = document.createElement('div');
    content.className = 'interactive-comment-content interactive-comment-glow';

    // Create simple close button in top-right of comment box
    const closeButton = document.createElement('button');
    closeButton.className = 'interactive-comment-close';
    closeButton.innerHTML = '×';
    closeButton.setAttribute('aria-label', 'Close comment');
    closeButton.setAttribute('title', 'Close comment');

    closeButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.clearAllHighlights();
    });

    content.appendChild(closeButton);

    // Create logo container
    const logoContainer = document.createElement('div');
    logoContainer.className = 'interactive-comment-logo';

    // Create img element to reference the logo.svg file (imported at top)
    const logoImg = document.createElement('img');
    logoImg.src = logoSvg;
    logoImg.width = 20;
    logoImg.height = 20;
    logoImg.alt = 'Grafana';
    logoImg.style.display = 'block';

    logoContainer.appendChild(logoImg);

    // Create step checklist if stepInfo is provided (for guided interactions)
    let stepsListContainer: HTMLElement | null = null;
    if (stepInfo) {
      stepsListContainer = document.createElement('div');
      stepsListContainer.className = 'interactive-comment-steps-list';

      for (let i = 0; i < stepInfo.total; i++) {
        const stepItem = document.createElement('div');
        stepItem.className = 'interactive-comment-step-item';

        // Add current step class for highlighting
        if (i === stepInfo.current) {
          stepItem.classList.add('interactive-comment-step-current');
        }

        // Use checked or unchecked box
        const isCompleted = stepInfo.completedSteps.includes(i);
        const checkbox = isCompleted ? '☑' : '☐';
        stepItem.textContent = `${checkbox} Step ${i + 1}`;

        stepsListContainer.appendChild(stepItem);
      }
    }

    // Create text container with HTML support
    const textContainer = document.createElement('div');
    textContainer.className = 'interactive-comment-text';
    // SECURITY: Sanitize comment HTML before insertion to prevent XSS
    textContainer.innerHTML = sanitizeDocumentationHTML(comment || '');

    // Create content wrapper
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'interactive-comment-wrapper';
    contentWrapper.appendChild(logoContainer);

    // Add steps list before the instruction text if available
    if (stepsListContainer) {
      contentWrapper.appendChild(stepsListContainer);
    }

    contentWrapper.appendChild(textContainer);

    content.appendChild(contentWrapper);

    const arrow = document.createElement('div');
    arrow.className = 'interactive-comment-arrow';

    commentBox.appendChild(content);
    commentBox.appendChild(arrow);

    // Add to DOM first so we can measure its actual height
    document.body.appendChild(commentBox);

    // Use intelligent positioning to keep comment box fully on screen
    const position = this.calculateOptimalCommentPosition(targetRect, scrollTop, scrollLeft, commentBox);

    // Set position using CSS custom properties
    commentBox.style.setProperty('--comment-top', `${position.top}px`);
    commentBox.style.setProperty('--comment-left', `${position.left}px`);
    commentBox.style.setProperty('--comment-arrow-position', position.arrowPosition);

    // Remove from DOM - caller will add it back
    commentBox.remove();

    return commentBox;
  }

  /**
   * Ensure navigation is open if the target element is in the navigation area
   *
   * @param element - The target element that may require navigation to be open
   * @returns Promise that resolves when navigation is open and accessible
   *
   * @example
   * ```typescript
   * await navigationManager.ensureNavigationOpen(targetElement);
   * // Navigation menu is now open and docked if needed
   * ```
   */
  async ensureNavigationOpen(element: HTMLElement): Promise<void> {
    return this.openAndDockNavigation(element, {
      checkContext: true, // Only run if element is in navigation
      logWarnings: false, // Silent operation
      ensureDocked: true, // Always dock if open
    });
  }

  /**
   * Fix navigation requirements by opening and docking the navigation menu
   * This function can be called by the "Fix this" button for navigation requirements
   */
  async fixNavigationRequirements(): Promise<void> {
    return this.openAndDockNavigation(undefined, {
      checkContext: false, // Always run regardless of element
      logWarnings: true, // Verbose logging
      ensureDocked: true, // Always dock if open
    });
  }

  /**
   * Fix location requirements by navigating to the expected path
   * This function can be called by the "Fix this" button for location requirements
   */
  async fixLocationRequirement(targetPath: string): Promise<void> {
    const { locationService } = await import('@grafana/runtime');
    locationService.push(targetPath);
    // Wait for navigation to complete and React to update
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  /**
   * Attempt to expand parent navigation sections for nested menu items
   * This function analyzes the target href to determine the parent section and expands it
   */
  async expandParentNavigationSection(targetHref: string): Promise<boolean> {
    try {
      // Check for /a/ pattern (app paths) - immediately expand all sections
      if (targetHref.includes('/a/')) {
        return this.expandAllNavigationSections();
      }

      // Parse the href to find the parent section
      const parentPath = this.getParentPathFromHref(targetHref);
      if (!parentPath) {
        // Fallback: expand all navigation sections if we can't determine the parent path
        return this.expandAllNavigationSections();
      }

      // Look for the parent section's expand button
      const parentExpandButton = this.findParentExpandButton(parentPath);
      if (!parentExpandButton) {
        // Fallback: expand all navigation sections if we can't find the specific parent
        return this.expandAllNavigationSections();
      }

      // Check if the parent section is already expanded
      const isExpanded = this.isParentSectionExpanded(parentExpandButton);
      if (isExpanded) {
        return true; // Already expanded, so this is success
      }

      // Click the expand button to reveal nested items
      parentExpandButton.click();

      // Wait for expansion animation to complete
      await new Promise((resolve) => setTimeout(resolve, 300));

      return true;
    } catch (error) {
      console.error('Failed to expand parent navigation section:', error);
      return false;
    }
  }

  /**
   * Extract parent path from href (e.g., '/alerting/list' -> '/alerting')
   */
  private getParentPathFromHref(href: string): string | null {
    if (!href || !href.startsWith('/')) {
      return null;
    }

    // Split path and get parent
    const pathSegments = href.split('/').filter(Boolean);
    if (pathSegments.length <= 1) {
      return null; // No parent for top-level paths
    }

    // Return parent path
    return `/${pathSegments[0]}`;
  }

  /**
   * Find the expand button for a parent navigation section
   */
  private findParentExpandButton(parentPath: string): HTMLButtonElement | null {
    // Strategy 1: Look for parent link, then find its expand button sibling
    const parentLink = document.querySelector(`a[data-testid="data-testid Nav menu item"][href="${parentPath}"]`);
    if (parentLink) {
      // Look for expand button in the same container
      const container = parentLink.closest('li, div');
      if (container) {
        const expandButton = container.querySelector('button[aria-label*="Expand section"]') as HTMLButtonElement;
        if (expandButton) {
          return expandButton;
        }
      }
    }

    // Strategy 2: Look for expand button by aria-label containing the section name
    const sectionName = parentPath.substring(1); // Remove leading slash
    const capitalizedName = sectionName.charAt(0).toUpperCase() + sectionName.slice(1);

    const expandButton = document.querySelector(
      `button[aria-label*="Expand section: ${capitalizedName}"]`
    ) as HTMLButtonElement;
    if (expandButton) {
      return expandButton;
    }

    // Strategy 3: Look for any expand button near the parent link
    if (parentLink) {
      const nearbyButtons = parentLink.parentElement?.querySelectorAll('button') || [];
      for (const button of nearbyButtons) {
        const ariaLabel = button.getAttribute('aria-label') || '';
        if (ariaLabel.includes('Expand') || ariaLabel.includes('expand')) {
          return button as HTMLButtonElement;
        }
      }
    }

    return null;
  }

  /**
   * Check if a parent section is already expanded by examining the expand button state
   */
  private isParentSectionExpanded(expandButton: HTMLButtonElement): boolean {
    // Check aria-expanded attribute
    const ariaExpanded = expandButton.getAttribute('aria-expanded');
    if (ariaExpanded === 'true') {
      return true;
    }

    // Check if the button has collapsed/expanded classes or icons
    const ariaLabel = expandButton.getAttribute('aria-label') || '';

    // If aria-label says "Collapse" instead of "Expand", it's already expanded
    if (ariaLabel.includes('Collapse') || ariaLabel.includes('collapse')) {
      return true;
    }

    // Check for visual indicators (chevron direction, etc.)
    const svg = expandButton.querySelector('svg');
    if (svg) {
      // This is heuristic - in many UI frameworks, expanded sections have rotated chevrons
      const transform = window.getComputedStyle(svg).transform;
      if (transform && transform !== 'none' && transform.includes('rotate')) {
        return true;
      }
    }

    return false; // Default to collapsed if we can't determine state
  }

  /**
   * Expand all collapsible navigation sections
   * This is used as a fallback when we can't determine the specific parent section
   */
  async expandAllNavigationSections(): Promise<boolean> {
    try {
      // Find all expand buttons in the navigation
      const expandButtons = document.querySelectorAll(
        'button[aria-label*="Expand section"]'
      ) as NodeListOf<HTMLButtonElement>;

      if (expandButtons.length === 0) {
        return false; // No expandable sections found
      }

      let expandedAny = false;

      // Click all expand buttons that are currently collapsed
      for (const button of expandButtons) {
        if (!this.isParentSectionExpanded(button)) {
          button.click();
          expandedAny = true;
        }
      }

      if (expandedAny) {
        // Wait for all expansion animations to complete
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      return true;
    } catch (error) {
      console.error('Failed to expand all navigation sections:', error);
      return false;
    }
  }

  /**
   * Interactive steps that use the nav require that it be open.  This function will ensure
   * that it's open so that other steps can be executed.
   * @param element - The element that may require navigation to be open
   * @param options - The options for the navigation
   * @param options.checkContext - Whether to check if the element is within navigation (default false)
   * @param options.logWarnings - Whether to log warnings (default true)
   * @param options.ensureDocked - Whether to ensure the navigation is docked when we're done. (default true)
   * @returns Promise that resolves when navigation is properly configured
   */
  async openAndDockNavigation(element?: HTMLElement, options: NavigationOptions = {}): Promise<void> {
    const { checkContext = false, logWarnings = true, ensureDocked = true } = options;

    // Check if element is within navigation (only if checkContext is true)
    if (checkContext && element) {
      const isInNavigation = element.closest('nav, [class*="nav"], [class*="menu"], [class*="sidebar"]') !== null;
      if (!isInNavigation) {
        return;
      }
    }

    // Look for the mega menu toggle button
    const megaMenuToggle = document.querySelector('#mega-menu-toggle') as HTMLButtonElement;
    if (!megaMenuToggle) {
      if (logWarnings) {
        console.warn('Mega menu toggle button not found - navigation may already be open or use different structure');
      }
      return;
    }

    // Check if navigation appears to be closed
    const ariaExpanded = megaMenuToggle.getAttribute('aria-expanded');
    const isNavClosed = ariaExpanded === 'false' || ariaExpanded === null;

    if (isNavClosed) {
      megaMenuToggle.click();

      await waitForReactUpdates();

      const dockMenuButton = document.querySelector('#dock-menu-button') as HTMLButtonElement;
      if (dockMenuButton) {
        dockMenuButton.click();

        await waitForReactUpdates();
        return;
      } else {
        if (logWarnings) {
          console.warn('Dock menu button not found, navigation will remain in modal mode');
        }
        return;
      }
    } else if (ensureDocked) {
      // Navigation is already open, just try to dock it if needed
      const dockMenuButton = document.querySelector('#dock-menu-button') as HTMLButtonElement;
      if (dockMenuButton) {
        dockMenuButton.click();
        await waitForReactUpdates();
        return;
      } else {
        return;
      }
    }

    return;
  }
}
