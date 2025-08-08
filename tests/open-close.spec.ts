import { test, expect } from './fixtures';

test('should open and close docs panel', async ({ page }) => {
  // Navigate to Grafana home page
  await page.goto('/');
  
  // Wait for the page to load
  await page.waitForLoadState('networkidle');
  
  // Find the docs panel button using aria-label (should be closed initially)
  const openButton = page.locator('[aria-label*="Grafana Pathfinder"]:not([aria-label*="Close"])');
  
  // Click to open the docs panel  
  await openButton.click();
  
  // Wait for panel to open and verify it's open by checking for the close button
  const closeButton = page.locator('[aria-label="Close Grafana Pathfinder"]');
  await expect(closeButton).toBeVisible();
  
  // Click to close the docs panel
  await closeButton.click();
  
  // Verify it's closed (the close button should no longer be visible)
  await expect(closeButton).not.toBeVisible();
});
