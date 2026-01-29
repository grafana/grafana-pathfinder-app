/**
 * Block Editor E2E Test Helpers
 *
 * Reusable helper functions for block editor tests.
 * These helpers encapsulate common patterns to improve test maintainability.
 */

import type { Page } from '@playwright/test';
import { expect } from '../fixtures';
import { testIds } from '../../src/components/testIds';
import { TIMEOUTS, STORAGE_KEYS } from '../constants';

/**
 * Wait for Grafana UI to be ready by checking for the navbar Help button.
 * Uses element visibility as the primary signal with networkidle as secondary
 * to ensure extension sidebar component is fully registered.
 */
export async function waitForGrafanaReady(page: Page): Promise<void> {
  // Primary signal: Help button visible means UI is interactive
  await page.locator('button[aria-label="Help"]').waitFor({
    state: 'visible',
    timeout: TIMEOUTS.UI_READY,
  });
  // Secondary: networkidle ensures extension sidebar is fully registered
  // This is important because domcontentloaded fires before JS fully loads
  await page.waitForLoadState('networkidle');
}

/**
 * Open the block editor via the dev tools tab.
 * Assumes dev mode is enabled.
 */
export async function openBlockEditor(page: Page): Promise<void> {
  // Wait for Grafana UI to be ready
  await waitForGrafanaReady(page);

  // Open the docs panel via Help button
  // In Grafana with extension sidebar registered, clicking Help toggles the sidebar
  await page.locator('button[aria-label="Help"]').click();

  // Dismiss any tooltip that appeared on the Help button
  // This prevents tooltip from intercepting pointer events in Grafana dev/preview versions
  await page.keyboard.press('Escape');

  // Wait for panel container to be visible
  const panelContainer = page.getByTestId(testIds.docsPanel.container);
  await expect(panelContainer).toBeVisible();

  // Wait for devtools tab to be visible (requires dev mode enabled)
  // Use longer timeout as dev mode settings need to propagate
  const devToolsTab = page.getByTestId(testIds.docsPanel.tab('devtools'));
  await expect(devToolsTab).toBeVisible({ timeout: TIMEOUTS.DEV_MODE_PROPAGATE });

  // Hover before click to dismiss any tooltips that may intercept pointer events
  await devToolsTab.hover();
  await devToolsTab.click();

  // Wait for block editor to be visible
  const blockEditor = page.getByTestId('block-editor');
  await expect(blockEditor).toBeVisible();
}

/**
 * Create a markdown block with the given content.
 */
export async function createMarkdownBlock(page: Page, content: string): Promise<void> {
  // Click the Add Block button in the palette (there may be multiple add buttons when blocks exist)
  await page.getByTestId('block-palette').getByTestId(testIds.blockEditor.addBlockButton).click();

  // Wait for modal and select Markdown
  const modal = page.getByTestId(testIds.blockEditor.addBlockModal);
  await expect(modal).toBeVisible();
  await page.getByTestId(testIds.blockEditor.blockTypeButton('markdown')).click();

  // Wait for form modal and fill in content
  const formModal = page.getByTestId(testIds.blockEditor.blockFormModal);
  await expect(formModal).toBeVisible();

  // Switch to Raw Markdown mode for easier text input
  await page.getByTestId(testIds.blockEditor.rawMarkdownTab).click();
  await page.getByTestId(testIds.blockEditor.markdownTextarea).fill(content);

  // Submit the form
  await page.getByTestId(testIds.blockEditor.submitButton).click();
  await expect(formModal).not.toBeVisible();
}

/**
 * Create a section block with the given title.
 * Optionally starts recording mode.
 */
export async function createSectionBlock(
  page: Page,
  title: string,
  options?: { startRecording?: boolean }
): Promise<void> {
  // Click the Add Block button in the palette (there may be multiple add buttons when blocks exist)
  await page.getByTestId('block-palette').getByTestId(testIds.blockEditor.addBlockButton).click();

  // Wait for modal and select Section
  const modal = page.getByTestId(testIds.blockEditor.addBlockModal);
  await expect(modal).toBeVisible();
  await page.getByTestId(testIds.blockEditor.blockTypeButton('section')).click();

  // Wait for form modal and fill in title
  const formModal = page.getByTestId(testIds.blockEditor.blockFormModal);
  await expect(formModal).toBeVisible();
  await page.getByTestId(testIds.blockEditor.sectionTitleInput).fill(title);

  // Submit the form (with or without recording)
  if (options?.startRecording) {
    await page.getByTestId(testIds.blockEditor.addAndRecordButton).click();
  } else {
    await page.getByTestId(testIds.blockEditor.submitButton).click();
  }

  if (!options?.startRecording) {
    await expect(formModal).not.toBeVisible();
  }
}

/**
 * Copy the guide JSON to clipboard and return the parsed object.
 * Falls back to localStorage if clipboard API fails (CI reliability).
 */
export async function copyGuideJson(page: Page): Promise<Record<string, unknown>> {
  await page.getByTestId('copy-json-button').click();

  try {
    const text = await page.evaluate(() => navigator.clipboard.readText());
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Fallback: read from localStorage if clipboard fails
    const state = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEYS.BLOCK_EDITOR_STATE);
    if (!state) {
      throw new Error('No guide state in clipboard or localStorage');
    }
    const parsed = JSON.parse(state);
    return parsed.guide as Record<string, unknown>;
  }
}

/**
 * Wait for auto-save to complete by polling localStorage.
 * More reliable than waitForTimeout.
 */
export async function waitForAutoSave(page: Page, expectedContent: string): Promise<void> {
  await expect(async () => {
    const state = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEYS.BLOCK_EDITOR_STATE);
    expect(state).toContain(expectedContent);
  }).toPass({ timeout: TIMEOUTS.AUTO_SAVE });
}

/**
 * Clear the block editor localStorage state.
 * Call this in beforeEach to ensure test isolation.
 * Waits for the page to be ready before attempting to clear localStorage.
 */
export async function clearBlockEditorState(page: Page): Promise<void> {
  // Wait for the page to be loaded enough to have localStorage available
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => {
    localStorage.removeItem('pathfinder-block-editor-state');
  });
}

/**
 * Wait for the recording overlay to appear.
 */
export async function waitForRecordingOverlay(page: Page): Promise<void> {
  const recordingOverlay = page.locator('[data-record-overlay="banner"]');
  await expect(recordingOverlay).toBeVisible();
}

/**
 * Stop recording via the overlay stop button.
 */
export async function stopRecording(page: Page): Promise<void> {
  const recordingOverlay = page.locator('[data-record-overlay="banner"]');
  const stopButton = recordingOverlay.locator('button').filter({ hasText: 'Stop' });
  await stopButton.click();
  await expect(recordingOverlay).not.toBeVisible();
}

/**
 * Click a block action button (edit, delete, etc.) ensuring proper visibility.
 * Handles dnd-kit overlay issues by scrolling into view and hovering first.
 *
 * @param page - Playwright page
 * @param testId - The data-testid of the button to click
 * @param options - Optional index if there are multiple buttons with same testId
 */
export async function clickBlockAction(page: Page, testId: string, options?: { index?: number }): Promise<void> {
  const button = page.getByTestId(testId).nth(options?.index ?? 0);
  await button.scrollIntoViewIfNeeded();
  await button.hover();
  await button.click();
}

/**
 * Confirm a block deletion in the confirmation modal.
 * Locates the modal by role and title text since Grafana's ConfirmModal
 * doesn't support custom testIds.
 */
export async function confirmDeleteBlock(page: Page): Promise<void> {
  const confirmModal = page.locator('[role="dialog"]').filter({ hasText: 'Delete Block' });
  await expect(confirmModal).toBeVisible({ timeout: TIMEOUTS.MODAL_VISIBLE });
  await confirmModal.locator('button').filter({ hasText: 'Yes, Delete' }).click();
  await expect(confirmModal).not.toBeVisible();
}

/**
 * Click the add block button within a section's empty state area.
 * Uses the section empty state testId to scope the search.
 */
export async function clickAddBlockInSection(page: Page): Promise<void> {
  const blockEditor = page.getByTestId('block-editor');
  // Find the section container via the empty state testId
  const sectionEmptyState = blockEditor.getByTestId(testIds.blockEditor.sectionEmptyState);
  // The Add Block button is a sibling of the empty state div inside the same parent
  // Use xpath to go up one level and find the button within that container
  const parentContainer = sectionEmptyState.locator('xpath=..');
  const addBlockButton = parentContainer.getByTestId(testIds.blockEditor.addBlockButton);
  await addBlockButton.click();
}
