/**
 * Main test runner for executing interactive guide tests
 */

import { chromium, Browser, Page, BrowserContext } from '@playwright/test';
import { parseGuideSteps, parseGuideMetadata } from './guide-parser';
import { executeStep } from './step-executor';
import { createTestReport, generateReport, printReportSummary } from './reporter';
import { TestConfig, TestReport, StepInfo, StepResult } from './types';
import { waitForGuideContent, logDOMState } from './wait-helpers';
import { logInfo, logError, logDebug, logInteraction, logSelectorLookup, logSelectorFound } from './logger';
import { prepareStackForGuide } from './stack-setup';
import { isBundledGuide } from './guide-utils';
import { loadGuideViaDevMode } from './dev-mode-loader';
import { join } from 'path';
import { mkdir } from 'fs/promises';

/**
 * Run a complete guide test
 */
export async function runGuideTest(config: TestConfig): Promise<TestReport> {
  const startTime = Date.now();
  let browser: Browser | null = null;
  let page: Page | null = null;
  let context: BrowserContext | null = null;

  try {
    // Ensure output directory exists
    await mkdir(config.outputDir, { recursive: true });
    const screenshotDir = join(config.outputDir, 'screenshots');
    await mkdir(screenshotDir, { recursive: true });

    // Launch browser
    browser = await chromium.launch({ headless: false });
    context = await browser.newContext();
    page = await context.newPage();

    // Set up console error capture
    const consoleErrors: string[] = [];
    const setupConsoleErrorCapture = (targetPage: Page) => {
      targetPage.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
          logError(`Browser console error: ${msg.text()}`, { context: 'browser-console' });
        }
      });

      targetPage.on('pageerror', (error) => {
        consoleErrors.push(error.message);
        logError(`Page error: ${error.message}`, { context: 'page-error' });
      });
    };
    setupConsoleErrorCapture(page);

    // Prepare stack for testing (handles remote stack auth and dev mode setup)
    try {
      await prepareStackForGuide(context, page, config, screenshotDir);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logError(`Stack setup failed: ${errorMessage}`, { context: 'stack-setup' });
      throw new Error(`Failed to prepare stack: ${errorMessage}`);
    }

    // Detect if guide is bundled or non-bundled
    const isBundled = isBundledGuide(config.guideUrl);

    if (isBundled) {
      // For bundled guides, use existing workflow
      // For remote stacks, prepareStackForGuide already navigated to Grafana
      // For local stacks, navigate now
      if (config.stackMode === 'local') {
        logInfo(`Navigating to ${config.grafanaUrl}...`, { context: 'navigation' });
        await page.goto(config.grafanaUrl);
        logDebug('Waiting for network idle', { context: 'navigation' });
        await page.waitForLoadState('networkidle');
        logInfo('Navigation complete', { context: 'navigation' });
      } else {
        // For remote stacks, ensure we're on the Grafana home page
        // (prepareStackForGuide may have navigated to config page)
        const currentUrl = new URL(page.url());
        const grafanaUrl = new URL(config.grafanaUrl);
        
        // If we're on the config page, navigate back to home
        if (currentUrl.pathname.includes('/a/grafana-pathfinder-app')) {
          logInfo('Navigating to Grafana home page...', { context: 'navigation' });
          await page.goto(config.grafanaUrl);
          await page.waitForLoadState('networkidle');
          logInfo('Navigation complete', { context: 'navigation' });
        }
      }

      // Open Pathfinder panel
      logInfo('Opening Pathfinder panel...', { context: 'panel' });
      const helpButtonSelector = 'button[aria-label="Help"]';
      logSelectorLookup(helpButtonSelector, 'panel');
      const helpButton = page.locator(helpButtonSelector);
      await helpButton.waitFor({ state: 'visible', timeout: 10000 });
      logSelectorFound(helpButtonSelector, 1, 'panel');
      logInteraction('Clicking', helpButtonSelector, 'panel');
      await helpButton.click();

      const panelContainerSelector = '[data-pathfinder-content="true"]';
      logSelectorLookup(panelContainerSelector, 'panel');
      const panelContainer = page.locator(panelContainerSelector);
      await panelContainer.waitFor({ state: 'visible', timeout: 10000 });
      logSelectorFound(panelContainerSelector, 1, 'panel');
      logInfo('Pathfinder panel opened', { context: 'panel' });

      // Load guide via auto-launch event
      logInfo(`Loading bundled guide: ${config.guideUrl}...`, { context: 'guide-loading' });
      
      // Capture screenshot before guide load attempt
      try {
        const beforeScreenshot = join(screenshotDir, 'before-guide-load.png');
        await page.screenshot({ path: beforeScreenshot, fullPage: true });
        logDebug(`Screenshot saved: ${beforeScreenshot}`, { context: 'guide-loading' });
      } catch (err) {
        logDebug('Failed to capture before screenshot', { context: 'guide-loading' });
      }

      await page.evaluate(
        ({ url, title }) => {
          const event = new CustomEvent('auto-launch-tutorial', {
            detail: {
              url,
              title: title || 'Test Guide',
              type: 'learning-journey',
            },
          });
          document.dispatchEvent(event);
        },
        { url: config.guideUrl, title: 'Test Guide' }
      );
      logDebug('Dispatched auto-launch-tutorial event', { context: 'guide-loading' });

      // Wait for guide to load using intelligent wait helpers
      try {
        await waitForGuideContent(page, {
          timeout: config.timeout,
          context: 'guide-loading',
          screenshotDir,
        });
      } catch (error) {
        // Capture diagnostics on failure
        logError('Failed to load guide content', { context: 'guide-loading' });
        
        try {
          const domState = await logDOMState(page, '[data-pathfinder-content="true"]', 'guide-loading');
          const afterScreenshot = join(screenshotDir, 'after-guide-load-failure.png');
          await page.screenshot({ path: afterScreenshot, fullPage: true });
          logError(`Guide load failed. DOM state logged. Screenshot: ${afterScreenshot}`, { context: 'guide-loading' });
          
          // Check if event listener is registered (basic check)
          const hasEventListener = await page.evaluate(() => {
            // We can't directly check if listener exists, but we can check if the panel is mounted
            return !!document.querySelector('[data-pathfinder-content="true"]');
          });
          logDebug(`Panel container exists: ${hasEventListener}`, { context: 'guide-loading' });
          
          // Enhanced error message
          const errorMessage = error instanceof Error ? error.message : String(error);
          throw new Error(`Guide loading failed: ${errorMessage}\nDOM State:\n${domState}`);
        } catch (diagError) {
          // If diagnostics fail, throw original error
          throw error;
        }
      }
    } else {
      // For non-bundled guides, use dev mode workflow
      logInfo(`Loading non-bundled guide via dev mode: ${config.guideUrl}...`, { context: 'guide-loading' });
      
      // Capture screenshot before guide load attempt
      try {
        const beforeScreenshot = join(screenshotDir, 'before-guide-load.png');
        await page.screenshot({ path: beforeScreenshot, fullPage: true });
        logDebug(`Screenshot saved: ${beforeScreenshot}`, { context: 'guide-loading' });
      } catch (err) {
        logDebug('Failed to capture before screenshot', { context: 'guide-loading' });
      }

      // Load guide via dev mode URLTester
      // This will open a new tab and return the new page
      if (!context) {
        throw new Error('Browser context is not available');
      }
      const newPage = await loadGuideViaDevMode(context, page, config.guideUrl, screenshotDir);
      // Set up console error capture for the new page
      setupConsoleErrorCapture(newPage);
      page = newPage;
      logInfo('Guide loaded successfully via dev mode', { context: 'guide-loading' });
    }

    // Parse guide metadata and steps (runs in browser context)
    logInfo('Parsing guide metadata...', { context: 'parsing' });
    const metadata = await parseGuideMetadata(page, config.guideUrl);
    logInfo(`Guide title: ${metadata.title}`, { context: 'parsing' });

    logInfo('Parsing guide steps...', { context: 'parsing' });
    const steps = await parseGuideSteps(page);
    logInfo(`Found ${steps.length} steps in guide`, { context: 'parsing' });

    // Execute each step
    const results: StepResult[] = [];
    for (const step of steps) {
      logInfo(`\nExecuting step ${step.index + 1}/${steps.length}: ${step.type} - ${step.reftarget.substring(0, 50)}...`, {
        context: 'step-execution',
      });

      try {
        const result = await executeStep(page, step, {
          timeout: config.timeout,
          screenshotDir,
        });

        // Add console errors to result if failed
        if (result.status === 'failed' && result.error && consoleErrors.length > 0) {
          result.error.consoleErrors = [...consoleErrors];
          consoleErrors.length = 0; // Clear after capturing
        }

        results.push(result);

        if (result.status === 'passed') {
          logInfo(`Step ${step.index + 1} passed (${result.totalDuration}ms)`, {
            context: 'step-execution',
          });
        } else {
          logError(`Step ${step.index + 1} failed: ${result.error?.message}`, {
            context: 'step-execution',
          });
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logError(`Step ${step.index + 1} error: ${errorMessage}`, { context: 'step-execution' });

        // Capture page state for error
        let pageState: string | undefined;
        let domSnapshot: string | undefined;
        try {
          pageState = await page.evaluate(() => ({
            url: window.location.href,
            title: document.title,
          })).then((state) => JSON.stringify(state, null, 2));
          domSnapshot = await logDOMState(page, '[data-pathfinder-content="true"]', 'step-execution');
        } catch {
          // Ignore errors capturing state
        }

        results.push({
          index: step.index,
          type: step.type,
          reftarget: step.reftarget,
          status: 'failed',
          error: {
            type: 'unknown',
            message: errorMessage,
            stepHtml: step.stepHtml,
            consoleErrors: consoleErrors.length > 0 ? [...consoleErrors] : undefined,
            pageState,
            domSnapshot,
          },
          showMeDuration: 0,
          doItDuration: 0,
          totalDuration: 0,
        });
      }

      // Small delay between steps
      logDebug('Waiting 500ms before next step', { context: 'step-execution' });
      await page.waitForTimeout(500);
    }

    // Generate report
    const report = createTestReport(
      {
        id: metadata.id,
        url: config.guideUrl,
        title: metadata.title,
      },
      results,
      config.grafanaUrl,
      startTime
    );

    // Save report
    const reportPath = await generateReport(report, config.outputDir);
    logInfo(`\nReport saved to: ${reportPath}`, { context: 'reporting' });

    // Print summary
    printReportSummary(report);

    return report;
  } catch (error) {
    logError('Test execution failed', { context: 'test-runner' });
    console.error('Test execution failed:', error);
    throw error;
  } finally {
    if (page) {
      await page.close();
    }
    if (browser) {
      await browser.close();
    }
  }
}

