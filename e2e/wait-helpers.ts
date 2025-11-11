/**
 * Wait helpers for e2e tests
 * Provides intelligent waiting with logging and diagnostics
 */

import { Page } from '@playwright/test';
import { logInfo, logDebug, logWarn, logError, logSelectorLookup, logSelectorFound, logSelectorNotFound, logWait, logWaitComplete } from './logger';
import { findScrollContainer, scrollOneChunk, isElementInViewport } from './scroll-helpers';

export interface WaitOptions {
  timeout?: number;
  context?: string;
  screenshotDir?: string;
}

/**
 * Log DOM state for debugging
 */
export async function logDOMState(
  page: Page,
  containerSelector: string,
  context?: string
): Promise<string> {
  const domState = await page.evaluate(
    (selector) => {
      const container = document.querySelector(selector);
      if (!container) {
        return `Container not found: ${selector}`;
      }

      const info: string[] = [];
      info.push(`Container: ${selector}`);
      info.push(`InnerHTML length: ${container.innerHTML.length}`);
      info.push(`Child elements: ${container.children.length}`);

      // List all classes found in container
      const allElements = container.querySelectorAll('*');
      const classes = new Set<string>();
      allElements.forEach((el) => {
        el.className.split(' ').forEach((cls) => {
          if (cls.trim()) classes.add(cls.trim());
        });
      });
      info.push(`Classes found: ${Array.from(classes).slice(0, 20).join(', ')}${classes.size > 20 ? '...' : ''}`);

      // Check for interactive elements
      const interactiveElements = container.querySelectorAll('[data-targetaction]');
      info.push(`Elements with data-targetaction: ${interactiveElements.length}`);
      interactiveElements.forEach((el, idx) => {
        const action = el.getAttribute('data-targetaction');
        const ref = el.getAttribute('data-reftarget');
        const classes = el.className;
        info.push(`  [${idx}] action=${action}, reftarget=${ref?.substring(0, 50)}, classes=${classes}`);
      });

      // Check for interactive-step class
      const interactiveStepElements = container.querySelectorAll('.interactive-step');
      info.push(`Elements with .interactive-step class: ${interactiveStepElements.length}`);

      // Check for .interactive class
      const interactiveClassElements = container.querySelectorAll('.interactive');
      info.push(`Elements with .interactive class: ${interactiveClassElements.length}`);

      return info.join('\n');
    },
    containerSelector
  );

  logDebug(`DOM State:\n${domState}`, { context });
  return domState;
}

/**
 * Wait for guide content container to exist and be populated
 */
export async function waitForGuideContentContainer(
  page: Page,
  options: WaitOptions = {}
): Promise<void> {
  const { timeout = 10000, context = 'guide-loading' } = options;
  const containerSelector = '[data-pathfinder-content="true"]';

  logWait('guide content container', timeout, context);
  const startTime = Date.now();

  try {
    await page.waitForSelector(containerSelector, { timeout, state: 'attached' });
    logSelectorFound(containerSelector, 1, context);

    // Wait for container to have content (not empty)
    await page.waitForFunction(
      (selector) => {
        const container = document.querySelector(selector);
        return container && container.innerHTML.trim().length > 0;
      },
      containerSelector,
      { timeout }
    );

    const duration = Date.now() - startTime;
    logWaitComplete('guide content container populated', duration, context);
  } catch (error) {
    const duration = Date.now() - startTime;
    logError(`Failed to wait for guide content container after ${duration}ms`, { context, timeout });
    throw error;
  }
}

/**
 * Wait for loading indicators to disappear
 */
export async function waitForLoadingComplete(
  page: Page,
  options: WaitOptions = {}
): Promise<void> {
  const { timeout = 5000, context = 'guide-loading' } = options;

  logWait('loading indicators to disappear', timeout, context);
  const startTime = Date.now();

  try {
    // Wait for common loading indicators to disappear
    const loadingSelectors = [
      '[data-testid="loading"]',
      '.loading',
      '.spinner',
      '[aria-busy="true"]',
    ];

    for (const selector of loadingSelectors) {
      try {
        await page.waitForSelector(selector, { state: 'hidden', timeout: 2000 });
      } catch {
        // Ignore if selector doesn't exist or already hidden
      }
    }

    const duration = Date.now() - startTime;
    logWaitComplete('loading indicators cleared', duration, context);
  } catch (error) {
    // Non-fatal - continue even if loading indicators don't disappear
    logWarn('Some loading indicators may still be present', { context });
  }
}

/**
 * Wait for interactive elements with multiple selector strategies
 */
export async function waitForInteractiveElements(
  page: Page,
  options: WaitOptions = {}
): Promise<void> {
  const { timeout = 30000, context = 'guide-loading', screenshotDir } = options;
  const startTime = Date.now();

  // Try multiple selector strategies (primary: .interactive-step matches actual rendered DOM)
  const selectorStrategies = [
    '.interactive-step[data-targetaction]',
    '.interactive[data-targetaction]',
    '[data-targetaction]',
  ];

  let lastError: Error | null = null;

  // Find scroll container for progressive scrolling
  const scrollContainer = await findScrollContainer(page);
  if (scrollContainer) {
    logDebug('Found scroll container, will use progressive scroll-then-check', { context });
  }

  for (const selector of selectorStrategies) {
    logSelectorLookup(selector, context);

    try {
      // Progressive scroll-then-check pattern: scroll one chunk → wait → check → repeat if needed
      if (scrollContainer) {
        logDebug('Using progressive scroll-then-check to reveal elements', { context });
        
        const scrollStartTime = Date.now();
        const scrollTimeout = Math.min(timeout, 20000); // Use portion of timeout for scrolling
        let scrollAttempts = 0;
        const maxScrollAttempts = 30; // Prevent infinite loops
        
        while (Date.now() - scrollStartTime < scrollTimeout && scrollAttempts < maxScrollAttempts) {
          // Check if elements are visible now (before scrolling)
          const allElements = page.locator(selector);
          const totalCount = await allElements.count();
          
          if (totalCount > 0) {
            // Check if at least one element is visible AND in viewport
            let foundVisible = false;
            for (let i = 0; i < Math.min(totalCount, 3); i++) {
              const elementLocator = allElements.nth(i);
              const isVisible = await elementLocator.isVisible().catch(() => false);
              if (isVisible) {
                // Check if element is actually in viewport
                const inViewport = await isElementInViewport(scrollContainer, elementLocator).catch(() => false);
                if (inViewport) {
                  foundVisible = true;
                  logDebug(`Found visible element in viewport at index ${i} (${totalCount} total elements)`, { context });
                  break;
                }
              }
            }
            
            if (foundVisible) {
              // Found visible elements in viewport, break out of scroll loop
              logDebug(`Found visible elements in viewport after ${scrollAttempts} scroll chunk(s)`, { context });
              break;
            }
          }
          
          // Element not visible, scroll one chunk forward
          // scrollOneChunk already includes React rendering wait
          const scrolled = await scrollOneChunk(page, scrollContainer, { context });
          if (!scrolled) {
            logDebug('Cannot scroll further, stopping scroll loop', { context });
            break;
          }
          
          scrollAttempts++;
          logDebug(`Scroll chunk ${scrollAttempts} complete, checking for elements...`, { context });
          
          // Additional wait for elements to appear after scroll (scrollOneChunk already waits, but double-check)
          // Try waiting for selector with short timeout to catch elements that appear after scroll
          try {
            await page.waitForSelector(selector, { timeout: 1000, state: 'visible' }).catch(() => {
              // Ignore timeout - elements might not be visible yet
            });
          } catch {
            // Ignore errors - we'll check visibility in next iteration
          }
        }
        
        if (scrollAttempts > 0) {
          logDebug(`Completed ${scrollAttempts} scroll chunk(s) in scroll-then-check loop`, { context });
        }
      }
      
      // Now wait for selector to be visible (with remaining timeout)
      const remainingTimeout = timeout - (Date.now() - startTime);
      if (remainingTimeout > 0) {
        await page.waitForSelector(selector, { timeout: Math.min(remainingTimeout, 10000), state: 'visible' });
      }

      // Verify we actually found elements
      const count = await page.locator(selector).count();
      if (count > 0) {
        const duration = Date.now() - startTime;
        logSelectorFound(selector, count, context);
        logWaitComplete(`interactive elements found (${selector})`, duration, context);
        return;
      } else {
        logWarn(`Selector matched but found 0 elements: ${selector}`, { context, selector });
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logSelectorNotFound(selector, Math.min(timeout, 10000), context);
      // Continue to next strategy
    }
  }

  // All strategies failed - capture diagnostics
  const duration = Date.now() - startTime;
  logError(`All selector strategies failed after ${duration}ms`, { context, timeout });

  // Capture DOM state for debugging
  try {
    const domState = await logDOMState(page, '[data-pathfinder-content="true"]', context);

    // Capture screenshot if directory provided
    if (screenshotDir) {
      const screenshotPath = `${screenshotDir}/selector-timeout-${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      logInfo(`Screenshot saved: ${screenshotPath}`, { context });
    }

    // Enhanced error message
    const errorMessage = `Failed to find interactive elements after ${duration}ms. Tried selectors: ${selectorStrategies.join(', ')}.\nDOM State:\n${domState}`;
    throw new Error(errorMessage);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Failed to find')) {
      throw error;
    }
    throw lastError || error;
  }
}

/**
 * Comprehensive wait for guide content to be fully loaded
 */
export async function waitForGuideContent(
  page: Page,
  options: WaitOptions = {}
): Promise<void> {
  const { context = 'guide-loading', screenshotDir } = options;

  logInfo('Starting comprehensive guide content wait', { context });

  try {
    // Step 1: Wait for container to exist and be populated
    await waitForGuideContentContainer(page, { ...options, context });

    // Step 2: Wait for loading indicators to disappear
    await waitForLoadingComplete(page, { ...options, context });

    // Step 3: Small delay for React to finish rendering
    await page.waitForTimeout(500);
    logDebug('Waiting for React rendering to complete', { context });

    // Step 4: Wait for interactive elements
    await waitForInteractiveElements(page, { ...options, context, screenshotDir });

    logInfo('Guide content fully loaded', { context });
  } catch (error) {
    logError('Failed to wait for guide content', { context });
    throw error;
  }
}

