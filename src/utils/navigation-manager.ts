import { waitForReactUpdates } from './requirements-checker.hook';
import { INTERACTIVE_CONFIG } from '../constants/interactive-config';
import logoSvg from '../img/logo.svg';
import { isElementVisible, hasFixedPosition, isInViewport, getScrollParent } from './element-validator';

export interface NavigationOptions {
  checkContext?: boolean;
  logWarnings?: boolean;
  ensureDocked?: boolean;
}

export class NavigationManager {
  private activeCleanupHandlers: Array<() => void> = [];

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
        const rect = element.getBoundingClientRect();
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        const scrollLeft = window.scrollX || document.documentElement.scrollLeft;

        // Update highlight position
        highlightOutline.style.setProperty('--highlight-top', `${rect.top + scrollTop - 4}px`);
        highlightOutline.style.setProperty('--highlight-left', `${rect.left + scrollLeft - 4}px`);
        highlightOutline.style.setProperty('--highlight-width', `${rect.width + 8}px`);
        highlightOutline.style.setProperty('--highlight-height', `${rect.height + 8}px`);

        // Update comment box position if it exists
        if (commentBox) {
          const commentWidth = 250;
          const margin = 16;
          let left = rect.right + scrollLeft + margin;
          let arrowPosition = 'left';

          if (left + commentWidth > window.innerWidth) {
            left = rect.left + scrollLeft - commentWidth - margin;
            arrowPosition = 'right';
          }

          if (left < 0) {
            left = rect.left + scrollLeft + (rect.width - commentWidth) / 2;
            arrowPosition = 'bottom';
          }

          const top = rect.top + scrollTop + (rect.height - 60) / 2;
          commentBox.style.setProperty('--comment-top', `${Math.max(8, top)}px`);
          commentBox.style.setProperty('--comment-left', `${Math.max(8, left)}px`);
          commentBox.style.setProperty('--comment-arrow-position', arrowPosition);
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

    // 2. Skip scrolling for fixed/sticky elements already in viewport
    if (hasFixedPosition(element) && isInViewport(element)) {
      return; // Already visible, no scroll needed
    }

    // 3. Check if element is already in viewport
    if (isInViewport(element)) {
      return; // Already visible, no scroll needed
    }

    // 4. Handle custom scroll containers (Grafana panels, modals, nested divs)
    const scrollContainer = getScrollParent(element);

    if (scrollContainer !== document.documentElement) {
      // Custom scroll container - use manual scrolling
      await this.scrollInCustomContainer(element, scrollContainer);
    } else {
      // Standard document scrolling
      element.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'center',
      });

      // Wait for scroll animation to complete
      await this.waitForScrollComplete(element);
    }

    // Add small DOM settling delay after scroll completes to ensure element position is stable
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  /**
   * Scroll element into view within a custom scroll container
   * Handles nested scrollable containers like Grafana panels or modals
   *
   * @param element - The element to scroll into view
   * @param container - The scrollable container
   * @returns Promise that resolves when scrolling is complete
   */
  private async scrollInCustomContainer(element: HTMLElement, container: HTMLElement): Promise<void> {
    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();

    // Check if element is outside container viewport
    if (elementRect.top < containerRect.top || elementRect.bottom > containerRect.bottom) {
      // Calculate scroll offset to center element in container
      const scrollOffset = elementRect.top - containerRect.top - (containerRect.height - elementRect.height) / 2;

      container.scrollBy({
        top: scrollOffset,
        behavior: 'smooth',
      });

      // Wait for scroll to complete
      await this.waitForScrollComplete(container);
    }
  }

  private waitForScrollComplete(
    element: HTMLElement,
    fallbackTimeout = INTERACTIVE_CONFIG.delays.navigation.scrollFallbackTimeout
  ): Promise<void> {
    return new Promise((resolve) => {
      let scrollTimeout: NodeJS.Timeout;
      let fallbackTimeoutId: NodeJS.Timeout;

      const handleScroll = () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
          // Clean up event listener
          element.removeEventListener('scroll', handleScroll);
          clearTimeout(fallbackTimeoutId);
          resolve();
        }, INTERACTIVE_CONFIG.delays.navigation.scrollTimeout);
      };

      // Add event listener
      element.addEventListener('scroll', handleScroll);

      // Fallback timeout with cleanup
      fallbackTimeoutId = setTimeout(() => {
        // Clean up event listener
        element.removeEventListener('scroll', handleScroll);
        clearTimeout(scrollTimeout);
        resolve();
      }, fallbackTimeout);
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
   * @returns Promise that resolves when highlighting is complete
   */
  async highlightWithComment(element: HTMLElement, comment?: string, enableAutoCleanup = true): Promise<HTMLElement> {
    // Clear any existing highlights before showing new one
    this.clearAllHighlights();

    // First, ensure navigation is open and element is visible
    await this.ensureNavigationOpen(element);
    await this.ensureElementVisible(element);

    // DOM settling delay after scroll to ensure accurate element positioning
    // This prevents highlight positioning issues when DOM hasn't fully settled
    await new Promise((resolve) => setTimeout(resolve, INTERACTIVE_CONFIG.delays.navigation.domSettlingDelay));

    // Add highlight class for better styling
    element.classList.add('interactive-highlighted');

    // Create a highlight outline element
    const highlightOutline = document.createElement('div');
    highlightOutline.className = 'interactive-highlight-outline';

    // Position the outline around the target element using CSS custom properties
    const rect = element.getBoundingClientRect();
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const scrollLeft = window.scrollX || document.documentElement.scrollLeft;

    // Use CSS custom properties instead of inline styles to avoid CSP violations
    highlightOutline.style.setProperty('--highlight-top', `${rect.top + scrollTop - 4}px`);
    highlightOutline.style.setProperty('--highlight-left', `${rect.left + scrollLeft - 4}px`);
    highlightOutline.style.setProperty('--highlight-width', `${rect.width + 8}px`);
    highlightOutline.style.setProperty('--highlight-height', `${rect.height + 8}px`);

    document.body.appendChild(highlightOutline);

    // Create comment box if comment is provided
    let commentBox: HTMLElement | null = null;
    if (comment && comment.trim()) {
      commentBox = this.createCommentBox(comment, rect, scrollTop, scrollLeft);
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
  private createCommentBox(comment: string, targetRect: DOMRect, scrollTop: number, scrollLeft: number): HTMLElement {
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

    // Create text container with HTML support
    const textContainer = document.createElement('div');
    textContainer.className = 'interactive-comment-text';
    textContainer.innerHTML = comment; // Use innerHTML to support rich HTML content

    // Create content wrapper
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'interactive-comment-wrapper';
    contentWrapper.appendChild(logoContainer);
    contentWrapper.appendChild(textContainer);

    content.appendChild(contentWrapper);

    const arrow = document.createElement('div');
    arrow.className = 'interactive-comment-arrow';

    commentBox.appendChild(content);
    commentBox.appendChild(arrow);

    // Position comment box (to the right of the target, or left if no space)
    const commentWidth = 250; // Fixed width for consistency
    const commentHeight = 60; // Estimated height, will be auto-adjusted
    const margin = 16; // Space between target and comment

    let left = targetRect.right + scrollLeft + margin;
    let arrowPosition = 'left';

    // If comment box would go off-screen to the right, position it to the left
    if (left + commentWidth > window.innerWidth) {
      left = targetRect.left + scrollLeft - commentWidth - margin;
      arrowPosition = 'right';
    }

    // If still off-screen, center it above/below the target
    if (left < 0) {
      left = targetRect.left + scrollLeft + (targetRect.width - commentWidth) / 2;
      arrowPosition = 'bottom';
      // Position above the target
      commentBox.style.setProperty('--comment-top', `${targetRect.top + scrollTop - commentHeight - margin}px`);
    } else {
      // Vertically center with the target
      const top = targetRect.top + scrollTop + (targetRect.height - commentHeight) / 2;
      commentBox.style.setProperty('--comment-top', `${top}px`);
    }

    // Set position using CSS custom properties
    commentBox.style.setProperty('--comment-left', `${Math.max(8, left)}px`);
    commentBox.style.setProperty('--comment-arrow-position', arrowPosition);

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
        console.warn(
          '⚠️ Mega menu toggle button not found - navigation may already be open or use different structure'
        );
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
          console.warn('⚠️ Dock menu button not found, navigation will remain in modal mode');
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
