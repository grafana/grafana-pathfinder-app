/**
 * Dev mode guide loading utilities
 * 
 * Handles loading non-bundled guides through the dev mode URLTester interface
 */

import { Page, BrowserContext } from '@playwright/test';
import { logInfo, logError, logDebug, logInteraction, logSelectorLookup, logSelectorFound, logWait, logWaitComplete } from './logger';
import { normalizeGuideUrlForTester } from './guide-utils';
import { waitForGuideContent } from './wait-helpers';
import { join } from 'path';

/**
 * Load a guide via dev mode URLTester component
 * 
 * This function:
 * 1. Navigates to Grafana home page
 * 2. Opens Pathfinder panel
 * 3. Finds and expands the "Tutorial Tester" section in SelectorDebugPanel
 * 4. Fills the URLTester input field with the guide URL
 * 5. Clicks "Test Tutorial in New Tab" button
 * 6. Handles the new tab/window and waits for guide to load
 * 
 * @param context - Playwright browser context
 * @param page - Playwright page
 * @param guideUrl - The guide URL to load
 * @param screenshotDir - Directory for saving screenshots
 * @returns The new page where the guide was loaded
 */
export async function loadGuideViaDevMode(
  context: BrowserContext,
  page: Page,
  guideUrl: string,
  screenshotDir: string
): Promise<Page> {
  try {
    // Step 1: Navigate to Grafana home page
    logInfo('Navigating to Grafana home page...', { context: 'dev-mode-loader' });
    const grafanaUrl = new URL(page.url()).origin;
    await page.goto(grafanaUrl);
    await page.waitForLoadState('networkidle');
    logInfo('Navigation complete', { context: 'dev-mode-loader' });

    // Step 2: Open Pathfinder panel
    logInfo('Opening Pathfinder panel...', { context: 'dev-mode-loader' });
    const helpButtonSelector = 'button[aria-label="Help"]';
    logSelectorLookup(helpButtonSelector, 'dev-mode-loader');
    const helpButton = page.locator(helpButtonSelector);
    await helpButton.waitFor({ state: 'visible', timeout: 10000 });
    logSelectorFound(helpButtonSelector, 1, 'dev-mode-loader');
    logInteraction('Clicking', helpButtonSelector, 'dev-mode-loader');
    await helpButton.click();

    const panelContainerSelector = '[data-pathfinder-content="true"]';
    logSelectorLookup(panelContainerSelector, 'dev-mode-loader');
    const panelContainer = page.locator(panelContainerSelector);
    await panelContainer.waitFor({ state: 'visible', timeout: 10000 });
    logSelectorFound(panelContainerSelector, 1, 'dev-mode-loader');
    logInfo('Pathfinder panel opened', { context: 'dev-mode-loader' });

    // Step 3: Wait for SelectorDebugPanel to be visible (dev mode should be enabled)
    logInfo('Waiting for SelectorDebugPanel to be visible...', { context: 'dev-mode-loader' });
    const debugPanelSelector = 'text=Tutorial Tester';
    logSelectorLookup(debugPanelSelector, 'dev-mode-loader');
    
    // Wait for the Tutorial Tester section header to be visible
    const tutorialTesterHeader = page.locator(debugPanelSelector).first();
    await tutorialTesterHeader.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {
      // If not visible, try to find the section by clicking to expand
      logDebug('Tutorial Tester section may be collapsed, looking for section header...', { context: 'dev-mode-loader' });
    });
    logSelectorFound(debugPanelSelector, 1, 'dev-mode-loader');

    // Step 4: Expand the Tutorial Tester section if needed
    // The section header is clickable and expands/collapses the section
    logInfo('Expanding Tutorial Tester section...', { context: 'dev-mode-loader' });
    const sectionHeader = page.locator('h4:has-text("Tutorial Tester")').first();
    
    // Check if section is expanded by looking for the URLTester input field
    const urlInputExists = await page.locator('#urlTesterInput').count().catch(() => 0);
    
    if (urlInputExists === 0) {
      // Section is collapsed, click to expand
      logInteraction('Clicking', 'Tutorial Tester section header', 'dev-mode-loader');
      await sectionHeader.click();
      await page.waitForTimeout(500); // Wait for section to expand
      
      // Wait for input to appear
      await page.locator('#urlTesterInput').waitFor({ state: 'visible', timeout: 5000 });
    }

    // Step 5: Determine which tab to use (GitHub or Other)
    // Normalize the URL to determine the appropriate tab
    const normalizedUrl = normalizeGuideUrlForTester(guideUrl);
    const isGitHubUrl = normalizedUrl.includes('github.com') && normalizedUrl.includes('/tree/');
    
    if (isGitHubUrl) {
      // Switch to GitHub tab if not already active
      logInfo('Switching to GitHub tab...', { context: 'dev-mode-loader' });
      const githubTab = page.locator('button[role="tab"]:has-text("GitHub")').first();
      const isActive = await githubTab.evaluate((el) => el.getAttribute('aria-selected') === 'true').catch(() => false);
      if (!isActive) {
        await githubTab.click();
        await page.waitForTimeout(300);
      }
    } else {
      // Switch to Other tab
      logInfo('Switching to Other tab...', { context: 'dev-mode-loader' });
      const otherTab = page.locator('button[role="tab"]:has-text("Other")').first();
      const isActive = await otherTab.evaluate((el) => el.getAttribute('aria-selected') === 'true').catch(() => false);
      if (!isActive) {
        await otherTab.click();
        await page.waitForTimeout(300);
      }
    }

    // Step 6: Fill the URLTester input field
    logInfo(`Filling URLTester input with: ${normalizedUrl}`, { context: 'dev-mode-loader' });
    const inputSelector = '#urlTesterInput';
    logSelectorLookup(inputSelector, 'dev-mode-loader');
    const urlInput = page.locator(inputSelector);
    await urlInput.waitFor({ state: 'visible', timeout: 10000 });
    logSelectorFound(inputSelector, 1, 'dev-mode-loader');
    
    // Clear and fill the input
    await urlInput.clear();
    await urlInput.fill(normalizedUrl);
    logInfo('URL input filled', { context: 'dev-mode-loader' });

    // Step 7: Set up listener for new page before clicking button
    logInfo('Setting up listener for new page...', { context: 'dev-mode-loader' });
    const newPagePromise = context.waitForEvent('page', { timeout: 30000 });

    // Step 8: Click "Test Tutorial in New Tab" button
    logInfo('Clicking "Test Tutorial in New Tab" button...', { context: 'dev-mode-loader' });
    const submitButtonSelector = 'button:has-text("Test Tutorial in New Tab")';
    logSelectorLookup(submitButtonSelector, 'dev-mode-loader');
    const submitButton = page.locator(submitButtonSelector).first();
    await submitButton.waitFor({ state: 'visible', timeout: 10000 });
    logSelectorFound(submitButtonSelector, 1, 'dev-mode-loader');
    
    // Verify button is not disabled
    const isDisabled = await submitButton.isDisabled();
    if (isDisabled) {
      throw new Error('Submit button is disabled - URL may be invalid or input is empty');
    }

    logInteraction('Clicking', submitButtonSelector, 'dev-mode-loader');
    await submitButton.click();

    // Step 9: Wait for new page/tab to open
    logWait('new page/tab to open', 30000, 'dev-mode-loader');
    const newPage = await newPagePromise;
    logWaitComplete('new page opened', 0, 'dev-mode-loader');
    logInfo('New page opened', { context: 'dev-mode-loader' });

    // Step 10: Wait for guide content to load in new page
    logInfo('Waiting for guide content to load in new page...', { context: 'dev-mode-loader' });
    await newPage.waitForLoadState('networkidle');
    
    // Wait for Pathfinder panel to be visible in new page
    const newPagePanelSelector = '[data-pathfinder-content="true"]';
    logSelectorLookup(newPagePanelSelector, 'dev-mode-loader');
    const newPagePanel = newPage.locator(newPagePanelSelector);
    await newPagePanel.waitFor({ state: 'visible', timeout: 10000 });
    logSelectorFound(newPagePanelSelector, 1, 'dev-mode-loader');

    // Wait for guide content using the existing wait helper
    await waitForGuideContent(newPage, {
      timeout: 30000,
      context: 'dev-mode-loader',
      screenshotDir,
    });

    logInfo('Guide loaded successfully via dev mode', { context: 'dev-mode-loader' });
    return newPage;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(`Failed to load guide via dev mode: ${errorMessage}`, { context: 'dev-mode-loader' });

    // Capture screenshot for debugging
    try {
      const screenshotPath = join(screenshotDir, 'dev-mode-loader-error.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      logError(`Screenshot saved to: ${screenshotPath}`, { context: 'dev-mode-loader' });
    } catch (screenshotError) {
      // Ignore screenshot errors
    }

    throw error;
  }
}

