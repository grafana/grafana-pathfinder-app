import { waitForReactUpdates } from '../requirements-manager';
import { INTERACTIVE_CONFIG } from '../constants/interactive-config';
import logoSvg from '../img/logo.svg';
import { isElementVisible, getScrollParent, getStickyHeaderOffset, getVisibleHighlightTarget } from '../lib/dom';
import { sanitizeDocumentationHTML } from '../security';
import { applyE2ECommentBoxAttributes } from './e2e-attributes';

export interface NavigationOptions {
  checkContext?: boolean;
  logWarnings?: boolean;
  ensureDocked?: boolean;
}

export class NavigationManager {
  private activeCleanupHandlers: Array<() => void> = [];

  // Drift detection state for guided mode
  private driftDetectionRafHandle: number | null = null;
  private driftDetectionLastCheck = 0;
  private driftDetectionElement: HTMLElement | null = null;
  private driftDetectionHighlight: HTMLElement | null = null;
  private driftDetectionComment: HTMLElement | null = null;
  private driftDetectionIsDotMode = false;

  /**
   * Clear all existing highlights and comment boxes from the page
   * Called before showing new highlights to prevent stacking
   */
  clearAllHighlights(): void {
    // First, stop any active drift detection RAF loop
    this.stopDriftDetection();

    // Cleanup any active auto-cleanup handlers (ResizeObserver, event listeners, etc.)
    this.cleanupAutoHandlers();

    // Remove all existing highlight outlines and dot indicators
    document
      .querySelectorAll('.interactive-highlight-outline, .interactive-highlight-dot')
      .forEach((el) => el.remove());

    // Remove all existing comment boxes
    document.querySelectorAll('.interactive-comment-box').forEach((el) => el.remove());

    // Remove highlighted class from all elements
    document.querySelectorAll('.interactive-guided-active').forEach((el) => {
      el.classList.remove('interactive-guided-active');
    });
  }

  /**
   * Show a centered comment for noop actions (informational steps without element interaction)
   * Used by multi-step sequences to display step instructions
   */
  showNoopComment(comment: string): void {
    // Clear any existing highlights first
    this.clearAllHighlights();

    // Create a centered comment box
    const commentBox = document.createElement('div');
    commentBox.className = 'interactive-comment-box';
    commentBox.setAttribute('data-position', 'center');
    commentBox.setAttribute('data-ready', 'true');
    commentBox.setAttribute('data-noop', 'true');

    // Build comment box content
    const content = document.createElement('div');
    content.className = 'interactive-comment-content interactive-comment-glow';

    // Logo
    const logoContainer = document.createElement('div');
    logoContainer.className = 'interactive-comment-logo';
    const logo = document.createElement('img');
    logo.src = logoSvg;
    logo.alt = 'Pathfinder';
    logoContainer.appendChild(logo);

    // Text content - sanitize the HTML
    const textContainer = document.createElement('div');
    textContainer.className = 'interactive-comment-text';
    textContainer.innerHTML = sanitizeDocumentationHTML(comment);

    // Content wrapper
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'interactive-comment-wrapper';
    contentWrapper.appendChild(logoContainer);
    contentWrapper.appendChild(textContainer);

    // Assemble the comment box
    content.appendChild(contentWrapper);
    commentBox.appendChild(content);

    // Add to document body (centered via CSS)
    document.body.appendChild(commentBox);
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
   * Start active drift detection for guided mode
   * Uses requestAnimationFrame with throttling to check if highlight has drifted from element
   * Only runs during guided interactions where auto-cleanup is disabled
   */
  private startDriftDetection(
    element: HTMLElement,
    highlightOutline: HTMLElement,
    commentBox: HTMLElement | null,
    isDotMode = false
  ): void {
    // Stop any existing drift detection
    this.stopDriftDetection();

    // Store references for the RAF loop
    this.driftDetectionElement = element;
    this.driftDetectionHighlight = highlightOutline;
    this.driftDetectionComment = commentBox;
    this.driftDetectionLastCheck = 0;
    this.driftDetectionIsDotMode = isDotMode;

    const { driftThreshold, checkIntervalMs } = INTERACTIVE_CONFIG.positionTracking;

    const checkDrift = (timestamp: number) => {
      // Check if we should continue
      if (!this.driftDetectionElement || !this.driftDetectionHighlight) {
        return;
      }

      // Throttle checks to configured interval
      if (timestamp - this.driftDetectionLastCheck < checkIntervalMs) {
        this.driftDetectionRafHandle = requestAnimationFrame(checkDrift);
        return;
      }
      this.driftDetectionLastCheck = timestamp;

      // Check if element is still connected to DOM
      if (!this.driftDetectionElement.isConnected) {
        this.stopDriftDetection();
        return;
      }

      // Get current element center
      const elementRect = this.driftDetectionElement.getBoundingClientRect();
      const elementCenterX = elementRect.left + elementRect.width / 2;
      const elementCenterY = elementRect.top + elementRect.height / 2;

      // Get current highlight center from CSS custom properties
      const highlightStyle = this.driftDetectionHighlight.style;
      const highlightTop = parseFloat(highlightStyle.getPropertyValue('--highlight-top')) || 0;
      const highlightLeft = parseFloat(highlightStyle.getPropertyValue('--highlight-left')) || 0;

      // Calculate highlight center (accounting for scroll)
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const scrollLeft = window.scrollX || document.documentElement.scrollLeft;

      let highlightCenterX: number;
      let highlightCenterY: number;

      if (this.driftDetectionIsDotMode) {
        // For dot mode, highlight position IS the center (dot is centered at that point)
        highlightCenterX = highlightLeft - scrollLeft;
        highlightCenterY = highlightTop - scrollTop;
      } else {
        // For bounding box, calculate center from dimensions
        const highlightWidth = parseFloat(highlightStyle.getPropertyValue('--highlight-width')) || 0;
        const highlightHeight = parseFloat(highlightStyle.getPropertyValue('--highlight-height')) || 0;
        highlightCenterX = highlightLeft - scrollLeft + highlightWidth / 2;
        highlightCenterY = highlightTop - scrollTop + highlightHeight / 2;
      }

      // Calculate drift distance
      const driftX = Math.abs(elementCenterX - highlightCenterX);
      const driftY = Math.abs(elementCenterY - highlightCenterY);
      const totalDrift = Math.sqrt(driftX * driftX + driftY * driftY);

      // If drift exceeds threshold, update position immediately
      if (totalDrift > driftThreshold) {
        if (this.driftDetectionIsDotMode) {
          // Update dot position at element center
          const dotTop = elementRect.top + scrollTop + elementRect.height / 2;
          const dotLeft = elementRect.left + scrollLeft + elementRect.width / 2;
          highlightStyle.setProperty('--highlight-top', `${dotTop}px`);
          highlightStyle.setProperty('--highlight-left', `${dotLeft}px`);
        } else {
          // Update bounding box position
          highlightStyle.setProperty('--highlight-top', `${elementRect.top + scrollTop - 4}px`);
          highlightStyle.setProperty('--highlight-left', `${elementRect.left + scrollLeft - 4}px`);
          highlightStyle.setProperty('--highlight-width', `${elementRect.width + 8}px`);
          highlightStyle.setProperty('--highlight-height', `${elementRect.height + 8}px`);
        }

        // Update comment box position (always body-attached, always absolute)
        if (this.driftDetectionComment) {
          const highlightRect = this.calculateHighlightRect(
            elementRect,
            scrollTop,
            scrollLeft,
            this.driftDetectionIsDotMode
          );

          const commentHeight = this.driftDetectionComment.offsetHeight;
          const { offsetX, offsetY } = this.calculateCommentPosition(elementRect, commentHeight);

          this.driftDetectionComment.style.top = `${highlightRect.top + offsetY}px`;
          this.driftDetectionComment.style.left = `${highlightRect.left + offsetX}px`;
        }
      }

      // Continue the loop
      this.driftDetectionRafHandle = requestAnimationFrame(checkDrift);
    };

    // Start the RAF loop
    this.driftDetectionRafHandle = requestAnimationFrame(checkDrift);
  }

  /**
   * Stop the active drift detection loop
   * Called when highlights are cleared or component unmounts
   */
  private stopDriftDetection(): void {
    if (this.driftDetectionRafHandle !== null) {
      cancelAnimationFrame(this.driftDetectionRafHandle);
      this.driftDetectionRafHandle = null;
    }
    this.driftDetectionElement = null;
    this.driftDetectionHighlight = null;
    this.driftDetectionComment = null;
    this.driftDetectionLastCheck = 0;
    this.driftDetectionIsDotMode = false;
  }

  /**
   * Calculate highlight rect in absolute document coordinates.
   * For dot mode, returns a zero-dimension rect at element center.
   * For bounding box, returns padded rect around element.
   *
   * @param rect - The element's bounding client rect
   * @param scrollTop - Current vertical scroll offset
   * @param scrollLeft - Current horizontal scroll offset
   * @param isDotMode - Whether using dot indicator (true) or bounding box (false)
   * @returns Highlight rect with top, left, width, height in document coordinates
   */
  private calculateHighlightRect(
    rect: DOMRect,
    scrollTop: number,
    scrollLeft: number,
    isDotMode: boolean
  ): { top: number; left: number; width: number; height: number } {
    if (isDotMode) {
      return {
        top: rect.top + scrollTop + rect.height / 2,
        left: rect.left + scrollLeft + rect.width / 2,
        width: 0,
        height: 0,
      };
    }
    return {
      top: rect.top + scrollTop - 4,
      left: rect.left + scrollLeft - 4,
      width: rect.width + 8,
      height: rect.height + 8,
    };
  }

  /**
   * Set up position tracking for highlights
   * Updates highlight position when element moves (resize, dynamic content, etc.)
   *
   * @param element - The target element being highlighted
   * @param highlightElement - The highlight element (outline or dot)
   * @param commentBox - Optional comment box element
   * @param enableDriftDetection - Enable active drift detection (for guided mode)
   * @param isDotMode - Whether the highlight is using dot indicator (skip dimension validation)
   */
  private setupPositionTracking(
    element: HTMLElement,
    highlightElement: HTMLElement,
    commentBox: HTMLElement | null,
    enableDriftDetection = false,
    isDotMode = false
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
          highlightElement.style.display = 'none';
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
        // 3. Element has zero or near-zero dimensions (skip for dot mode - dots work with any dimensions)
        const isAtOrigin = rect.top === 0 && rect.left === 0 && scrollTop === 0 && scrollLeft === 0;
        const hasNoDimensions = rect.width < 1 || rect.height < 1;

        // Skip dimension check for dot mode - dots work even for very small elements
        if (isAtOrigin || (!isDotMode && hasNoDimensions)) {
          // Element is in invalid state - hide highlight
          highlightElement.style.display = 'none';
          if (commentBox) {
            commentBox.style.display = 'none';
          }
          return;
        }

        // Element is valid - ensure highlight is visible and update position
        highlightElement.style.display = '';
        if (commentBox) {
          commentBox.style.display = '';
        }

        // Update highlight position based on mode
        if (isDotMode) {
          // For dots, position at element's center
          const dotTop = rect.top + scrollTop + rect.height / 2;
          const dotLeft = rect.left + scrollLeft + rect.width / 2;
          highlightElement.style.setProperty('--highlight-top', `${dotTop}px`);
          highlightElement.style.setProperty('--highlight-left', `${dotLeft}px`);
        } else {
          // For bounding box, position with 4px padding
          highlightElement.style.setProperty('--highlight-top', `${rect.top + scrollTop - 4}px`);
          highlightElement.style.setProperty('--highlight-left', `${rect.left + scrollLeft - 4}px`);
          highlightElement.style.setProperty('--highlight-width', `${rect.width + 8}px`);
          highlightElement.style.setProperty('--highlight-height', `${rect.height + 8}px`);
        }

        // Update comment box position (always body-attached, always absolute)
        if (commentBox) {
          const highlightRect = this.calculateHighlightRect(rect, scrollTop, scrollLeft, isDotMode);

          const commentHeight = commentBox.offsetHeight;
          const { offsetX, offsetY } = this.calculateCommentPosition(rect, commentHeight);

          commentBox.style.top = `${highlightRect.top + offsetY}px`;
          commentBox.style.left = `${highlightRect.left + offsetX}px`;
        }
      }, INTERACTIVE_CONFIG.positionTracking.debounceMs);
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

    // Start drift detection for guided mode (more responsive than event-based tracking alone)
    // This catches slow DOM renders and position changes that don't trigger resize/scroll events
    if (enableDriftDetection) {
      this.startDriftDetection(element, highlightElement, commentBox, isDotMode);
    }
  }

  /**
   * Set up smart auto-cleanup for highlights
   * Clears highlights when user scrolls or clicks outside
   */
  private setupAutoCleanup(element: HTMLElement): void {
    let hasTriggeredCleanup = false; // Flag to prevent double-cleanup
    // FIX: Grace period to ignore scroll events from ensureElementVisible's scrollIntoView
    // Without this, leftover scroll events immediately clear the highlight
    let isInGracePeriod = true;
    setTimeout(() => {
      isInGracePeriod = false;
    }, 150); // 150ms grace period for scroll events to settle

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
      // FIX: Ignore scroll events during grace period (leftover from scrollIntoView)
      if (isInGracePeriod) {
        return;
      }

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

      // Safety timeout: If no scroll detected, assume no scroll needed
      // This handles edge cases where scrollIntoView is a no-op
      timeoutId = setTimeout(() => {
        if (!scrollDetected && !resolved) {
          handleScrollEnd();
        }
      }, INTERACTIVE_CONFIG.delays.navigation.scrollTimeout);
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
   * @param onSkipCallback - Optional callback when skip button is clicked
   * @param onCancelCallback - Optional callback when cancel button is clicked (for guided mode)
   * @param onNextCallback - Optional callback when next button is clicked (for tour mode)
   * @param onPreviousCallback - Optional callback when previous button is clicked (for tour mode)
   * @param options - Additional options for the comment box
   * @returns Promise that resolves when highlighting is complete
   */
  async highlightWithComment(
    element: HTMLElement,
    comment?: string,
    enableAutoCleanup = true,
    stepInfo?: { current: number; total: number; completedSteps: number[] },
    onSkipCallback?: () => void,
    onCancelCallback?: () => void,
    onNextCallback?: () => void,
    onPreviousCallback?: () => void,
    options?: {
      showKeyboardHint?: boolean;
      stepTitle?: string;
      skipAnimations?: boolean; // For smooth step transitions
      actionType?: 'hover' | 'button' | 'highlight' | 'formfill';
      targetValue?: string;
    }
  ): Promise<HTMLElement> {
    // First, ensure navigation is open and element is visible
    // Keep old highlight visible during this async work for smooth transitions
    await this.ensureNavigationOpen(element);
    await this.ensureElementVisible(element);

    // No DOM settling delay needed - scrollend event ensures scroll is complete
    // and DOM is stable. Highlight immediately for better responsiveness!

    // If selector targeted a hidden input (common in dropdowns), highlight the visible parent instead
    const highlightTarget = getVisibleHighlightTarget(element);

    // Position the outline around the target element using CSS custom properties
    const rect = highlightTarget.getBoundingClientRect();
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const scrollLeft = window.scrollX || document.documentElement.scrollLeft;

    // Check if element has no valid position at all (truly invalid)
    const hasNoPosition = rect.top === 0 && rect.left === 0 && rect.width === 0 && rect.height === 0;
    if (hasNoPosition) {
      console.warn('Cannot highlight element: invalid position or dimensions', {
        rect,
        scrollTop,
        scrollLeft,
      });
      return element;
    }

    // Determine if we should use dot indicator instead of bounding box
    const isSmallElement =
      rect.width < INTERACTIVE_CONFIG.highlighting.minDimensionForBox ||
      rect.height < INTERACTIVE_CONFIG.highlighting.minDimensionForBox;
    const isHiddenElement = !isElementVisible(highlightTarget);
    const useDotIndicator = isSmallElement || isHiddenElement;

    // For hidden elements, ALWAYS prepend warning to comment (regardless of size)
    let effectiveComment = comment;
    if (isHiddenElement) {
      const hiddenWarning = 'Item may be hidden due to screen size; enlarge to see.\n\n';
      effectiveComment = effectiveComment ? hiddenWarning + effectiveComment : hiddenWarning;
    }

    // Create highlight element (dot or bounding box)
    const highlightElement = document.createElement('div');

    if (useDotIndicator) {
      highlightElement.className = 'interactive-highlight-dot';
      // Position at element's center
      const dotTop = rect.top + scrollTop + rect.height / 2;
      const dotLeft = rect.left + scrollLeft + rect.width / 2;
      highlightElement.style.setProperty('--highlight-top', `${dotTop}px`);
      highlightElement.style.setProperty('--highlight-left', `${dotLeft}px`);
    } else {
      highlightElement.className = 'interactive-highlight-outline';
      // Note: We always show the highlight draw animation (looks good)
      // skipAnimations only affects the comment box transition
      highlightElement.style.setProperty('--highlight-top', `${rect.top + scrollTop - 4}px`);
      highlightElement.style.setProperty('--highlight-left', `${rect.left + scrollLeft - 4}px`);
      highlightElement.style.setProperty('--highlight-width', `${rect.width + 8}px`);
      highlightElement.style.setProperty('--highlight-height', `${rect.height + 8}px`);
    }

    // Clear old highlights RIGHT BEFORE adding new one for seamless transition
    this.clearAllHighlights();

    document.body.appendChild(highlightElement);

    // Create comment box if comment is provided OR if any callback is provided
    // Comment box is always attached to body with absolute positioning
    let commentBox: HTMLElement | null = null;
    if (
      (effectiveComment && effectiveComment.trim()) ||
      onSkipCallback ||
      onCancelCallback ||
      onNextCallback ||
      onPreviousCallback
    ) {
      // Calculate highlight rect in absolute document coordinates
      const highlightRect = this.calculateHighlightRect(rect, scrollTop, scrollLeft, useDotIndicator);

      commentBox = this.createCommentBox(
        effectiveComment || '',
        rect,
        highlightRect,
        stepInfo,
        onSkipCallback,
        onCancelCallback,
        onNextCallback,
        onPreviousCallback,
        options
      );

      // Always append to body (unified positioning)
      document.body.appendChild(commentBox);
    }

    // GUARDRAIL: Auto-remove highlight after fixed duration
    // CSS handles visual fade, this is the cleanup failsafe
    //
    // Guided mode (!enableAutoCleanup): CSS animations run to completion but
    // DOM element persists until clearAllHighlights() is called by the guided
    // interaction flow. This is intentional - guides control their own lifecycle.
    if (useDotIndicator && enableAutoCleanup) {
      const dotRemovalTimeout = setTimeout(() => {
        if (highlightElement.isConnected) {
          highlightElement.remove();
        }
        // Also remove comment box (now on body, not child of dot)
        if (commentBox?.isConnected) {
          commentBox.remove();
        }
      }, INTERACTIVE_CONFIG.highlighting.dotDurationMs);

      // Store timeout for cleanup if clearAllHighlights is called early
      this.activeCleanupHandlers.push(() => clearTimeout(dotRemovalTimeout));
    } else if (!useDotIndicator && enableAutoCleanup) {
      // GUARDRAIL: Auto-remove bounding box after animation completes (non-guided mode only)
      // CSS handles visual fade-out, this ensures cleanup after animation finishes
      const outlineRemovalTimeout = setTimeout(() => {
        if (highlightElement.isConnected) {
          highlightElement.remove();
        }
        // Also remove comment box (body-attached)
        if (commentBox?.isConnected) {
          commentBox.remove();
        }
      }, INTERACTIVE_CONFIG.highlighting.outlineDurationMs);

      // Store timeout for cleanup if clearAllHighlights is called early
      this.activeCleanupHandlers.push(() => clearTimeout(outlineRemovalTimeout));
    }

    // Highlights and comments now persist until explicitly cleared
    // They will be removed when:
    // 1. User clicks the close button on highlight
    // 2. A new highlight is shown (clearAllHighlights called)
    // 3. Section/guided execution starts
    // 4. (If auto-cleanup enabled) User scrolls
    // 5. (If auto-cleanup enabled) User clicks outside

    // Always set up position tracking (efficient with ResizeObserver)
    // Enable drift detection for guided mode (!enableAutoCleanup) for more responsive tracking
    // FIX: Track the highlightTarget (visible parent) instead of original element
    const enableDriftDetection = !enableAutoCleanup;
    this.setupPositionTracking(highlightTarget, highlightElement, commentBox, enableDriftDetection, useDotIndicator);

    // Set up smart auto-cleanup (unless disabled for guided mode)
    // FIX: Use highlightTarget for auto-cleanup detection
    if (enableAutoCleanup) {
      this.setupAutoCleanup(highlightTarget);
    }

    return element;
  }

  /**
   * Create a themed comment box positioned near the highlighted element.
   * Uses absolute positioning attached to document.body, clamped to viewport.
   * Uses a clean, polished card design for both tour and guided modes.
   *
   * @param highlightRect - The absolute document coordinates of the highlight element
   */
  private createCommentBox(
    comment: string,
    targetRect: DOMRect,
    highlightRect: { top: number; left: number; width: number; height: number },
    stepInfo?: { current: number; total: number; completedSteps: number[] },
    onSkipCallback?: () => void,
    onCancelCallback?: () => void,
    onNextCallback?: () => void,
    onPreviousCallback?: () => void,
    options?: {
      showKeyboardHint?: boolean;
      stepTitle?: string;
      skipAnimations?: boolean;
      actionType?: 'hover' | 'button' | 'highlight' | 'formfill';
      targetValue?: string;
    }
  ): HTMLElement {
    const commentBox = document.createElement('div');
    commentBox.className = 'interactive-comment-box';

    // Apply E2E testing contract attributes
    applyE2ECommentBoxAttributes(commentBox, {
      actionType: options?.actionType,
      targetValue: options?.targetValue,
    });

    // We'll calculate position after building the content so we can measure actual height

    // Defer visibility to prevent layout bounce (unless skipping animations)
    if (options?.skipAnimations) {
      commentBox.setAttribute('data-ready', 'true');
      commentBox.classList.add('interactive-comment-box--instant');
    } else {
      requestAnimationFrame(() => {
        commentBox.setAttribute('data-ready', 'true');
      });
    }

    // Create content structure - clean card design
    const content = document.createElement('div');
    content.className = 'interactive-comment-content interactive-comment-glow';

    // Close button (absolute positioned for simple tooltips)
    const closeButton = document.createElement('button');
    closeButton.className = 'interactive-comment-close';
    closeButton.innerHTML = '×';
    closeButton.setAttribute('aria-label', 'Close');
    closeButton.setAttribute('title', 'Exit (Esc)');

    closeButton.addEventListener('click', (e) => {
      e.stopPropagation();
      if (onCancelCallback) {
        onCancelCallback();
      } else {
        this.clearAllHighlights();
      }
    });

    content.appendChild(closeButton);

    // === HEADER: Step badge (only when stepInfo provided) ===
    if (stepInfo) {
      const headerContainer = document.createElement('div');
      headerContainer.className = 'interactive-comment-header';

      const stepBadge = document.createElement('span');
      stepBadge.className = 'interactive-comment-step-badge';
      stepBadge.textContent = `Step ${stepInfo.current + 1} of ${stepInfo.total}`;
      headerContainer.appendChild(stepBadge);

      content.appendChild(headerContainer);
    }

    // === PROGRESS BAR ===
    if (stepInfo) {
      const progressContainer = document.createElement('div');
      progressContainer.className = 'interactive-comment-progress-container';

      const progressBar = document.createElement('div');
      progressBar.className = 'interactive-comment-progress-bar';
      const progressPercent = ((stepInfo.current + 1) / stepInfo.total) * 100;
      progressBar.style.width = `${progressPercent}%`;

      progressContainer.appendChild(progressBar);
      content.appendChild(progressContainer);
    }

    // === CONTENT: Title + Description ===
    const contentSection = document.createElement('div');
    contentSection.className = 'interactive-comment-content-section';

    // Title (optional)
    if (options?.stepTitle) {
      const titleElement = document.createElement('h4');
      titleElement.className = 'interactive-comment-title';
      titleElement.textContent = options.stepTitle;
      contentSection.appendChild(titleElement);
    }

    // Description/comment
    const descriptionElement = document.createElement('p');
    descriptionElement.className = 'interactive-comment-description';
    // SECURITY: Sanitize comment HTML before insertion to prevent XSS
    descriptionElement.innerHTML = sanitizeDocumentationHTML(comment || '');
    contentSection.appendChild(descriptionElement);

    content.appendChild(contentSection);

    // === STEP DOTS ===
    if (stepInfo) {
      const dotsContainer = document.createElement('div');
      dotsContainer.className = 'interactive-comment-dots';

      for (let i = 0; i < stepInfo.total; i++) {
        const dot = document.createElement('span');
        dot.className = 'interactive-comment-dot';

        if (i === stepInfo.current) {
          dot.classList.add('interactive-comment-dot--current');
        } else if (stepInfo.completedSteps.includes(i)) {
          dot.classList.add('interactive-comment-dot--completed');
        }

        dotsContainer.appendChild(dot);
      }

      content.appendChild(dotsContainer);
    }

    // === NAVIGATION BUTTONS ===
    const hasGuidedButtons = onSkipCallback || onCancelCallback;
    const hasTourButtons = onNextCallback || onPreviousCallback;

    if (hasGuidedButtons || hasTourButtons) {
      const buttonContainer = document.createElement('div');
      buttonContainer.className = 'interactive-comment-buttons';

      // Tour mode: Previous/Next navigation
      if (hasTourButtons) {
        // Previous button
        const prevButton = document.createElement('button');
        prevButton.className = 'interactive-comment-nav-btn';
        prevButton.innerHTML = '← Back';
        prevButton.setAttribute('aria-label', 'Previous step');
        prevButton.disabled = !onPreviousCallback;

        if (onPreviousCallback) {
          prevButton.addEventListener('click', (e) => {
            e.stopPropagation();
            onPreviousCallback();
          });
        }

        buttonContainer.appendChild(prevButton);

        // Spacer
        const spacer = document.createElement('div');
        spacer.className = 'interactive-comment-nav-spacer';
        buttonContainer.appendChild(spacer);

        // Next button - primary style
        const nextButton = document.createElement('button');
        const isLastStep = stepInfo && stepInfo.current === stepInfo.total - 1;
        nextButton.className = 'interactive-comment-nav-btn interactive-comment-nav-btn--primary';
        nextButton.innerHTML = isLastStep ? 'Start creating' : 'Next →';
        nextButton.setAttribute('aria-label', isLastStep ? 'Start creating' : 'Next step');

        if (onNextCallback) {
          nextButton.addEventListener('click', (e) => {
            e.stopPropagation();
            onNextCallback();
          });
        }

        buttonContainer.appendChild(nextButton);
      }

      // Guided mode: Cancel/Skip buttons (same row layout as tour)
      if (hasGuidedButtons && !hasTourButtons) {
        // Cancel button (left side)
        if (onCancelCallback) {
          const cancelButton = document.createElement('button');
          cancelButton.className = 'interactive-comment-nav-btn interactive-comment-nav-btn--cancel';
          cancelButton.textContent = 'Cancel';
          cancelButton.setAttribute('aria-label', 'Cancel guided interaction');

          cancelButton.addEventListener('click', (e) => {
            e.stopPropagation();
            onCancelCallback();
          });

          buttonContainer.appendChild(cancelButton);
        }

        // Spacer
        const spacer = document.createElement('div');
        spacer.className = 'interactive-comment-nav-spacer';
        buttonContainer.appendChild(spacer);

        // Skip button (right side, if skippable)
        if (onSkipCallback) {
          const skipButton = document.createElement('button');
          skipButton.className = 'interactive-comment-nav-btn';
          skipButton.textContent = 'Skip →';
          skipButton.setAttribute('aria-label', 'Skip this step');

          skipButton.addEventListener('click', (e) => {
            e.stopPropagation();
            onSkipCallback();
          });

          buttonContainer.appendChild(skipButton);
        }
      }

      content.appendChild(buttonContainer);
    }

    // === KEYBOARD HINT ===
    if (options?.showKeyboardHint) {
      const keyboardHint = document.createElement('div');
      keyboardHint.className = 'interactive-comment-keyboard-hint';
      keyboardHint.innerHTML = `
        <span class="interactive-comment-kbd">←</span>
        <span class="interactive-comment-kbd">→</span>
        <span>navigate</span>
        <span class="interactive-comment-kbd">Esc</span>
        <span>exit</span>
      `;
      content.appendChild(keyboardHint);
    }

    commentBox.appendChild(content);

    // MEASURE ACTUAL HEIGHT: Append off-screen temporarily to measure real dimensions
    commentBox.style.visibility = 'hidden';
    commentBox.style.position = 'absolute';
    commentBox.style.left = '-9999px';
    document.body.appendChild(commentBox);

    // Get the actual rendered height
    const actualHeight = commentBox.offsetHeight;

    // Remove it temporarily (we'll append it properly later)
    commentBox.remove();
    commentBox.style.visibility = '';
    commentBox.style.position = '';
    commentBox.style.left = '';

    // NOW calculate position with the REAL height
    // Calculate position offsets relative to highlight
    const { offsetX, offsetY, position } = this.calculateCommentPosition(targetRect, actualHeight);

    // Convert to absolute document coordinates (always body-attached)
    const absoluteTop = highlightRect.top + offsetY;
    const absoluteLeft = highlightRect.left + offsetX;

    commentBox.style.position = 'absolute';
    commentBox.style.top = `${absoluteTop}px`;
    commentBox.style.left = `${absoluteLeft}px`;
    commentBox.setAttribute('data-position', position);

    return commentBox;
  }

  /**
   * Calculate the optimal position for the comment box.
   * Returns offsets relative to the highlight parent, clamped to stay on screen.
   * @param targetRect - The bounding rectangle of the highlighted element
   * @param actualCommentHeight - The measured height of the comment box
   */
  private calculateCommentPosition(
    targetRect: DOMRect,
    actualCommentHeight: number
  ): {
    offsetX: number;
    offsetY: number;
    position: string;
  } {
    const commentWidth = 420;
    const commentHeight = actualCommentHeight;
    const gap = 16;
    const padding = 8; // Viewport edge padding
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Highlight dimensions (with 4px padding on each side = 8px total)
    const highlightWidth = targetRect.width + 8;
    const highlightHeight = targetRect.height + 8;

    // Calculate available space on each side
    const highlightRight = targetRect.right + 4;
    const highlightLeft = targetRect.left - 4;
    const highlightTop = targetRect.top - 4;
    const highlightBottom = targetRect.bottom + 4;

    const spaceRight = viewportWidth - highlightRight - gap;
    const spaceLeft = highlightLeft - gap;
    const spaceBottom = viewportHeight - highlightBottom - gap;
    const spaceTop = highlightTop - gap;

    // Helper to clamp vertical offset so comment stays on screen
    const clampVertical = (baseOffsetY: number): number => {
      // For very tall elements (taller than viewport), position comment
      // at a fixed position in the viewport instead of trying to center
      if (highlightHeight > viewportHeight) {
        // Position near top of viewport, accounting for highlight's viewport position
        const targetViewportY = Math.max(padding, Math.min(100, highlightTop + 50));
        return targetViewportY - highlightTop;
      }

      // Calculate where the tooltip would be in viewport coordinates
      let tooltipTop = highlightTop + baseOffsetY;
      let tooltipBottom = tooltipTop + commentHeight;

      // If tooltip goes off the bottom, push it up
      if (tooltipBottom > viewportHeight - padding) {
        const overflow = tooltipBottom - (viewportHeight - padding);
        tooltipTop -= overflow;
        baseOffsetY -= overflow;
      }

      // If tooltip goes off the top (after bottom adjustment), push it down
      if (tooltipTop < padding) {
        const underflow = padding - tooltipTop;
        baseOffsetY += underflow;
      }

      return baseOffsetY;
    };

    // Helper to clamp horizontal offset so comment stays on screen
    const clampHorizontal = (baseOffsetX: number): number => {
      const commentLeft = highlightLeft + baseOffsetX;
      const commentRight = commentLeft + commentWidth;

      // For very wide elements, position comment at a fixed horizontal position
      if (highlightWidth > viewportWidth) {
        const targetViewportX = Math.max(padding, (viewportWidth - commentWidth) / 2);
        return targetViewportX - highlightLeft;
      }

      if (commentLeft < padding) {
        return baseOffsetX + (padding - commentLeft);
      }
      if (commentRight > viewportWidth - padding) {
        return baseOffsetX - (commentRight - (viewportWidth - padding));
      }
      return baseOffsetX;
    };

    // Default order: right, left, bottom, top
    // Always prefer LEFT/RIGHT positioning first for better UX
    // Only use TOP/BOTTOM if horizontal space is insufficient
    // RIGHT position: offset to the right of highlight
    // Try RIGHT if there's reasonable space (at least 60% of tooltip width)
    if (spaceRight >= commentWidth * 0.6) {
      // Ensure tooltip is completely outside highlight bounds
      let offsetX = highlightWidth + gap;
      // Align tooltip top with highlight top (clamped to viewport), don't center
      const offsetY = clampVertical(0);
      // Clamp horizontal position to ensure tooltip stays on screen
      // Tooltip right edge = highlightLeft + offsetX + commentWidth, must be <= viewportWidth - padding
      const maxOffsetX = viewportWidth - padding - highlightLeft - commentWidth;
      if (offsetX > maxOffsetX) {
        // Not enough space on right, don't use RIGHT position
        // Fall through to try LEFT or TOP/BOTTOM
      } else {
        // Verify no overlap: tooltip left edge (offsetX) must be >= highlight right edge (highlightWidth)
        if (offsetX < highlightWidth) {
          offsetX = highlightWidth + gap;
        }
        return { offsetX, offsetY, position: 'right' };
      }
    }

    // LEFT position: offset to the left of highlight
    // Try LEFT if there's reasonable space (at least 60% of tooltip width)
    // Strongly prefer LEFT over TOP/BOTTOM to avoid overlapping the element
    if (spaceLeft >= commentWidth * 0.6) {
      // Ensure tooltip is completely outside highlight bounds
      let offsetX = -commentWidth - gap;
      // Align tooltip top with highlight top (clamped to viewport), don't center
      const offsetY = clampVertical(0);
      // Clamp horizontal position to ensure tooltip stays on screen
      // Tooltip left edge = highlightLeft + offsetX, must be >= padding
      const minOffsetX = padding - highlightLeft;
      if (offsetX < minOffsetX) {
        // Not enough space on left, don't use LEFT position
        // Fall through to try TOP/BOTTOM
      } else {
        // Verify no overlap: tooltip right edge (offsetX + commentWidth) must be <= 0 (highlight left edge)
        if (offsetX + commentWidth > 0) {
          offsetX = -commentWidth - gap;
        }
        return { offsetX, offsetY, position: 'left' };
      }
    }

    // BOTTOM position: offset below highlight
    if (spaceBottom >= commentHeight) {
      // Ensure tooltip is completely below highlight: offsetY must be >= highlightHeight + gap
      const offsetY = highlightHeight + gap;
      const offsetX = clampHorizontal((highlightWidth - commentWidth) / 2);
      // Verify no vertical overlap: tooltip top edge (offsetY) must be >= highlight bottom edge (highlightHeight)
      if (offsetY < highlightHeight) {
        return { offsetX, offsetY: highlightHeight + gap, position: 'bottom' };
      }
      return { offsetX, offsetY, position: 'bottom' };
    }

    // TOP position: offset above highlight
    if (spaceTop >= commentHeight) {
      // Ensure tooltip is completely above highlight: offsetY must be <= -commentHeight - gap
      const offsetY = -commentHeight - gap;
      const offsetX = clampHorizontal((highlightWidth - commentWidth) / 2);
      // Verify no vertical overlap: tooltip bottom edge (offsetY + commentHeight) must be <= 0 (highlight top edge)
      if (offsetY + commentHeight > 0) {
        return { offsetX, offsetY: -commentHeight - gap, position: 'top' };
      }
      return { offsetX, offsetY, position: 'top' };
    }

    // Fallback: use side with most space
    const maxSpace = Math.max(spaceRight, spaceLeft, spaceBottom, spaceTop);

    if (maxSpace === spaceBottom || maxSpace === spaceTop) {
      const offsetY = maxSpace === spaceBottom ? highlightHeight + gap : -commentHeight - gap;
      const offsetX = clampHorizontal((highlightWidth - commentWidth) / 2);
      return { offsetX, offsetY, position: maxSpace === spaceBottom ? 'bottom' : 'top' };
    }

    // For LEFT/RIGHT fallback, align to top (not center) to avoid overlap
    const offsetX = maxSpace === spaceRight ? highlightWidth + gap : -commentWidth - gap;
    const offsetY = clampVertical(0);
    return { offsetX, offsetY, position: maxSpace === spaceRight ? 'right' : 'left' };
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
    await new Promise((resolve) => setTimeout(resolve, INTERACTIVE_CONFIG.delays.technical.navigation));
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
      await new Promise((resolve) => setTimeout(resolve, INTERACTIVE_CONFIG.delays.navigation.expansionAnimationMs));

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
        await new Promise((resolve) =>
          setTimeout(resolve, INTERACTIVE_CONFIG.delays.navigation.allExpansionAnimationMs)
        );
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
