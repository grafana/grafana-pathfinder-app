/**
 * Scroll helpers for e2e tests
 * Handles scrolling within the Pathfinder sidebar scrollable container
 */

import { Page, Locator } from '@playwright/test';
import { logInfo, logDebug, logWarn } from './logger';

export interface ScrollOptions {
  behavior?: 'auto' | 'smooth';
  block?: 'start' | 'center' | 'end' | 'nearest';
  inline?: 'start' | 'center' | 'end' | 'nearest';
  context?: string;
}

// Configuration constants for progressive scrolling
const SCROLL_CHUNK_SIZE = 300; // pixels to scroll per chunk
const SCROLL_DEBOUNCE_MS = 2000; // milliseconds to wait after each scroll chunk
const MAX_SCROLL_ATTEMPTS = 10; // prevent infinite loops
const REACT_RENDER_WAIT_MS = 500; // milliseconds to wait for React rendering after scroll

/**
 * Find the scrollable container for Pathfinder content
 * Returns the primary scroll container or a fallback
 */
export async function findScrollContainer(page: Page): Promise<Locator | null> {
  // Primary: the main scrollable content area
  const primaryContainer = page.locator('#inner-docs-content');
  const primaryExists = await primaryContainer.count();
  
  if (primaryExists > 0) {
    logDebug('Found primary scroll container: #inner-docs-content', { context: 'scroll' });
    return primaryContainer;
  }
  
  // Fallback: the outer content container
  const fallbackContainer = page.locator('[data-pathfinder-content="true"]');
  const fallbackExists = await fallbackContainer.count();
  
  if (fallbackExists > 0) {
    logDebug('Using fallback scroll container: [data-pathfinder-content="true"]', { context: 'scroll' });
    return fallbackContainer;
  }
  
  logWarn('No scroll container found', { context: 'scroll' });
  return null;
}

/**
 * Get scroll position and dimensions of a container
 */
export async function getScrollInfo(container: Locator): Promise<{
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  canScrollDown: boolean;
}> {
  return await container.evaluate((el) => {
    const scrollTop = el.scrollTop;
    const scrollHeight = el.scrollHeight;
    const clientHeight = el.clientHeight;
    const canScrollDown = scrollTop + clientHeight < scrollHeight - 1; // -1 for rounding
    
    return {
      scrollTop,
      scrollHeight,
      clientHeight,
      canScrollDown,
    };
  });
}

/**
 * Scroll an element into view within its scroll container
 */
export async function scrollElementIntoView(
  page: Page,
  element: Locator,
  options: ScrollOptions = {}
): Promise<void> {
  const { context = 'scroll' } = options;
  
  logDebug('Scrolling element into view', { context });
  
  try {
    // Use Playwright's built-in scrollIntoViewIfNeeded which handles most cases
    await element.scrollIntoViewIfNeeded({ timeout: 5000 });
    
    // Small delay to allow UI to settle after scroll
    await page.waitForTimeout(200);
    
    logDebug('Element scrolled into view', { context });
  } catch (error) {
    logWarn(`Failed to scroll element into view: ${error instanceof Error ? error.message : String(error)}`, {
      context,
    });
    // Continue anyway - element might already be visible
  }
}

/**
 * Check if an element is visible within the viewport of its scroll container
 */
export async function isElementInViewport(
  container: Locator,
  element: Locator
): Promise<boolean> {
  try {
    const containerHandle = await container.elementHandle();
    const elementHandle = await element.elementHandle();
    
    if (!containerHandle || !elementHandle) {
      return false;
    }
    
    // Use boundingBox to check if element is within container's viewport
    const containerBox = await containerHandle.boundingBox();
    const elementBox = await elementHandle.boundingBox();
    
    if (!containerBox || !elementBox) {
      return false;
    }
    
    // Get scroll position of container
    const scrollInfo = await getScrollInfo(container);
    
    // Calculate visible area of container
    const containerTop = scrollInfo.scrollTop;
    const containerBottom = scrollInfo.scrollTop + scrollInfo.clientHeight;
    
    // Get element's position relative to container's scroll position
    // We need to check if element's position is within the visible scroll area
    const elementTop = await elementHandle.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const container = el.closest('#inner-docs-content') || el.closest('[data-pathfinder-content="true"]');
      if (!container) return null;
      const containerRect = container.getBoundingClientRect();
      return rect.top - containerRect.top + container.scrollTop;
    });
    
    if (elementTop === null) {
      // Fallback: use bounding boxes
      return (
        elementBox.y >= containerBox.y &&
        elementBox.y + elementBox.height <= containerBox.y + containerBox.height
      );
    }
    
    // Check if element is within visible scroll area
    const elementBottom = elementTop + elementBox.height;
    return elementTop >= containerTop && elementBottom <= containerBottom;
  } catch {
    return false;
  }
}

/**
 * Scroll container one chunk forward
 * Scrolls exactly one increment and returns whether scrolling occurred
 */
export async function scrollOneChunk(
  page: Page,
  container: Locator,
  options: ScrollOptions = {}
): Promise<boolean> {
  const { context = 'scroll' } = options;
  
  const scrollInfo = await getScrollInfo(container);
  
  if (!scrollInfo.canScrollDown) {
    logDebug('Cannot scroll down further', { context });
    return false;
  }
  
  const currentScroll = scrollInfo.scrollTop;
  const maxScroll = scrollInfo.scrollHeight - scrollInfo.clientHeight;
  const nextScroll = Math.min(currentScroll + SCROLL_CHUNK_SIZE, maxScroll);
  
  if (nextScroll === currentScroll) {
    logDebug('Already at scroll limit', { context });
    return false;
  }
  
  logDebug(`Scrolling one chunk: ${currentScroll} → ${nextScroll} (chunk size: ${SCROLL_CHUNK_SIZE}px)`, {
    context,
  });
  
  await container.evaluate((el, scrollTo) => {
    el.scrollTo({ top: scrollTo, behavior: 'smooth' });
  }, nextScroll);
  
  // Wait for debounce period to allow UI to settle
  await page.waitForTimeout(SCROLL_DEBOUNCE_MS);
  
  // Additional wait for React rendering after scroll
  await page.waitForTimeout(REACT_RENDER_WAIT_MS);
  
  logDebug(`Scroll chunk complete, waited ${SCROLL_DEBOUNCE_MS + REACT_RENDER_WAIT_MS}ms`, { context });
  return true;
}

/**
 * Scroll container progressively to reveal content
 * DEPRECATED: Use scrollOneChunk() with check-after-scroll pattern instead
 * This function is kept for backward compatibility but scrolls continuously
 */
export async function scrollContainerProgressively(
  page: Page,
  container: Locator,
  options: ScrollOptions = {}
): Promise<void> {
  const { context = 'scroll' } = options;
  
  logWarn('scrollContainerProgressively() is deprecated, use scrollOneChunk() with check-after-scroll pattern', {
    context,
  });
  
  // For backward compatibility, scroll one chunk
  await scrollOneChunk(page, container, options);
}

/**
 * Scroll container to bottom
 */
export async function scrollContainerToBottom(
  page: Page,
  container: Locator,
  options: ScrollOptions = {}
): Promise<void> {
  const { context = 'scroll' } = options;
  
  logDebug('Scrolling container to bottom', { context });
  
  const scrollInfo = await getScrollInfo(container);
  
  if (!scrollInfo.canScrollDown) {
    logDebug('Container already at bottom', { context });
    return;
  }
  
  await container.evaluate((el) => {
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  });
  
  // Wait for smooth scroll to complete
  await page.waitForTimeout(500);
  
  logDebug('Container scrolled to bottom', { context });
}

/**
 * Ensure an element is visible by scrolling it into view
 * Combines finding the element and scrolling it into view
 */
export async function ensureElementVisible(
  page: Page,
  element: Locator,
  options: ScrollOptions = {}
): Promise<boolean> {
  const { context = 'scroll' } = options;
  
  try {
    // First check if element exists
    const count = await element.count();
    if (count === 0) {
      logWarn('Element not found for scrolling', { context });
      return false;
    }
    
    // Check if element is already visible
    const isVisible = await element.isVisible().catch(() => false);
    if (isVisible) {
      logDebug('Element already visible, no scrolling needed', { context });
      return true;
    }
    
    // Scroll element into view
    await scrollElementIntoView(page, element, options);
    
    // Verify it's now visible
    const nowVisible = await element.isVisible().catch(() => false);
    if (nowVisible) {
      logInfo('Element is now visible after scrolling', { context });
      return true;
    }
    
    logWarn('Element still not visible after scrolling', { context });
    return false;
  } catch (error) {
    logWarn(`Error ensuring element visibility: ${error instanceof Error ? error.message : String(error)}`, {
      context,
    });
    return false;
  }
}

/**
 * Scroll container to reveal elements matching a selector
 * Uses progressive scroll-then-check pattern: scroll one chunk → wait → check → repeat if needed
 */
export async function scrollToRevealElements(
  page: Page,
  container: Locator,
  selector: string,
  options: ScrollOptions = {}
): Promise<number> {
  const { context = 'scroll' } = options;
  
  logDebug(`Scrolling to reveal elements matching: ${selector}`, { context });
  
  // Check initial state - count visible elements
  const allElements = page.locator(selector);
  const totalCount = await allElements.count();
  
  if (totalCount === 0) {
    logDebug('No elements found matching selector', { context });
    return 0;
  }
  
  // Helper to count visible elements
  const countVisible = async (): Promise<number> => {
    let visibleCount = 0;
    for (let i = 0; i < totalCount; i++) {
      const isVisible = await allElements.nth(i).isVisible().catch(() => false);
      if (isVisible) visibleCount++;
    }
    return visibleCount;
  };
  
  let visibleCount = await countVisible();
  logDebug(`Initial state: ${visibleCount}/${totalCount} elements visible`, { context });
  
  if (visibleCount === totalCount) {
    logDebug('All elements already visible', { context });
    return visibleCount;
  }
  
  // Progressive scroll-then-check pattern
  let scrollAttempts = 0;
  let lastVisibleCount = visibleCount;
  
  while (scrollAttempts < MAX_SCROLL_ATTEMPTS && visibleCount < totalCount) {
    // Check if we can scroll
    const scrollInfo = await getScrollInfo(container);
    if (!scrollInfo.canScrollDown) {
      logDebug('Cannot scroll down further', { context });
      break;
    }
    
    // Scroll one chunk
    const scrolled = await scrollOneChunk(page, container, options);
    if (!scrolled) {
      logDebug('No scrolling occurred, stopping', { context });
      break;
    }
    
    scrollAttempts++;
    
    // Check visibility after scroll and debounce wait
    visibleCount = await countVisible();
    
    if (visibleCount > lastVisibleCount) {
      logDebug(`Found ${visibleCount - lastVisibleCount} more visible elements (${visibleCount}/${totalCount} total)`, {
        context,
      });
      lastVisibleCount = visibleCount;
    }
    
    // If we found all elements, stop immediately
    if (visibleCount === totalCount) {
      logInfo(`All elements now visible after ${scrollAttempts} scroll chunk(s)`, { context });
      break;
    }
    
    // If no new elements found, continue scrolling (might need to scroll past some content)
    logDebug(`After scroll chunk ${scrollAttempts}: ${visibleCount}/${totalCount} visible, continuing...`, {
      context,
    });
  }
  
  if (scrollAttempts >= MAX_SCROLL_ATTEMPTS) {
    logWarn(`Reached max scroll attempts (${MAX_SCROLL_ATTEMPTS}), stopping`, { context });
  }
  
  logInfo(`Scroll complete: ${visibleCount}/${totalCount} elements visible after ${scrollAttempts} chunk(s)`, {
    context,
  });
  return visibleCount;
}

/**
 * Scroll container until a specific element is visible in the viewport
 * Uses progressive scroll-then-check pattern: scroll one chunk → wait → check → repeat if needed
 */
export async function scrollUntilElementVisible(
  page: Page,
  container: Locator,
  elementSelector: string,
  options: ScrollOptions = {}
): Promise<boolean> {
  const { context = 'scroll' } = options;
  
  logDebug(`Scrolling until element is visible: ${elementSelector}`, { context });
  
  // First check if element exists
  const elementLocator = page.locator(elementSelector).first();
  const count = await elementLocator.count();
  
  if (count === 0) {
    logDebug('Element not found in DOM', { context });
    return false;
  }
  
  // Check if already visible
  const isVisible = await elementLocator.isVisible().catch(() => false);
  if (isVisible) {
    const inViewport = await isElementInViewport(container, elementLocator).catch(() => false);
    if (inViewport) {
      logDebug('Element already visible in viewport', { context });
      return true;
    }
  }
  
  // Progressive scroll-then-check pattern
  let scrollAttempts = 0;
  
  while (scrollAttempts < MAX_SCROLL_ATTEMPTS) {
    // Check if element is now visible in viewport
    const nowVisible = await elementLocator.isVisible().catch(() => false);
    if (nowVisible) {
      const inViewport = await isElementInViewport(container, elementLocator).catch(() => false);
      if (inViewport) {
        logDebug(`Element became visible in viewport after ${scrollAttempts} scroll chunk(s)`, {
          context,
        });
        return true;
      }
    }
    
    // Check if we can scroll
    const scrollInfo = await getScrollInfo(container);
    if (!scrollInfo.canScrollDown) {
      logDebug('Cannot scroll down further, element may not be in scrollable area', { context });
      break;
    }
    
    // Scroll one chunk
    const scrolled = await scrollOneChunk(page, container, options);
    if (!scrolled) {
      logDebug('No scrolling occurred, stopping', { context });
      break;
    }
    
    scrollAttempts++;
  }
  
  if (scrollAttempts >= MAX_SCROLL_ATTEMPTS) {
    logWarn(`Reached max scroll attempts (${MAX_SCROLL_ATTEMPTS}), element may not be visible`, {
      context,
    });
  }
  
  // Final check
  const finalVisible = await elementLocator.isVisible().catch(() => false);
  const finalInViewport = finalVisible
    ? await isElementInViewport(container, elementLocator).catch(() => false)
    : false;
  
  return finalInViewport;
}

