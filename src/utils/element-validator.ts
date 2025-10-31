/**
 * Provides comprehensive DOM element visibility and accessibility validation
 * to prevent interaction failures with hidden or inaccessible elements
 */

/**
 * IDs of global interaction blocker overlays that should be excluded from visibility checks
 * These are intentionally blocking overlays that are part of the interactive system
 */
const BLOCKER_OVERLAY_IDS = [
  'interactive-blocking-overlay',
  'interactive-header-overlay',
  'interactive-fullscreen-overlay',
];

/**
 * Check if an element is one of the global interaction blocker overlays
 */
function isBlockerOverlay(element: HTMLElement): boolean {
  return BLOCKER_OVERLAY_IDS.includes(element.id);
}

/**
 * Enhanced hidden element detection
 *
 * More sophisticated than simple display:none check - catches collapsed elements,
 * zero-size containers, and elements with hidden overflow.
 *
 * @param element - The element to check
 * @returns true if element is hidden, false otherwise
 */
function isHidden(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);

  // Check display: none
  if (style.getPropertyValue('display') === 'none') {
    return true;
  }

  // Only perform advanced size/overflow checks on elements with explicitly set overflow
  // This avoids false positives on empty test elements or valid containers
  const overflow = style.getPropertyValue('overflow');
  if (overflow !== '' && overflow !== 'visible') {
    const noSize = element.offsetWidth <= 0 && element.offsetHeight <= 0;
    const hasNoContent = !element.innerHTML;

    // Zero-size element with no content and hidden overflow is collapsed
    if (noSize && hasNoContent) {
      return true;
    }
  }

  return false;
}

/**
 * Check if element is actually visible (not just present in DOM)
 * Validates display, visibility, and opacity on element and all parents
 * Excludes global interaction blocker overlays from checks
 *
 * @param element - The element to check
 * @returns true if element is visible, false otherwise
 *
 * @example
 * ```typescript
 * const button = document.querySelector('button');
 * if (isElementVisible(button)) {
 *   // Safe to interact with button
 * }
 * ```
 */
export function isElementVisible(element: HTMLElement | null): boolean {
  if (!element) {
    return false;
  }

  let current: HTMLElement | null = element;

  while (current && current !== document.body) {
    // Skip blocker overlays - they're intentionally blocking but not "hidden"
    if (isBlockerOverlay(current)) {
      current = current.parentElement;
      continue;
    }

    // Use enhanced hidden detection
    if (isHidden(current)) {
      return false;
    }

    const style = getComputedStyle(current);

    // Check visibility
    if (style.visibility === 'hidden') {
      return false;
    }

    // Check opacity
    if (parseFloat(style.opacity) === 0) {
      return false;
    }

    current = current.parentElement;
  }

  return true;
}

/**
 * Check if element or any parent has fixed or sticky positioning
 * Recursively traverses parent hierarchy to detect position: fixed/sticky
 *
 * @param element - The element to check
 * @returns true if element has fixed/sticky positioning, false otherwise
 *
 * @example
 * ```typescript
 * const modal = document.querySelector('.modal');
 * if (hasFixedPosition(modal)) {
 *   // Skip scrolling - element is already positioned
 * }
 * ```
 */
export function hasFixedPosition(element: HTMLElement | null): boolean {
  if (!element || element === document.body) {
    return false;
  }

  const style = getComputedStyle(element);

  if (style.position === 'fixed' || style.position === 'sticky') {
    return true;
  }

  // Recursively check parent
  return hasFixedPosition(element.parentElement);
}

/**
 * Find the actual scrollable parent container for an element
 * Handles custom scroll containers like Grafana panels, modals, or nested divs
 * Enhanced to detect virtualized table containers
 *
 * @param element - The element to find scroll parent for
 * @returns The scrollable parent container or document.documentElement
 *
 * @example
 * ```typescript
 * const input = document.querySelector('input');
 * const scrollContainer = getScrollParent(input);
 * scrollContainer.scrollBy({ top: 100, behavior: 'smooth' });
 * ```
 */
export function getScrollParent(element: HTMLElement | null): HTMLElement {
  if (!element) {
    return document.documentElement;
  }

  let parent = element.parentElement;

  while (parent && parent !== document.body) {
    const style = getComputedStyle(parent);
    const overflow = style.overflow + style.overflowY + style.overflowX;

    // Check if this parent is scrollable
    if (/(auto|scroll)/.test(overflow)) {
      // Verify it actually has scrollable content
      if (parent.scrollHeight > parent.clientHeight || parent.scrollWidth > parent.clientWidth) {
        return parent;
      }
    }

    // Special case: overflow:hidden parent might still be the scroll container
    // if it has scrollable children (common in virtualized tables)
    if (overflow.includes('hidden')) {
      // Check if parent has explicit height and scrollable content
      const hasExplicitHeight = style.height !== 'auto' && style.height !== '';
      const isScrollable = parent.scrollHeight > parent.clientHeight;

      if (hasExplicitHeight && isScrollable) {
        return parent;
      }
    }

    parent = parent.parentElement;
  }

  return document.documentElement;
}

/**
 * Calculate the total height offset from sticky/fixed headers above an element
 * These headers can block visibility even when element appears "in viewport"
 * Scans ALL elements in the scroll container, not just ancestors
 *
 * @param element - The element to check for obstructing sticky/fixed headers
 * @returns Total pixel offset from sticky/fixed headers in pixels
 *
 * @example
 * ```typescript
 * const row = document.querySelector('.table-row');
 * const offset = getStickyHeaderOffset(row);
 * // Returns 75 if there's a 75px sticky header above
 * ```
 */
export function getStickyHeaderOffset(element: HTMLElement | null): number {
  if (!element) {
    return 0;
  }

  let maxOffset = 0;
  const scrollParent = getScrollParent(element);
  const scrollParentRect = scrollParent.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();

  // Determine the effective top boundary of the scroll container
  const scrollContainerTop = scrollParent === document.documentElement ? 0 : scrollParentRect.top;

  // CRITICAL FIX: Scan ALL elements within scroll container for sticky/fixed elements
  // Not just ancestors - sticky headers are often siblings or in different DOM branches
  const containerToSearch = scrollParent === document.documentElement ? document.body : scrollParent;
  const allElements = containerToSearch.querySelectorAll('*');

  allElements.forEach((el) => {
    const style = getComputedStyle(el);
    const position = style.position;

    // Only check sticky or fixed elements
    if (position !== 'sticky' && position !== 'fixed') {
      return;
    }

    const rect = el.getBoundingClientRect();
    const top = parseFloat(style.top);

    // Check if this element is:
    // 1. Positioned at the top (top value is 0-100px)
    // 2. Currently stuck at/near the scroll container top
    // 3. Above the target element (would obstruct it)
    const isStuckAtTop = !isNaN(top) && top >= 0 && top < 100;
    const isAtContainerTop = rect.top <= scrollContainerTop + 50; // 50px tolerance
    const isAboveTarget = rect.bottom <= elementRect.top;

    // Only count if it would actually obstruct the target element
    if (isStuckAtTop && isAtContainerTop) {
      // Use the element's bottom position relative to the scroll container
      const offsetFromContainerTop = rect.bottom - scrollContainerTop;

      console.warn(
        `Found sticky/fixed element at top (${position}):`,
        el,
        `Offset: ${offsetFromContainerTop}px, IsAboveTarget: ${isAboveTarget}`
      );

      maxOffset = Math.max(maxOffset, offsetFromContainerTop);
    }
  });

  return maxOffset;
}

/**
 * Check if element is currently in the viewport
 * Uses getBoundingClientRect to determine visibility
 * Accounts for sticky/fixed headers that reduce effective viewport
 *
 * @param element - The element to check
 * @param threshold - Optional visibility threshold (0-1), defaults to 0 (any part visible)
 * @param stickyOffset - Optional sticky header offset to adjust effective viewport top
 * @returns true if element is in viewport, false otherwise
 *
 * @example
 * ```typescript
 * const element = document.querySelector('.target');
 * const offset = getStickyHeaderOffset(element);
 * if (isInViewport(element, 0.5, offset)) {
 *   // At least 50% of element is visible below sticky headers
 * }
 * ```
 */
export function isInViewport(element: HTMLElement | null, threshold = 0, stickyOffset = 0): boolean {
  if (!element) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  const windowHeight = window.innerHeight || document.documentElement.clientHeight;
  const windowWidth = window.innerWidth || document.documentElement.clientWidth;

  // Adjust effective viewport top by sticky header offset
  const effectiveTop = stickyOffset;

  if (threshold === 0) {
    // Any part visible, accounting for sticky headers
    return rect.top < windowHeight && rect.bottom > effectiveTop && rect.left < windowWidth && rect.right > 0;
  }

  // Calculate visible area percentage, accounting for sticky headers
  const visibleHeight = Math.min(rect.bottom, windowHeight) - Math.max(rect.top, effectiveTop);
  const visibleWidth = Math.min(rect.right, windowWidth) - Math.max(rect.left, 0);
  const visibleArea = Math.max(0, visibleHeight) * Math.max(0, visibleWidth);
  const totalArea = rect.height * rect.width;

  if (totalArea === 0) {
    return false;
  }

  const visibleRatio = visibleArea / totalArea;
  return visibleRatio >= threshold;
}

/**
 * Check if element has custom scroll parent (not document)
 * Useful for determining if special scroll handling is needed
 *
 * @param element - The element to check
 * @returns true if element has custom scroll parent, false otherwise
 */
export function hasCustomScrollParent(element: HTMLElement | null): boolean {
  if (!element) {
    return false;
  }

  const scrollParent = getScrollParent(element);
  return scrollParent !== document.documentElement;
}

/**
 * Get comprehensive visibility information for an element
 * Useful for debugging and detailed validation
 *
 * @param element - The element to analyze
 * @returns Object with detailed visibility information
 */
export function getElementVisibilityInfo(element: HTMLElement | null): {
  exists: boolean;
  isVisible: boolean;
  isInViewport: boolean;
  hasFixedPosition: boolean;
  hasCustomScrollParent: boolean;
  scrollParent: HTMLElement | null;
  computedStyle: CSSStyleDeclaration | null;
} {
  if (!element) {
    return {
      exists: false,
      isVisible: false,
      isInViewport: false,
      hasFixedPosition: false,
      hasCustomScrollParent: false,
      scrollParent: null,
      computedStyle: null,
    };
  }

  return {
    exists: true,
    isVisible: isElementVisible(element),
    isInViewport: isInViewport(element),
    hasFixedPosition: hasFixedPosition(element),
    hasCustomScrollParent: hasCustomScrollParent(element),
    scrollParent: getScrollParent(element),
    computedStyle: getComputedStyle(element),
  };
}
