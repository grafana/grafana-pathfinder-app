/**
 * Stack setup utilities for remote Grafana instances
 * 
 * Handles authentication via cookies and dev mode configuration
 * for remote stacks (Grafana Cloud, Play, etc.)
 */

import { BrowserContext, Page } from '@playwright/test';
import { TestConfig } from './types';
import { logInfo, logError, logDebug } from './logger';
import { join } from 'path';

/**
 * Prepare a remote stack for guide testing
 * 
 * This function:
 * 1. Sets authentication cookies on the browser context
 * 2. Navigates to the plugin configuration page with ?dev=true
 * 3. Enables dev mode if not already enabled
 * 4. Verifies dev mode is active
 * 
 * @param context - Playwright browser context
 * @param page - Playwright page
 * @param config - Test configuration
 * @param screenshotDir - Directory for saving screenshots
 */
export async function prepareStackForGuide(
  context: BrowserContext,
  page: Page,
  config: TestConfig,
  screenshotDir: string
): Promise<void> {
  // No-op for local stacks
  if (config.stackMode === 'local') {
    logInfo('Skipping stack setup for local stack', { context: 'stack-setup' });
    return;
  }

  if (!config.grafanaSession || !config.grafanaSessionExpiry) {
    throw new Error(
      'Remote stack requires both --grafana-session and --grafana-session-expiry cookies'
    );
  }

  logInfo('Preparing remote stack for guide testing...', { context: 'stack-setup' });

  try {
    // Step 1: Set authentication cookies
    await setAuthCookies(context, config);

    // Step 2: Navigate to Grafana home to establish session
    logInfo(`Navigating to ${config.grafanaUrl}...`, { context: 'stack-setup' });
    await page.goto(config.grafanaUrl);
    await page.waitForLoadState('networkidle');

    // Verify we're authenticated (not redirected to login)
    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/sign-in')) {
      throw new Error(
        'Authentication failed - redirected to login page. Check that session cookies are valid and not expired.'
      );
    }
    logInfo('Authentication successful', { context: 'stack-setup' });

    // Step 3: Navigate to plugin config page with ?dev=true
    const configUrl = new URL('/a/grafana-pathfinder-app', config.grafanaUrl);
    configUrl.searchParams.set('tab', 'configuration');
    configUrl.searchParams.set('dev', 'true');

    logInfo(`Navigating to plugin configuration: ${configUrl.toString()}`, { context: 'stack-setup' });
    await page.goto(configUrl.toString());
    await page.waitForLoadState('networkidle');

    // Wait for config page to load
    const configPageLoaded = await page.waitForSelector('form', { timeout: 10000 }).catch(() => null);
    if (!configPageLoaded) {
      const screenshotPath = join(screenshotDir, 'config-page-load-failure.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      throw new Error(
        `Failed to load plugin configuration page. Screenshot saved to: ${screenshotPath}`
      );
    }

    // Step 4: Check if dev mode checkbox is visible
    const devModeCheckbox = page.locator('#dev-mode');
    const isCheckboxVisible = await devModeCheckbox.isVisible().catch(() => false);

    if (!isCheckboxVisible) {
      logDebug('Dev mode checkbox not visible - may need ?dev=true in URL or dev mode already enabled', {
        context: 'stack-setup',
      });
      // Check if dev mode is already enabled by checking the page state
      const devModeEnabled = await page.evaluate(() => {
        // Check if dev mode is enabled by looking at plugin config
        // This is a best-effort check since we can't easily access Grafana's plugin config API
        return (window as any).__pathfinderPluginConfig?.devMode === true;
      });

      if (devModeEnabled) {
        logInfo('Dev mode appears to be already enabled', { context: 'stack-setup' });
        return;
      }

      // Try navigating with ?dev=true explicitly
      const urlWithDev = new URL(page.url());
      urlWithDev.searchParams.set('dev', 'true');
      await page.goto(urlWithDev.toString());
      await page.waitForLoadState('networkidle');

      const retryCheckbox = page.locator('#dev-mode');
      const retryVisible = await retryCheckbox.isVisible().catch(() => false);
      if (!retryVisible) {
        const screenshotPath = join(screenshotDir, 'dev-mode-checkbox-not-found.png');
        await page.screenshot({ path: screenshotPath, fullPage: true });
        logError(
          `Dev mode checkbox not found. Ensure you have admin permissions and the plugin is installed. Screenshot: ${screenshotPath}`,
          { context: 'stack-setup' }
        );
        // Don't throw - allow test to continue, but warn
        return;
      }
    }

    // Step 5: Check if dev mode is already enabled
    const isChecked = await devModeCheckbox.isChecked();
    if (isChecked) {
      logInfo('Dev mode is already enabled', { context: 'stack-setup' });
      return;
    }

    // Step 6: Enable dev mode by clicking the checkbox
    logInfo('Enabling dev mode...', { context: 'stack-setup' });
    await devModeCheckbox.click();

    // Wait for the "Saving..." indicator
    const savingIndicator = page.locator('text=Saving to server and reloading...');
    await savingIndicator.waitFor({ timeout: 5000 }).catch(() => {
      logDebug('Saving indicator not found, waiting for page reload', { context: 'stack-setup' });
    });

    // Step 7: Wait for page reload after dev mode toggle
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000); // Extra wait for any async operations

    // Step 8: Verify dev mode is enabled
    const finalCheckbox = page.locator('#dev-mode');
    const finalChecked = await finalCheckbox.isChecked().catch(() => false);

    if (!finalChecked) {
      const screenshotPath = join(screenshotDir, 'dev-mode-enable-failure.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      logError(
        `Failed to enable dev mode. Checkbox is not checked after toggle. Screenshot: ${screenshotPath}`,
        { context: 'stack-setup' }
      );
      // Don't throw - allow test to continue, but warn
      return;
    }

    logInfo('Dev mode successfully enabled', { context: 'stack-setup' });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(`Stack setup failed: ${errorMessage}`, { context: 'stack-setup' });

    // Capture screenshot for debugging
    try {
      const screenshotPath = join(screenshotDir, 'stack-setup-error.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      logError(`Screenshot saved to: ${screenshotPath}`, { context: 'stack-setup' });
    } catch (screenshotError) {
      // Ignore screenshot errors
    }

    throw error;
  }
}

/**
 * Set authentication cookies on the browser context
 * 
 * @param context - Playwright browser context
 * @param config - Test configuration with cookie values
 */
async function setAuthCookies(context: BrowserContext, config: TestConfig): Promise<void> {
  if (!config.grafanaSession || !config.grafanaSessionExpiry) {
    throw new Error('Missing required authentication cookies');
  }

  const grafanaUrl = new URL(config.grafanaUrl);
  const domain = grafanaUrl.hostname;

  logInfo(`Setting authentication cookies for domain: ${domain}`, { context: 'stack-setup' });

  // Parse expiry date
  const expiryDate = new Date(config.grafanaSessionExpiry);
  const expiryTimestamp = Math.floor(expiryDate.getTime() / 1000);

  // Set grafana_session cookie
  await context.addCookies([
    {
      name: 'grafana_session',
      value: config.grafanaSession,
      domain: domain,
      path: '/',
      expires: expiryTimestamp,
      httpOnly: true,
      secure: grafanaUrl.protocol === 'https:',
      sameSite: 'Lax',
    },
    {
      name: 'grafana_session_expiry',
      value: config.grafanaSessionExpiry,
      domain: domain,
      path: '/',
      expires: expiryTimestamp,
      httpOnly: false,
      secure: grafanaUrl.protocol === 'https:',
      sameSite: 'Lax',
    },
  ]);

  logInfo('Authentication cookies set successfully', { context: 'stack-setup' });
}

