import { test, expect } from './fixtures';
import { testIds } from '../src/components/testIds';

/**
 * Helper function to handle "Fix this" buttons that may appear multiple times
 * for a step. Keeps clicking until no more fix buttons are present.
 */
async function handleFixMeButtons(page: any, stepLocator: any) {
  let fixButton = stepLocator.locator('button.interactive-requirement-retry-btn').filter({ hasText: 'Fix this' });
  let fixCount = 0;
  const maxFixes = 10; // Prevent infinite loops

  while ((await fixButton.count()) > 0 && fixCount < maxFixes) {
    await expect(fixButton.first())
      .toBeVisible({ timeout: 2000 })
      .catch(() => {
        // If button disappears, exit loop
        return;
      });

    if ((await fixButton.count()) > 0) {
      await fixButton.first().click();
      fixCount++;

      // Wait a bit for the fix to process
      await page.waitForTimeout(500);

      // Re-query the button to check if it still exists
      fixButton = stepLocator.locator('button.interactive-requirement-retry-btn').filter({ hasText: 'Fix this' });
    }
  }

  if (fixCount >= maxFixes) {
    console.warn(`Warning: Hit max fix attempts (${maxFixes}) for step`);
  }
}

/**
 * Helper function to complete a single step by handling fix-me, then show-me, then do-it
 * @param page - Playwright page object
 * @param stepIndex - Zero-based index of the step to complete (0 = first step, 1 = second step, etc.)
 */
async function completeStep(page: any, stepIndex: number) {
  // Find all steps (including completed ones) to get proper indexing
  const allSteps = page.locator('.interactive-step');
  const totalStepCount = await allSteps.count();

  if (stepIndex >= totalStepCount) {
    throw new Error(`Step ${stepIndex} not found. Only ${totalStepCount} steps available.`);
  }

  // Get the step by absolute index
  const step = allSteps.nth(stepIndex);

  // Check if step is already completed
  const stepClasses = await step.getAttribute('class');
  if (stepClasses && stepClasses.includes('completed')) {
    console.log(`Step ${stepIndex} is already completed, skipping`);
    return;
  }

  // Wait for step to be visible
  await expect(step).toBeVisible({ timeout: 10000 });

  // Step 1: Handle any "Fix this" buttons that may appear
  // Check for fix buttons before attempting show me/do it
  // Fix buttons can appear multiple times, so we need to keep checking
  await handleFixMeButtons(page, step);

  // After handling fix buttons, check again in case new ones appeared
  // This handles the case where clicking fix might reveal another requirement issue
  await page.waitForTimeout(500);
  await handleFixMeButtons(page, step);

  // Step 2: Click "Show me" button if it exists and is enabled
  const showMeButton = step.locator('button.interactive-step-show-btn').filter({ hasText: /Show me/ });
  const showMeButtonCount = await showMeButton.count();

  if (showMeButtonCount > 0) {
    // Wait for button to be enabled (not disabled, not checking)
    await expect(showMeButton.first()).toBeEnabled({ timeout: 5000 });
    await showMeButton.first().click();

    // Wait for show me action to complete (button text changes or action completes)
    await page.waitForTimeout(1500);

    // Check if fix buttons appeared after show me (some steps might need nav menu open)
    await handleFixMeButtons(page, step);
  }

  // Step 3: Click "Do it" button
  const doItButton = step.locator('button.interactive-step-do-btn').filter({ hasText: /Do it/ });
  const doItButtonCount = await doItButton.count();

  if (doItButtonCount > 0) {
    // Wait for button to be enabled (not disabled, not executing, not checking)
    await expect(doItButton.first()).toBeEnabled({ timeout: 5000 });

    // One more check for fix buttons before clicking do it
    await handleFixMeButtons(page, step);

    await doItButton.first().click();

    // Wait for step to complete (check for completed class or checkmark)
    // The step should get the .completed class or show a completion indicator
    await expect(step.locator('.interactive-step-completed-indicator, .completed'))
      .toBeVisible({ timeout: 15000 })
      .catch(async () => {
        // If completion indicator doesn't appear immediately, wait a bit more
        await page.waitForTimeout(2000);
        // Check again
        const completed = step.locator('.interactive-step-completed-indicator, .completed');
        const completedCount = await completed.count();
        if (completedCount === 0) {
          // Check if step is marked as completed via class
          const stepClasses = await step.getAttribute('class');
          if (!stepClasses || !stepClasses.includes('completed')) {
            throw new Error(`Step ${stepIndex} did not complete after clicking "Do it"`);
          }
        }
      });
  } else {
    throw new Error(`"Do it" button not found for step ${stepIndex}`);
  }

  // Wait a bit for step completion to register
  await page.waitForTimeout(500);
}

test('should complete first two steps of Welcome to Grafana journey', async ({ page }) => {
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

  // Wait for recommendations to load
  const recommendationsContainer = page.getByTestId(testIds.contextPanel.recommendationsContainer);
  await expect(recommendationsContainer).toBeVisible({ timeout: 10000 });

  // Find the recommendations grid
  const recommendationsGrid = page.getByTestId(testIds.contextPanel.recommendationsGrid);
  await expect(recommendationsGrid).toBeVisible();

  // Find the "Welcome to Grafana" card by searching through recommendation cards
  // We'll check cards by index (0-3 for primary recommendations) until we find the right one
  let welcomeCardIndex = -1;
  let foundInOtherDocs = false;

  // Check each recommendation card (up to 4 primary recommendations)
  for (let i = 0; i < 4; i++) {
    const card = page.getByTestId(testIds.contextPanel.recommendationCard(i));
    const cardCount = await card.count();

    if (cardCount > 0) {
      const cardTitle = card.getByTestId(testIds.contextPanel.recommendationTitle(i));
      const titleText = await cardTitle.textContent();

      if (titleText && titleText.includes('Welcome to Grafana')) {
        welcomeCardIndex = i;
        // Find and click the start button for this card
        const startButton = card.getByTestId(testIds.contextPanel.recommendationStartButton(i));
        await expect(startButton).toBeVisible({ timeout: 5000 });
        await startButton.click();
        break;
      }
    }
  }

  // If not found in primary recommendations, check "Other Documentation" section
  if (welcomeCardIndex === -1) {
    const otherDocsToggle = page.getByTestId(testIds.contextPanel.otherDocsToggle);
    const toggleCount = await otherDocsToggle.count();

    if (toggleCount > 0) {
      // Expand other docs if not already expanded
      const isExpanded = await otherDocsToggle.getAttribute('aria-expanded');
      if (isExpanded !== 'true') {
        await otherDocsToggle.click();
        await page.waitForTimeout(500);
      }

      // Check items in other docs list
      const otherDocsList = page.getByTestId(testIds.contextPanel.otherDocsList);
      const welcomeDocLink = otherDocsList.getByText('Welcome to Grafana');
      const linkCount = await welcomeDocLink.count();

      if (linkCount > 0) {
        await welcomeDocLink.click();
        foundInOtherDocs = true;
      }
    }
  }

  if (welcomeCardIndex === -1 && !foundInOtherDocs) {
    throw new Error('Could not find "Welcome to Grafana" recommendation');
  }

  // Wait for the journey content to load (should see interactive steps)
  // The content should be in a new tab
  await page.waitForTimeout(2000);

  // Verify we're now viewing content (not recommendations)
  // Check for interactive step elements
  const firstStep = page.locator('.interactive-step').first();
  await expect(firstStep).toBeVisible({ timeout: 10000 });

  // Complete the first step
  await completeStep(page, 0);

  // Wait a bit for the first step to fully complete
  await page.waitForTimeout(1000);

  // Complete the second step
  await completeStep(page, 1);

  // Verify both steps are completed
  const completedSteps = page.locator('.interactive-step.completed');
  const completedCount = await completedSteps.count();
  expect(completedCount).toBeGreaterThanOrEqual(2);
});
