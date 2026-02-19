import { test, expect } from './fixtures';
import { testIds } from '../src/components/testIds';

test('should open and close docs panel', async ({ page }) => {
  // Navigate to Grafana home page
  await page.goto('/');

  // Wait for the page to load
  await page.waitForLoadState('networkidle');

  // Find the Help button that opens the docs panel (Grafana's extension sidebar trigger)
  // Note: This is part of Grafana's UI, not our plugin, so we use aria-label selector
  const helpButton = page.locator('button[aria-label="Help"]');

  // Click to open the docs panel
  await helpButton.click();

  // Wait for panel to open and verify it's open using stable testId selectors
  const panelContainer = page.getByTestId(testIds.docsPanel.container);
  await expect(panelContainer).toBeVisible();

  // Verify the user profile bar is visible (replaced the old "Recommended learning" heading)
  const userProfileBar = page.getByTestId(testIds.contextPanel.userProfileBar);
  await expect(userProfileBar).toBeVisible();

  // Verify the recommendations container is visible
  const recommendationsContainer = page.getByTestId(testIds.contextPanel.recommendationsContainer);
  await expect(recommendationsContainer).toBeVisible();

  // Click the Help button again to close the panel (toggle behavior)
  await helpButton.click();

  // Verify it's closed (the panel container should no longer be visible)
  await expect(panelContainer).not.toBeVisible();
});

test('should interact with docs panel tabs', async ({ page }) => {
  // Navigate to Grafana home page
  await page.goto('/');

  // Wait for the page to load
  await page.waitForLoadState('networkidle');

  // Open the docs panel
  const helpButton = page.locator('button[aria-label="Help"]');
  await helpButton.click();

  // Verify panel is open
  const panelContainer = page.getByTestId(testIds.docsPanel.container);
  await expect(panelContainer).toBeVisible();

  // Verify recommendations panel content is visible
  const recommendationsPanel = page.getByTestId(testIds.contextPanel.container);
  await expect(recommendationsPanel).toBeVisible();

  // Verify header controls are present (settings moved to dropdown menu)
  const closeButton = page.getByTestId(testIds.docsPanel.closeButton);
  await expect(closeButton).toBeVisible();

  // Verify content area is visible
  const contentArea = page.getByTestId(testIds.docsPanel.content);
  await expect(contentArea).toBeVisible();
});
