import { waitForReactUpdates } from '../lib/async-utils';
import { INTERACTIVE_CONFIG } from '../constants/interactive-config';
import logoSvg from '../img/logo.svg';
import {
  describeElement,
  escapeCssAttributeValue,
  isElementVisible,
  getScrollParent,
  getStickyHeaderOffset,
  getVisibleHighlightTarget,
  isPathfinderContent,
  readToggleState,
} from '../lib/dom';
import { assertExhaustive } from '../lib/assert-exhaustive';
import { logger } from '../lib/logging';
import { sanitizeDocumentationHTML } from '../security';
import { applyE2ECommentBoxAttributes } from './e2e-attributes';

export interface NavigationOptions {
  checkContext?: boolean;
  logWarnings?: boolean;
  ensureDocked?: boolean;
  signal?: AbortSignal;
}

export interface CommentBoxOptions {
  showKeyboardHint?: boolean;
  stepTitle?: string;
  skipAnimations?: boolean;
  actionType?: 'hover' | 'button' | 'highlight' | 'formfill';
  targetValue?: string;
  refTarget?: string;
  nextLabel?: string;
  substepIndex?: number;
  substepSkippable?: boolean;
  signal?: AbortSignal;
}

/**
 * Step progress for the comment box.
 *
 * `progress` picks the evidence the bar is drawn from, because consumers mean different
 * things by `completedSteps`: a guided block records only steps the reader performed,
 * while a bubble tour records the steps it has shown.
 */
export interface CommentBoxStepInfo {
  current: number;
  /** The consumer's own step set - one guided block, or one tour - never the guide. */
  total: number;
  completedSteps: number[];
  progress: 'performed' | 'position';
}

function progressBarPercent(stepInfo: CommentBoxStepInfo): number {
  switch (stepInfo.progress) {
    case 'performed':
      return (stepInfo.completedSteps.length / stepInfo.total) * 100;
    case 'position':
      return ((stepInfo.current + 1) / stepInfo.total) * 100;
    default:
      assertExhaustive(stepInfo.progress);
      return ((stepInfo.current + 1) / stepInfo.total) * 100;
  }
}

const NAV_ITEM_SELECTOR = 'a[data-testid="data-testid Nav menu item"]';
const MEGA_MENU_SELECTOR = '[data-testid="data-testid navigation mega-menu"]';

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
    applyE2ECommentBoxAttributes(commentBox, { actionType: 'noop' });

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
    // eslint-disable-next-line no-restricted-syntax -- Sanitized with DOMPurify via sanitizeDocumentationHTML
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
   * Show a viewport-centered comment that keeps its navigation footer.
   * Used when a tour step's target cannot be resolved, so the user can still move on.
   */
  showCenteredComment(
    comment: string,
    stepInfo?: CommentBoxStepInfo,
    onCancelCallback?: () => void,
    onNextCallback?: () => void,
    onPreviousCallback?: () => void,
    options?: CommentBoxOptions
  ): HTMLElement {
    this.clearAllHighlights();

    const commentBox = this.createCommentBox(
      comment,
      null,
      null,
      stepInfo,
      undefined,
      onCancelCallback,
      onNextCallback,
      onPreviousCallback,
      options
    );

    document.body.appendChild(commentBox);

    return commentBox;
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

      // Calculate highlight center in viewport coords (position:fixed, no scroll offsets)
      let highlightCenterX: number;
      let highlightCenterY: number;

      if (this.driftDetectionIsDotMode) {
        // For dot mode, highlight position IS the center (dot is centered at that point)
        highlightCenterX = highlightLeft;
        highlightCenterY = highlightTop;
      } else {
        // For bounding box, calculate center from dimensions
        const highlightWidth = parseFloat(highlightStyle.getPropertyValue('--highlight-width')) || 0;
        const highlightHeight = parseFloat(highlightStyle.getPropertyValue('--highlight-height')) || 0;
        highlightCenterX = highlightLeft + highlightWidth / 2;
        highlightCenterY = highlightTop + highlightHeight / 2;
      }

      // Calculate drift distance
      const driftX = Math.abs(elementCenterX - highlightCenterX);
      const driftY = Math.abs(elementCenterY - highlightCenterY);
      const totalDrift = Math.sqrt(driftX * driftX + driftY * driftY);

      // If drift exceeds threshold, update position immediately
      if (totalDrift > driftThreshold) {
        if (this.driftDetectionIsDotMode) {
          // Update dot position at element center (viewport coords)
          const dotTop = elementRect.top + elementRect.height / 2;
          const dotLeft = elementRect.left + elementRect.width / 2;
          highlightStyle.setProperty('--highlight-top', `${dotTop}px`);
          highlightStyle.setProperty('--highlight-left', `${dotLeft}px`);
        } else {
          // Update bounding box position (viewport coords)
          highlightStyle.setProperty('--highlight-top', `${elementRect.top - 4}px`);
          highlightStyle.setProperty('--highlight-left', `${elementRect.left - 4}px`);
          highlightStyle.setProperty('--highlight-width', `${elementRect.width + 8}px`);
          highlightStyle.setProperty('--highlight-height', `${elementRect.height + 8}px`);
        }

        // Update comment box position (body-attached, position:fixed)
        if (this.driftDetectionComment) {
          const highlightRect = this.calculateHighlightRect(elementRect, this.driftDetectionIsDotMode);

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
   * Calculate highlight rect in viewport coordinates (for position:fixed overlays).
   * For dot mode, returns a zero-dimension rect at element center.
   * For bounding box, returns padded rect around element.
   *
   * @param rect - The element's bounding client rect (already in viewport coords)
   * @param isDotMode - Whether using dot indicator (true) or bounding box (false)
   * @returns Highlight rect with top, left, width, height in viewport coordinates
   */
  private calculateHighlightRect(
    rect: DOMRect,
    isDotMode: boolean
  ): { top: number; left: number; width: number; height: number } {
    if (isDotMode) {
      return {
        top: rect.top + rect.height / 2,
        left: rect.left + rect.width / 2,
        width: 0,
        height: 0,
      };
    }
    return {
      top: rect.top - 4,
      left: rect.left - 4,
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

        // Check for invalid positions:
        // 1. Element has collapsed to 0,0 (disappeared)
        // 2. Element is at top-left corner (0,0) with no scroll offset
        // 3. Element has zero or near-zero dimensions (skip for dot mode - dots work with any dimensions)
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        const scrollLeft = window.scrollX || document.documentElement.scrollLeft;
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

        // Update highlight position based on mode (viewport coords for position:fixed)
        if (isDotMode) {
          // For dots, position at element's center
          const dotTop = rect.top + rect.height / 2;
          const dotLeft = rect.left + rect.width / 2;
          highlightElement.style.setProperty('--highlight-top', `${dotTop}px`);
          highlightElement.style.setProperty('--highlight-left', `${dotLeft}px`);
        } else {
          // For bounding box, position with 4px padding
          highlightElement.style.setProperty('--highlight-top', `${rect.top - 4}px`);
          highlightElement.style.setProperty('--highlight-left', `${rect.left - 4}px`);
          highlightElement.style.setProperty('--highlight-width', `${rect.width + 8}px`);
          highlightElement.style.setProperty('--highlight-height', `${rect.height + 8}px`);
        }

        // Update comment box position (body-attached, position:fixed)
        if (commentBox) {
          const highlightRect = this.calculateHighlightRect(rect, isDotMode);

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
      // - The Pathfinder floating panel
      if (
        target.closest('.interactive-highlight-outline') ||
        target.closest('.interactive-comment-box') ||
        isPathfinderContent(target) ||
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

  async ensureElementVisible(element: HTMLElement, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return;
    }
    if (!isElementVisible(element)) {
      logger.warn('Element is hidden or not visible', { element: describeElement(element) });
    }

    const stickyOffset = getStickyHeaderOffset(element);

    const rect = element.getBoundingClientRect();
    const scrollContainer = getScrollParent(element);
    const containerRect =
      scrollContainer === document.documentElement
        ? { top: 0, bottom: window.innerHeight }
        : scrollContainer.getBoundingClientRect();

    const isVisible = rect.top >= containerRect.top + stickyOffset && rect.bottom <= containerRect.bottom;

    if (isVisible) {
      return;
    }

    const originalScrollPadding = scrollContainer.style.scrollPaddingTop;
    if (stickyOffset > 0) {
      scrollContainer.style.scrollPaddingTop = `${stickyOffset + 10}px`;
    }

    element.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
      inline: 'nearest',
    });

    await this.waitForScrollEnd(scrollContainer, signal);

    scrollContainer.style.scrollPaddingTop = originalScrollPadding;
  }

  private waitForScrollEnd(scrollContainer: HTMLElement, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let scrollDetected = false;
      let resolved = false;
      let timeoutId: NodeJS.Timeout;

      const cleanup = () => {
        clearTimeout(timeoutId);
        scrollContainer.removeEventListener('scroll', scrollHandler);
        scrollContainer.removeEventListener('scrollend', scrollendHandler);
        document.removeEventListener('scrollend', docScrollendHandler);
        signal?.removeEventListener('abort', handleScrollEnd);
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
      };

      const scrollendHandler = () => handleScrollEnd();
      const docScrollendHandler = () => handleScrollEnd();

      scrollContainer.addEventListener('scroll', scrollHandler, { once: true, passive: true });

      scrollContainer.addEventListener('scrollend', scrollendHandler, { once: true });
      document.addEventListener('scrollend', docScrollendHandler, { once: true });

      // Without scroll movement, the browser never emits scrollend.
      timeoutId = setTimeout(() => {
        if (!scrollDetected && !resolved) {
          handleScrollEnd();
        }
      }, INTERACTIVE_CONFIG.delays.navigation.scrollTimeout);
      signal?.addEventListener('abort', handleScrollEnd, { once: true });
      if (signal?.aborted) {
        handleScrollEnd();
      }
    });
  }

  async highlight(element: HTMLElement): Promise<HTMLElement> {
    return this.highlightWithComment(element);
  }

  async highlightWithComment(
    element: HTMLElement,
    comment?: string,
    enableAutoCleanup = true,
    stepInfo?: CommentBoxStepInfo,
    onSkipCallback?: () => void,
    onCancelCallback?: () => void,
    onNextCallback?: () => void,
    onPreviousCallback?: () => void,
    options?: CommentBoxOptions
  ): Promise<HTMLElement> {
    const signal = options?.signal;
    if (signal?.aborted) {
      return element;
    }
    await this.ensureNavigationOpen(element, signal);
    if (signal?.aborted) {
      return element;
    }
    await this.ensureElementVisible(element, signal);
    if (signal?.aborted) {
      return element;
    }

    const highlightTarget = getVisibleHighlightTarget(element);

    // Fixed overlays use viewport coordinates, without page scroll offsets.
    const rect = highlightTarget.getBoundingClientRect();

    const hasNoPosition = rect.top === 0 && rect.left === 0 && rect.width === 0 && rect.height === 0;
    if (hasNoPosition) {
      logger.warn('Cannot highlight element: invalid position or dimensions', {
        rect,
      });
      return element;
    }

    const isSmallElement =
      rect.width < INTERACTIVE_CONFIG.highlighting.minDimensionForBox ||
      rect.height < INTERACTIVE_CONFIG.highlighting.minDimensionForBox;
    const isHiddenElement = !isElementVisible(highlightTarget);
    const useDotIndicator = isSmallElement || isHiddenElement;

    let effectiveComment = comment;
    if (isHiddenElement) {
      const hiddenWarning = 'Item may be hidden due to screen size; enlarge to see.\n\n';
      effectiveComment = effectiveComment ? hiddenWarning + effectiveComment : hiddenWarning;
    }

    const highlightElement = document.createElement('div');

    // The floating panel dodges highlight overlays; exempt in-panel ones so it can't flee its own.
    const isInternalTarget = isPathfinderContent(highlightTarget);
    if (isInternalTarget) {
      highlightElement.setAttribute('data-pathfinder-internal', 'true');
    }

    if (useDotIndicator) {
      highlightElement.className = 'interactive-highlight-dot';
      const dotTop = rect.top + rect.height / 2;
      const dotLeft = rect.left + rect.width / 2;
      highlightElement.style.setProperty('--highlight-top', `${dotTop}px`);
      highlightElement.style.setProperty('--highlight-left', `${dotLeft}px`);
    } else {
      highlightElement.className = 'interactive-highlight-outline';
      highlightElement.style.setProperty('--highlight-top', `${rect.top - 4}px`);
      highlightElement.style.setProperty('--highlight-left', `${rect.left - 4}px`);
      highlightElement.style.setProperty('--highlight-width', `${rect.width + 8}px`);
      highlightElement.style.setProperty('--highlight-height', `${rect.height + 8}px`);
    }

    this.clearAllHighlights();

    document.body.appendChild(highlightElement);

    let commentBox: HTMLElement | null = null;
    if (
      (effectiveComment && effectiveComment.trim()) ||
      onSkipCallback ||
      onCancelCallback ||
      onNextCallback ||
      onPreviousCallback
    ) {
      const highlightRect = this.calculateHighlightRect(rect, useDotIndicator);

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

      if (isInternalTarget) {
        commentBox.setAttribute('data-pathfinder-internal', 'true');
      }

      document.body.appendChild(commentBox);
    }

    if (useDotIndicator && enableAutoCleanup) {
      const dotRemovalTimeout = setTimeout(() => {
        if (highlightElement.isConnected) {
          highlightElement.remove();
        }
        if (commentBox?.isConnected) {
          commentBox.remove();
        }
      }, INTERACTIVE_CONFIG.highlighting.dotDurationMs);

      this.activeCleanupHandlers.push(() => clearTimeout(dotRemovalTimeout));
    } else if (!useDotIndicator && enableAutoCleanup) {
      const outlineRemovalTimeout = setTimeout(() => {
        if (highlightElement.isConnected) {
          highlightElement.remove();
        }
        if (commentBox?.isConnected) {
          commentBox.remove();
        }
      }, INTERACTIVE_CONFIG.highlighting.outlineDurationMs);

      this.activeCleanupHandlers.push(() => clearTimeout(outlineRemovalTimeout));
    }

    const enableDriftDetection = !enableAutoCleanup;
    this.setupPositionTracking(highlightTarget, highlightElement, commentBox, enableDriftDetection, useDotIndicator);

    if (enableAutoCleanup) {
      this.setupAutoCleanup(highlightTarget);
    }

    return element;
  }

  private createCommentBox(
    comment: string,
    targetRect: DOMRect | null,
    highlightRect: { top: number; left: number; width: number; height: number } | null,
    stepInfo?: CommentBoxStepInfo,
    onSkipCallback?: () => void,
    onCancelCallback?: () => void,
    onNextCallback?: () => void,
    onPreviousCallback?: () => void,
    options?: CommentBoxOptions
  ): HTMLElement {
    const commentBox = document.createElement('div');
    commentBox.className = 'interactive-comment-box';

    applyE2ECommentBoxAttributes(commentBox, {
      actionType: options?.actionType,
      targetValue: options?.targetValue,
      refTarget: options?.refTarget,
      substepIndex: options?.substepIndex,
      substepSkippable: options?.substepSkippable,
    });

    if (options?.skipAnimations) {
      commentBox.setAttribute('data-ready', 'true');
      commentBox.classList.add('interactive-comment-box--instant');
    } else {
      requestAnimationFrame(() => {
        if (!options?.signal?.aborted) {
          commentBox.setAttribute('data-ready', 'true');
        }
      });
    }

    const content = document.createElement('div');
    content.className = 'interactive-comment-content interactive-comment-glow';

    const closeButton = document.createElement('button');
    closeButton.className = 'interactive-comment-close';
    closeButton.innerHTML = '×'; // eslint-disable-line no-restricted-syntax -- Static HTML entity
    closeButton.setAttribute('aria-label', 'Close');
    closeButton.setAttribute('title', 'Exit (Esc)');

    const closeHandler = (e: Event) => {
      e.stopPropagation();
      if (onCancelCallback) {
        onCancelCallback();
      } else {
        this.clearAllHighlights();
      }
    };
    closeButton.addEventListener('click', closeHandler);
    this.activeCleanupHandlers.push(() => closeButton.removeEventListener('click', closeHandler));

    content.appendChild(closeButton);

    if (stepInfo) {
      const headerContainer = document.createElement('div');
      headerContainer.className = 'interactive-comment-header';

      const stepBadge = document.createElement('span');
      stepBadge.className = 'interactive-comment-step-badge';
      stepBadge.textContent = `Step ${stepInfo.current + 1} of ${stepInfo.total}`;
      headerContainer.appendChild(stepBadge);

      content.appendChild(headerContainer);
    }

    if (stepInfo) {
      const progressContainer = document.createElement('div');
      progressContainer.className = 'interactive-comment-progress-container';

      const progressBar = document.createElement('div');
      progressBar.className = 'interactive-comment-progress-bar';
      progressBar.style.width = `${progressBarPercent(stepInfo)}%`;

      progressContainer.appendChild(progressBar);
      content.appendChild(progressContainer);
    }

    const contentSection = document.createElement('div');
    contentSection.className = 'interactive-comment-content-section';

    if (options?.stepTitle) {
      const titleElement = document.createElement('h4');
      titleElement.className = 'interactive-comment-title';
      titleElement.textContent = options.stepTitle;
      contentSection.appendChild(titleElement);
    }

    const descriptionElement = document.createElement('p');
    descriptionElement.className = 'interactive-comment-description';
    // eslint-disable-next-line no-restricted-syntax -- Sanitized with DOMPurify via sanitizeDocumentationHTML
    descriptionElement.innerHTML = sanitizeDocumentationHTML(comment || '');
    contentSection.appendChild(descriptionElement);

    content.appendChild(contentSection);

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

    const hasGuidedButtons = onSkipCallback || onCancelCallback;
    const hasTourButtons = onNextCallback || onPreviousCallback;

    if (hasGuidedButtons || hasTourButtons) {
      const buttonContainer = document.createElement('div');
      buttonContainer.className = 'interactive-comment-buttons';

      if (hasTourButtons) {
        const prevButton = document.createElement('button');
        prevButton.className = 'interactive-comment-nav-btn';
        prevButton.textContent = '← Back';
        prevButton.setAttribute('aria-label', 'Previous step');
        prevButton.disabled = !onPreviousCallback;

        if (onPreviousCallback) {
          prevButton.addEventListener('click', (e) => {
            e.stopPropagation();
            onPreviousCallback();
          });
        }

        buttonContainer.appendChild(prevButton);

        const spacer = document.createElement('div');
        spacer.className = 'interactive-comment-nav-spacer';
        buttonContainer.appendChild(spacer);

        const nextButton = document.createElement('button');
        const isLastStep = stepInfo && stepInfo.current === stepInfo.total - 1;
        const nextLabel = options?.nextLabel ?? (isLastStep ? 'Done' : 'Next →');
        nextButton.className = 'interactive-comment-nav-btn interactive-comment-nav-btn--primary';
        nextButton.textContent = nextLabel;
        nextButton.setAttribute('aria-label', isLastStep ? nextLabel : 'Next step');

        if (onNextCallback) {
          nextButton.addEventListener('click', (e) => {
            e.stopPropagation();
            onNextCallback();
          });
        }

        buttonContainer.appendChild(nextButton);
      }

      if (hasGuidedButtons && !hasTourButtons) {
        if (onCancelCallback) {
          const cancelButton = document.createElement('button');
          cancelButton.className = 'interactive-comment-nav-btn interactive-comment-nav-btn--cancel';
          cancelButton.textContent = 'Cancel';
          cancelButton.setAttribute('aria-label', 'Cancel guided interaction');

          const cancelHandler = (e: Event) => {
            e.stopPropagation();
            onCancelCallback();
          };
          cancelButton.addEventListener('click', cancelHandler);
          this.activeCleanupHandlers.push(() => cancelButton.removeEventListener('click', cancelHandler));

          buttonContainer.appendChild(cancelButton);
        }

        const spacer = document.createElement('div');
        spacer.className = 'interactive-comment-nav-spacer';
        buttonContainer.appendChild(spacer);

        if (onSkipCallback) {
          const skipButton = document.createElement('button');
          skipButton.className = 'interactive-comment-nav-btn';
          skipButton.textContent = 'Skip →';
          skipButton.setAttribute('aria-label', 'Skip this step');

          const skipHandler = (e: Event) => {
            e.stopPropagation();
            onSkipCallback();
          };
          skipButton.addEventListener('click', skipHandler);
          this.activeCleanupHandlers.push(() => skipButton.removeEventListener('click', skipHandler));

          buttonContainer.appendChild(skipButton);
        }
      }

      content.appendChild(buttonContainer);
    }

    if (options?.showKeyboardHint) {
      const keyboardHint = document.createElement('div');
      keyboardHint.className = 'interactive-comment-keyboard-hint';
      // eslint-disable-next-line no-restricted-syntax -- Static HTML keyboard hint UI
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

    // Returning before any inline top/left write is what lets the CSS centering rule apply.
    if (!targetRect || !highlightRect) {
      commentBox.setAttribute('data-position', 'center');
      return commentBox;
    }

    commentBox.style.visibility = 'hidden';
    commentBox.style.position = 'absolute';
    commentBox.style.left = '-9999px';
    document.body.appendChild(commentBox);

    const actualHeight = commentBox.offsetHeight;

    commentBox.remove();
    commentBox.style.visibility = '';
    commentBox.style.position = '';
    commentBox.style.left = '';

    const { offsetX, offsetY, position } = this.calculateCommentPosition(targetRect, actualHeight);

    const fixedTop = highlightRect.top + offsetY;
    const fixedLeft = highlightRect.left + offsetX;

    commentBox.style.position = 'fixed';
    commentBox.style.top = `${fixedTop}px`;
    commentBox.style.left = `${fixedLeft}px`;
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

  async ensureNavigationOpen(element: HTMLElement, signal?: AbortSignal): Promise<void> {
    return this.openAndDockNavigation(element, {
      checkContext: true,
      logWarnings: false,
      ensureDocked: true,
      signal,
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

  async expandParentNavigationSection(targetHref: string, signal?: AbortSignal): Promise<boolean> {
    try {
      if (signal?.aborted) {
        return false;
      }
      if (this.findNavItemByHref(targetHref)) {
        return true;
      }

      await this.openAndDockNavigation(undefined, { ensureDocked: true, signal });
      if (signal?.aborted) {
        return false;
      }
      const polled = await this.pollForNavItem(targetHref, signal);
      if (signal?.aborted) {
        return false;
      }
      if (polled) {
        return true;
      }

      if (targetHref.includes('/a/')) {
        return this.expandAllNavigationSections(signal);
      }

      const parentPath = this.getParentPathFromHref(targetHref);
      if (!parentPath) {
        return this.expandAllNavigationSections(signal);
      }

      const parentExpandButton = this.findParentExpandButton(parentPath);
      if (!parentExpandButton) {
        return this.expandAllNavigationSections(signal);
      }

      if (this.isParentSectionExpanded(parentExpandButton)) {
        return true;
      }

      parentExpandButton.click();
      await this.waitForNavigationDelay(INTERACTIVE_CONFIG.delays.navigation.expansionAnimationMs, signal);

      return !signal?.aborted;
    } catch (error) {
      logger.error('Failed to expand parent navigation section', { error });
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
   * Find a nav menu item by its href using JS filtering (avoids CSS selector injection).
   */
  private findNavItemByHref(href: string): Element | null {
    return (
      Array.from(document.querySelectorAll(NAV_ITEM_SELECTOR)).find((el) => el.getAttribute('href') === href) ?? null
    );
  }

  private async pollForNavItem(href: string, signal?: AbortSignal): Promise<Element | null> {
    const { pollMaxAttempts, pollIntervalMs } = INTERACTIVE_CONFIG.delays.navigation;
    for (let i = 0; i < pollMaxAttempts && !signal?.aborted; i++) {
      const el = this.findNavItemByHref(href);
      if (el) {
        return el;
      }
      await this.waitForNavigationDelay(pollIntervalMs, signal);
    }
    return null;
  }

  /**
   * Find the expand button for a parent navigation section
   */
  private findParentExpandButton(parentPath: string): HTMLButtonElement | null {
    // Strategy 1: Look for parent link, then find its expand button sibling
    const parentLink = this.findNavItemByHref(parentPath);
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
      `button[aria-label*="Expand section: ${escapeCssAttributeValue(capitalizedName, '"')}"]`
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
    const state = readToggleState(expandButton);
    if (state !== 'unknown') {
      return state === 'true';
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

  async expandAllNavigationSections(signal?: AbortSignal): Promise<boolean> {
    try {
      if (signal?.aborted) {
        return false;
      }
      const expandButtons = document.querySelectorAll(
        'button[aria-label*="Expand section"]'
      ) as NodeListOf<HTMLButtonElement>;
      if (expandButtons.length === 0) {
        return false;
      }
      let expandedAny = false;
      for (const button of expandButtons) {
        if (signal?.aborted) {
          return false;
        }
        if (!this.isParentSectionExpanded(button)) {
          button.click();
          expandedAny = true;
        }
      }
      if (expandedAny) {
        await this.waitForNavigationDelay(INTERACTIVE_CONFIG.delays.navigation.allExpansionAnimationMs, signal);
      }
      return !signal?.aborted;
    } catch (error) {
      logger.error('Failed to expand all navigation sections', { error });
      return false;
    }
  }

  async openAndDockNavigation(element?: HTMLElement, options: NavigationOptions = {}): Promise<void> {
    const { checkContext = false, logWarnings = true, ensureDocked = true, signal } = options;
    if (signal?.aborted) {
      return;
    }

    // Page toolbars also use <nav>, but only the mega menu needs docking.
    if (checkContext && element && !element.closest(MEGA_MENU_SELECTOR)) {
      return;
    }

    const megaMenuToggle = document.querySelector('#mega-menu-toggle') as HTMLButtonElement;
    if (!megaMenuToggle) {
      if (logWarnings) {
        logger.warn('Mega menu toggle button not found - navigation may already be open or use different structure');
      }
      return;
    }

    // The toggle's aria-expanded does not reflect docked navigation.
    const navItemsVisible = document.querySelectorAll(NAV_ITEM_SELECTOR).length > 0;
    if (navItemsVisible) {
      if (ensureDocked) {
        await this.dockIfInOverlay(signal);
      }
      return;
    }

    megaMenuToggle.click();
    await waitForReactUpdates();
    if (signal?.aborted) {
      return;
    }

    if (document.querySelectorAll(NAV_ITEM_SELECTOR).length > 0) {
      if (ensureDocked) {
        await this.dockIfInOverlay(signal);
      }
      return;
    }

    if (ensureDocked) {
      const dockMenuButton = await this.pollForDockButton(signal);
      if (signal?.aborted) {
        return;
      }
      if (dockMenuButton) {
        dockMenuButton.click();
        await waitForReactUpdates();
        if (!signal?.aborted) {
          await this.pollForNavItems(signal);
        }
      } else if (logWarnings) {
        logger.warn('Dock menu button not found after polling, navigation will remain in modal mode');
      }
    }
  }

  // The dock button also exists in docked mode, where it undocks the menu.
  private async dockIfInOverlay(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return;
    }
    const dockMenuButton = document.querySelector('#dock-menu-button') as HTMLButtonElement | null;
    if (dockMenuButton?.getAttribute('aria-label') === 'Dock menu') {
      dockMenuButton.click();
      await waitForReactUpdates();
      if (!signal?.aborted) {
        await this.pollForNavItems(signal);
      }
    }
  }

  private async pollForDockButton(signal?: AbortSignal): Promise<HTMLButtonElement | null> {
    const { pollMaxAttempts, pollIntervalMs } = INTERACTIVE_CONFIG.delays.navigation;
    for (let i = 0; i < pollMaxAttempts && !signal?.aborted; i++) {
      const btn = document.querySelector('#dock-menu-button') as HTMLButtonElement;
      if (btn) {
        return btn;
      }
      await this.waitForNavigationDelay(pollIntervalMs, signal);
    }
    return null;
  }

  private async pollForNavItems(signal?: AbortSignal): Promise<boolean> {
    const { pollMaxAttempts, pollIntervalMs } = INTERACTIVE_CONFIG.delays.navigation;
    for (let i = 0; i < pollMaxAttempts && !signal?.aborted; i++) {
      if (document.querySelectorAll(NAV_ITEM_SELECTOR).length > 0) {
        return true;
      }
      await this.waitForNavigationDelay(pollIntervalMs, signal);
    }
    return false;
  }

  private waitForNavigationDelay(duration: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', finish);
        resolve();
      };
      const timer = setTimeout(finish, duration);
      signal?.addEventListener('abort', finish, { once: true });
    });
  }
}
