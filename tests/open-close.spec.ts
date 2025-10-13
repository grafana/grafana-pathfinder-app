import { test, expect } from './fixtures';

test('should open and close docs panel', async ({ page }) => {
  // Navigate to Grafana home page
  await page.goto('/');

  // Wait for the page to load
  await page.waitForLoadState('networkidle');

  // Find the Help button that opens the docs panel
  const helpButton = page.locator('button[aria-label="Help"]');

  // Click to open the docs panel
  await helpButton.click();

  // Wait for panel to open and verify it's open by checking for the main heading
  const recommendedDocsHeading = page.getByRole('heading', { name: 'Recommended Documentation' });
  await expect(recommendedDocsHeading).toBeVisible();

  // Verify the main panel container is visible
  const panelContainer = page.locator('[data-pathfinder-content="true"]');
  await expect(panelContainer).toBeVisible();

  // Click the Help button again to close the panel (toggle behavior)
  await helpButton.click();

  // Verify it's closed (the panel container should no longer be visible)
  await expect(panelContainer).not.toBeVisible();
});
