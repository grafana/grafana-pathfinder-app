/**
 * Step executor for running interactive guide steps
 */

import { Page } from '@playwright/test';
import { StepInfo, StepResult, StepStatus, StepError } from './types';
import {
  logInfo,
  logError,
  logDebug,
  logWarn,
  logSelectorLookup,
  logSelectorFound,
  logSelectorNotFound,
  logInteraction,
  logWait,
  logWaitComplete,
} from './logger';
import { logDOMState } from './wait-helpers';
import { scrollElementIntoView, ensureElementVisible, findScrollContainer, scrollOneChunk, scrollUntilElementVisible, isElementInViewport } from './scroll-helpers';

export interface StepExecutorOptions {
  timeout: number;
  screenshotDir: string;
}

/**
 * Execute a single step: Show Me then Do It
 */
export async function executeStep(
  page: Page,
  step: StepInfo,
  options: StepExecutorOptions
): Promise<StepResult> {
  const startTime = Date.now();
  let showMeDuration = 0;
  let doItDuration = 0;
  let status: StepStatus = 'passed';
  let error: StepError | undefined;

  try {
    // Find the step element in the DOM
    logInfo(`Finding step element for step ${step.index}`, {
      context: 'step-executor',
      selector: `${step.type}[data-reftarget="${step.reftarget.substring(0, 50)}"]`,
    });
    const stepElement = await findStepElement(page, step);

    if (!stepElement) {
      logError(`Could not find step element for step ${step.index}`, {
        context: 'step-executor',
      });
      
      // Capture diagnostics
      let domSnapshot: string | undefined;
      let availableSelectors: string[] = [];
      try {
        domSnapshot = await logDOMState(page, '[data-pathfinder-content="true"]', 'step-executor');
        
        // Try to find what selectors are available
        availableSelectors = await page.evaluate(() => {
          const container = document.querySelector('[data-pathfinder-content="true"]');
          if (!container) return [];
          
          const selectors: string[] = [];
          const allInteractive = container.querySelectorAll('[data-targetaction]');
          allInteractive.forEach((el) => {
            const action = el.getAttribute('data-targetaction');
            const ref = el.getAttribute('data-reftarget');
            const classes = el.className;
            selectors.push(`.${classes.split(' ').join('.')}[data-targetaction="${action}"][data-reftarget="${ref}"]`);
          });
          return selectors.slice(0, 10); // Limit to first 10
        });
      } catch {
        // Ignore errors capturing diagnostics
      }
      
      status = 'failed';
      error = {
        type: 'button_not_found',
        message: `Could not find step element in DOM for step ${step.index}. Tried selector: .interactive[data-targetaction="${step.type}"][data-reftarget="${step.reftarget}"]`,
        stepHtml: step.stepHtml,
        domSnapshot,
        availableSelectors,
      };
      return createStepResult(step, status, error, showMeDuration, doItDuration, startTime);
    }

    logInfo(`Found step element for step ${step.index}`, { context: 'step-executor' });

    // Wait for step to be eligible (requirements check)
    logWait(`step ${step.index} to be eligible`, options.timeout, 'step-executor');
    await waitForStepEligible(page, stepElement, options.timeout);
    logWaitComplete(`step ${step.index} eligibility check`, Date.now() - startTime, 'step-executor');

    // Execute "Show me"
    logInfo(`Executing "Show me" for step ${step.index}`, { context: 'step-executor' });
    const showMeStart = Date.now();
    try {
      await clickShowMeButton(page, stepElement, options.timeout);
      logInfo(`"Show me" clicked for step ${step.index}`, { context: 'step-executor' });
      await waitForShowMeComplete(page, step);
      showMeDuration = Date.now() - showMeStart;
      logInfo(`"Show me" completed for step ${step.index} (${showMeDuration}ms)`, {
        context: 'step-executor',
      });
    } catch (err) {
      showMeDuration = Date.now() - showMeStart;
      const errorMessage = err instanceof Error ? err.message : String(err);
      logError(`"Show me" failed for step ${step.index}: ${errorMessage}`, {
        context: 'step-executor',
      });
      
      // Capture diagnostics
      let domSnapshot: string | undefined;
      let screenshot: string | undefined;
      try {
        screenshot = await captureScreenshot(
          page,
          options.screenshotDir,
          `step-${step.index}-showme-failure`
        );
        domSnapshot = await logDOMState(page, '[data-pathfinder-content="true"]', 'step-executor');
      } catch {
        // Ignore errors capturing diagnostics
      }
      
      status = 'failed';
      error = {
        type: 'action_failed',
        message: `Show Me failed: ${errorMessage}`,
        stepHtml: step.stepHtml,
        screenshot,
        domSnapshot,
      };
      return createStepResult(step, status, error, showMeDuration, doItDuration, startTime);
    }

    // Execute "Do it"
    logInfo(`Executing "Do it" for step ${step.index}`, { context: 'step-executor' });
    const doItStart = Date.now();
    try {
      await clickDoItButton(page, stepElement, options.timeout);
      logInfo(`"Do it" clicked for step ${step.index}`, { context: 'step-executor' });
      await waitForDoItComplete(page, step);
      doItDuration = Date.now() - doItStart;
      logInfo(`"Do it" completed for step ${step.index} (${doItDuration}ms)`, {
        context: 'step-executor',
      });
    } catch (err) {
      doItDuration = Date.now() - doItStart;
      const errorMessage = err instanceof Error ? err.message : String(err);
      logError(`"Do it" failed for step ${step.index}: ${errorMessage}`, {
        context: 'step-executor',
      });
      
      // Capture diagnostics
      let domSnapshot: string | undefined;
      let screenshot: string | undefined;
      try {
        screenshot = await captureScreenshot(
          page,
          options.screenshotDir,
          `step-${step.index}-doit-failure`
        );
        domSnapshot = await logDOMState(page, '[data-pathfinder-content="true"]', 'step-executor');
      } catch {
        // Ignore errors capturing diagnostics
      }
      
      status = 'failed';
      error = {
        type: 'action_failed',
        message: `Do It failed: ${errorMessage}`,
        stepHtml: step.stepHtml,
        screenshot,
        domSnapshot,
      };
      return createStepResult(step, status, error, showMeDuration, doItDuration, startTime);
    }
  } catch (err) {
    status = 'failed';
    const errorMessage = err instanceof Error ? err.message : String(err);
    logError(`Unexpected error in step ${step.index}: ${errorMessage}`, {
      context: 'step-executor',
    });
    
    // Capture diagnostics
    let domSnapshot: string | undefined;
    let screenshot: string | undefined;
    let pageState: string | undefined;
    try {
      screenshot = await captureScreenshot(
        page,
        options.screenshotDir,
        `step-${step.index}-error`
      );
      domSnapshot = await logDOMState(page, '[data-pathfinder-content="true"]', 'step-executor');
      pageState = await page
        .evaluate(() => ({
          url: window.location.href,
          title: document.title,
        }))
        .then((state) => JSON.stringify(state, null, 2));
    } catch {
      // Ignore errors capturing diagnostics
    }
    
    error = {
      type: 'unknown',
      message: `Unexpected error: ${errorMessage}`,
      stepHtml: step.stepHtml,
      screenshot,
      domSnapshot,
      pageState,
    };
  }

  return createStepResult(step, status, error, showMeDuration, doItDuration, startTime);
}

/**
 * Find the step element in the DOM
 * Scrolls until the SPECIFIC step element is visible in viewport
 */
async function findStepElement(page: Page, step: StepInfo): Promise<Element | null> {
  // Try multiple selector strategies (primary: .interactive-step matches actual rendered DOM)
  const selectorStrategies = [
    `.interactive-step[data-targetaction="${step.type}"][data-reftarget="${escapeSelector(step.reftarget)}"]`,
    `.interactive[data-targetaction="${step.type}"][data-reftarget="${escapeSelector(step.reftarget)}"]`,
    `[data-targetaction="${step.type}"][data-reftarget="${escapeSelector(step.reftarget)}"]`,
  ];

  // Find scroll container for progressive scrolling if needed
  const scrollContainer = await findScrollContainer(page);

  for (const selector of selectorStrategies) {
    logSelectorLookup(selector, 'step-executor');
    try {
      const elementLocator = page.locator(selector).first();
      const count = await elementLocator.count();
      if (count > 0) {
        logSelectorFound(selector, count, 'step-executor');
        
        // Check if element is visible and in viewport
        const isVisible = await elementLocator.isVisible().catch(() => false);
        let inViewport = false;
        
        if (isVisible && scrollContainer) {
          inViewport = await isElementInViewport(scrollContainer, elementLocator).catch(() => false);
        }
        
        if (!isVisible || !inViewport) {
          // Element exists but not visible in viewport, scroll until it is
          logDebug('Element found but not visible in viewport, scrolling until visible', {
            context: 'step-executor',
          });
          
          if (scrollContainer) {
            // Use scrollUntilElementVisible to scroll until SPECIFIC step is visible
            const scrolled = await scrollUntilElementVisible(page, scrollContainer, selector, {
              context: 'step-executor',
            });
            
            if (!scrolled) {
              logWarn('Could not scroll element into viewport, element may not be in scrollable area', {
                context: 'step-executor',
              });
            }
          }
          
          // Re-check visibility after scrolling
          const nowVisible = await elementLocator.isVisible().catch(() => false);
          if (nowVisible && scrollContainer) {
            inViewport = await isElementInViewport(scrollContainer, elementLocator).catch(() => false);
          }
        }
        
        // Final scroll to center element in viewport (if not already perfectly positioned)
        if (isVisible || (await elementLocator.isVisible().catch(() => false))) {
          logDebug('Scrolling step element into view (final positioning)', { context: 'step-executor' });
          await scrollElementIntoView(page, elementLocator, { context: 'step-executor' });
          
          // Verify element is now in viewport before returning
          if (scrollContainer) {
            const finalInViewport = await isElementInViewport(scrollContainer, elementLocator).catch(() => false);
            if (finalInViewport) {
              logDebug('Step element is now visible in viewport', { context: 'step-executor' });
              return await elementLocator.elementHandle();
            } else {
              logWarn('Step element still not in viewport after scrolling', { context: 'step-executor' });
              // Continue anyway - element exists and might be interactable
            }
          }
          
          return await elementLocator.elementHandle();
        }
      }
      logWarn(`Selector matched but found 0 elements: ${selector}`, {
        context: 'step-executor',
        selector,
      });
    } catch (err) {
      logSelectorNotFound(selector, 5000, 'step-executor');
      // Continue to next strategy
    }
  }

  // Fallback: try to find by text content if available
  if (step.textContent) {
    const textSelector = `text="${step.textContent.substring(0, 50)}"`;
    logSelectorLookup(textSelector, 'step-executor');
    try {
      const elementLocator = page.locator(textSelector).first();
      const count = await elementLocator.count();
      if (count > 0) {
        logSelectorFound(textSelector, count, 'step-executor');
        
        // Scroll element into view before returning
        logDebug('Scrolling step element into view (text fallback)', { context: 'step-executor' });
        await scrollElementIntoView(page, elementLocator, { context: 'step-executor' });
        
        return await elementLocator.elementHandle();
      }
    } catch {
      logSelectorNotFound(textSelector, 5000, 'step-executor');
    }
  }

  logError('All selector strategies failed for step element', { context: 'step-executor' });
  return null;
}

/**
 * Wait for step to be eligible (requirements check passes)
 */
async function waitForStepEligible(
  page: Page,
  stepElement: Element | null,
  timeout: number
): Promise<void> {
  if (!stepElement) {
    return;
  }

  // Wait for the step's buttons to be enabled
  // Pathfinder disables buttons when requirements aren't met
  const startTime = Date.now();
  const buttonSelector = 'button:has-text("Show me"), button:has-text("Do it")';
  logWait('step buttons to be enabled', timeout, 'step-executor');
  
  while (Date.now() - startTime < timeout) {
    logSelectorLookup(buttonSelector, 'step-executor');
    const buttons = await page.locator(buttonSelector).all();
    const enabledButtons = await Promise.all(
      buttons.map(async (btn) => !(await btn.isDisabled()))
    );

    const enabledCount = enabledButtons.filter((enabled) => enabled).length;
    logDebug(`Found ${buttons.length} buttons, ${enabledCount} enabled`, {
      context: 'step-executor',
    });

    if (enabledButtons.some((enabled) => enabled)) {
      const duration = Date.now() - startTime;
      logWaitComplete('step buttons enabled', duration, 'step-executor');
      return;
    }

    await page.waitForTimeout(500);
  }

  // If we timeout, continue anyway - the step executor will handle errors
  logWarn('Timeout waiting for step buttons to be enabled, continuing anyway', {
    context: 'step-executor',
    timeout,
  });
}

/**
 * Click the "Show me" button for a step
 * Finds the first enabled Show me button (steps execute sequentially, so this should be the current step)
 */
async function clickShowMeButton(page: Page, stepElement: Element | null, timeout: number): Promise<void> {
  // Pathfinder renders buttons with class "interactive-step-show-btn"
  // Since steps execute sequentially, the first enabled button should be the current step
  const buttonSelector = '.interactive-step-show-btn:not([disabled])';
  logSelectorLookup(buttonSelector, 'step-executor');
  const showMeButton = page.locator(buttonSelector).first();

  logWait('Show me button to be visible', timeout, 'step-executor');
  await showMeButton.waitFor({ state: 'visible', timeout });
  logWait('Show me button to be attached', timeout, 'step-executor');
  await showMeButton.waitFor({ state: 'attached', timeout });

  // Scroll button into view before clicking
  logDebug('Scrolling Show me button into view', { context: 'step-executor' });
  await scrollElementIntoView(page, showMeButton, { context: 'step-executor' });
  
  // Small delay after scrolling to allow UI to settle
  await page.waitForTimeout(200);

  // Double-check button is not disabled (race condition protection)
  const isDisabled = await showMeButton.isDisabled();
  if (isDisabled) {
    logError('Show me button is disabled - requirements may not be met', {
      context: 'step-executor',
    });
    throw new Error('Show me button is disabled - requirements may not be met');
  }

  logInteraction('Clicking', buttonSelector, 'step-executor');
  await showMeButton.click();
  logInfo('Show me button clicked', { context: 'step-executor' });
}

/**
 * Click the "Do it" button for a step
 * Finds the first enabled Do it button (steps execute sequentially, so this should be the current step)
 */
async function clickDoItButton(page: Page, stepElement: Element | null, timeout: number): Promise<void> {
  // Pathfinder renders buttons with class "interactive-step-do-btn"
  // Since steps execute sequentially, the first enabled button should be the current step
  const buttonSelector = '.interactive-step-do-btn:not([disabled])';
  logSelectorLookup(buttonSelector, 'step-executor');
  const doItButton = page.locator(buttonSelector).first();

  logWait('Do it button to be visible', timeout, 'step-executor');
  await doItButton.waitFor({ state: 'visible', timeout });
  logWait('Do it button to be attached', timeout, 'step-executor');
  await doItButton.waitFor({ state: 'attached', timeout });

  // Scroll button into view before clicking
  logDebug('Scrolling Do it button into view', { context: 'step-executor' });
  await scrollElementIntoView(page, doItButton, { context: 'step-executor' });
  
  // Small delay after scrolling to allow UI to settle
  await page.waitForTimeout(200);

  // Double-check button is not disabled (race condition protection)
  const isDisabled = await doItButton.isDisabled();
  if (isDisabled) {
    logError('Do it button is disabled - requirements may not be met', {
      context: 'step-executor',
    });
    throw new Error('Do it button is disabled - requirements may not be met');
  }

  logInteraction('Clicking', buttonSelector, 'step-executor');
  await doItButton.click();
  logInfo('Do it button clicked', { context: 'step-executor' });
}

/**
 * Wait for Show Me action to complete
 */
async function waitForShowMeComplete(page: Page, step: StepInfo): Promise<void> {
  // Wait for highlight to appear or action to complete
  // Pathfinder adds highlight classes or shows elements
  // We can check for highlight styles or wait for a short delay
  logWait('Show Me action to complete', 1000, 'step-executor');
  await page.waitForTimeout(1000); // Give time for highlight to appear

  // For highlight actions, verify the target element is visible/highlighted
  if (step.type === 'highlight') {
    logSelectorLookup(step.reftarget, 'step-executor');
    try {
      await page.waitForSelector(step.reftarget, { timeout: 5000, state: 'visible' });
      logSelectorFound(step.reftarget, 1, 'step-executor');
    } catch {
      // Element might not be visible, that's okay for some steps
      logWarn(`Target element not visible for highlight step: ${step.reftarget}`, {
        context: 'step-executor',
        selector: step.reftarget,
      });
    }
  }
  
  logWaitComplete('Show Me action', 1000, 'step-executor');
}

/**
 * Wait for Do It action to complete
 */
async function waitForDoItComplete(page: Page, step: StepInfo): Promise<void> {
  // Wait for action to complete
  // This varies by action type:
  // - highlight: element should be clicked
  // - button: button should be clicked
  // - formfill: form should be filled
  // - navigate: navigation should occur
  logWait('Do It action to complete', 2000, 'step-executor');
  await page.waitForTimeout(2000); // Give time for action to complete

  // For navigate actions, wait for navigation
  if (step.type === 'navigate') {
    logWait('navigation to complete (networkidle)', 10000, 'step-executor');
    await page.waitForLoadState('networkidle', { timeout: 10000 });
    logWaitComplete('navigation', 10000, 'step-executor');
  }
  
  logWaitComplete('Do It action', 2000, 'step-executor');
}

/**
 * Capture a screenshot
 */
async function captureScreenshot(
  page: Page,
  screenshotDir: string,
  filename: string
): Promise<string> {
  const screenshotPath = `${screenshotDir}/${filename}.png`;
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return screenshotPath;
}

/**
 * Escape CSS selector special characters
 */
function escapeSelector(selector: string): string {
  return selector.replace(/[!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~]/g, '\\$&');
}

/**
 * Create a step result object
 */
function createStepResult(
  step: StepInfo,
  status: StepStatus,
  error: StepError | undefined,
  showMeDuration: number,
  doItDuration: number,
  startTime: number
): StepResult {
  return {
    index: step.index,
    type: step.type,
    reftarget: step.reftarget,
    status,
    error,
    showMeDuration,
    doItDuration,
    totalDuration: Date.now() - startTime,
  };
}

