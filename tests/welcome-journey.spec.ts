import { test, expect } from './fixtures';
import { testIds } from '../src/constants/testIds';

/**
 * Helper function to handle "Fix this" buttons that may appear multiple times
 * for a step. Keeps clicking until no more fix buttons are present.
 */
async function handleFixMeButtons(page: any, stepId: string) {
  const fixButton = page.getByTestId(testIds.interactive.requirementFixButton(stepId));
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
  const allSteps = page.locator('[data-testid^="interactive-step-"]');
  const totalStepCount = await allSteps.count();

  if (stepIndex >= totalStepCount) {
    throw new Error(`Step ${stepIndex} not found. Only ${totalStepCount} steps available.`);
  }

  // Get the step by absolute index
  const stepHandle = allSteps.nth(stepIndex);

  // Check if step is already completed
  const stepClasses = await stepHandle.getAttribute('class');
  if (stepClasses && stepClasses.includes('completed')) {
    console.log(`Step ${stepIndex} is already completed, skipping`);
    return;
  }

  // Wait for step to be visible
  await expect(stepHandle).toBeVisible({ timeout: 10000 });

  // Determine the concrete step id (for stable test selectors)
  const dataStepId = await stepHandle.getAttribute('data-step-id');
  const dataTestId = await stepHandle.getAttribute('data-testid');
  const derivedStepId =
    dataStepId ??
    (dataTestId && dataTestId.startsWith('interactive-step-') ? dataTestId.replace('interactive-step-', '') : null) ??
    `step-${stepIndex}`;

  const step = page.getByTestId(testIds.interactive.step(derivedStepId));
  await expect(step).toBeVisible({ timeout: 10000 });

  // Step 1: Handle any "Fix this" buttons that may appear
  // Check for fix buttons before attempting show me/do it
  // Fix buttons can appear multiple times, so we need to keep checking
  await handleFixMeButtons(page, derivedStepId);

  // After handling fix buttons, check again in case new ones appeared
  // This handles the case where clicking fix might reveal another requirement issue
  await page.waitForTimeout(500);
  await handleFixMeButtons(page, derivedStepId);

  // Step 2: Click "Show me" button if it exists and is enabled
  const showMeButton = page.getByTestId(testIds.interactive.showMeButton(derivedStepId));
  const showMeButtonCount = await showMeButton.count();

  if (showMeButtonCount > 0) {
    // Wait for button to be enabled (not disabled, not checking)
    await expect(showMeButton.first()).toBeEnabled({ timeout: 5000 });
    await showMeButton.first().click();

    // Wait for show me action to complete (button text changes or action completes)
    await page.waitForTimeout(1500);

    // Check if fix buttons appeared after show me (some steps might need nav menu open)
    await handleFixMeButtons(page, derivedStepId);
  }

  // Step 3: Click "Do it" button
  const doItButton = page.getByTestId(testIds.interactive.doItButton(derivedStepId));
  const doItButtonCount = await doItButton.count();

  if (doItButtonCount > 0) {
    // Wait for button to be enabled (not disabled, not executing, not checking)
    await expect(doItButton.first()).toBeEnabled({ timeout: 5000 });

    // One more check for fix buttons before clicking do it
    await handleFixMeButtons(page, derivedStepId);

    await doItButton.first().click();

    // Wait for step to complete (check for completed class or checkmark)
    // The step should get the .completed class or show a completion indicator
    await expect(page.getByTestId(testIds.interactive.stepCompleted(derivedStepId)))
      .toBeVisible({ timeout: 15000 })
      .catch(async () => {
        // If completion indicator doesn't appear immediately, wait a bit more and check class fallback
        await page.waitForTimeout(2000);
        const refreshedClasses = await step.getAttribute('class');
        if (!refreshedClasses || !refreshedClasses.includes('completed')) {
          throw new Error(`Step ${stepIndex} did not complete after clicking "Do it"`);
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

  // Expand suggested guides section if collapsed
  const suggestedGuidesToggle = page.getByTestId(testIds.contextPanel.suggestedGuidesToggle);
  if ((await suggestedGuidesToggle.count()) > 0) {
    const isExpanded = await suggestedGuidesToggle.getAttribute('aria-expanded');
    if (isExpanded !== 'true') {
      await suggestedGuidesToggle.click();
      await page.waitForTimeout(300);
    }
  }

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
  const firstStep = page.locator('[data-testid^="interactive-step-"]').first();
  await expect(firstStep).toBeVisible({ timeout: 10000 });

  // Complete the first step
  await completeStep(page, 0);

  // Wait a bit for the first step to fully complete and next step to become available
  await page.waitForTimeout(1500);

  // Complete the second step
  await completeStep(page, 1);

  // Wait for second step completion to fully register
  await page.waitForTimeout(1500);

  // Verify both steps are completed using multiple methods for robustness
  // Method 1: Check via data-testid and class
  const completedSteps = page.locator('[data-testid^="interactive-step-"]').filter({ hasText: /✓|completed/i });
  const completedCount = await completedSteps.count();

  // Method 2: Check specific steps by their completion indicators
  const allSteps = page.locator('[data-testid^="interactive-step-"]');
  const totalSteps = await allSteps.count();

  let actualCompletedCount = 0;
  for (let i = 0; i < Math.min(totalSteps, 2); i++) {
    const stepHandle = allSteps.nth(i);
    const stepClasses = await stepHandle.getAttribute('class');
    if (stepClasses && stepClasses.includes('completed')) {
      actualCompletedCount++;
    }
  }

  // Assert at least one method shows 2 completions
  if (completedCount < 2 && actualCompletedCount < 2) {
    // Debug output
    console.log(`Completed steps found via selector: ${completedCount}`);
    console.log(`Completed steps found via class check: ${actualCompletedCount}`);

    // Check each of the first 2 steps individually
    for (let i = 0; i < 2; i++) {
      const stepHandle = allSteps.nth(i);
      const classes = await stepHandle.getAttribute('class');
      const testId = await stepHandle.getAttribute('data-testid');
      console.log(`Step ${i}: classes="${classes}", testId="${testId}"`);
    }

    throw new Error(`Expected at least 2 completed steps, found ${Math.max(completedCount, actualCompletedCount)}`);
  }

  expect(Math.max(completedCount, actualCompletedCount)).toBeGreaterThanOrEqual(2);
});
