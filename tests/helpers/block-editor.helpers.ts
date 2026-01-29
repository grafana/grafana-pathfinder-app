/**
 * Block Editor E2E Test Helpers
 *
 * Reusable helper functions for block editor tests.
 * These helpers encapsulate common patterns to improve test maintainability.
 */

import type { Page } from '@playwright/test';
import { expect } from '../fixtures';
import { testIds } from '../../src/components/testIds';

/**
 * Wait for Grafana UI to be ready by checking for network idle and Help button.
 * Uses both checks for maximum reliability.
 */
export async function waitForGrafanaReady(page: Page): Promise<void> {
  // Wait for network to settle first
  await page.waitForLoadState('networkidle');
  // Then verify the Help button is visible (confirms UI is interactive)
  await page.locator('button[aria-label="Help"]').waitFor({ state: 'visible', timeout: 30000 });
}

/**
 * Open the block editor via the dev tools tab.
 * Assumes dev mode is enabled.
 */
export async function openBlockEditor(page: Page): Promise<void> {
  // Wait for Grafana UI to be ready
  await waitForGrafanaReady(page);

  // Open the docs panel via Help button
  await page.locator('button[aria-label="Help"]').click();

  // Wait for panel container to be visible
  const panelContainer = page.getByTestId(testIds.docsPanel.container);
  await expect(panelContainer).toBeVisible();

  // Wait for devtools tab to be visible (requires dev mode enabled)
  // Use longer timeout as dev mode settings need to propagate
  const devToolsTab = page.getByTestId(testIds.docsPanel.tab('devtools'));
  await expect(devToolsTab).toBeVisible({ timeout: 15000 });
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
 */
export async function copyGuideJson(page: Page): Promise<Record<string, unknown>> {
  await page.getByTestId('copy-json-button').click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  return JSON.parse(text) as Record<string, unknown>;
}

/**
 * Wait for auto-save to complete by polling localStorage.
 * More reliable than waitForTimeout.
 */
export async function waitForAutoSave(page: Page, expectedContent: string): Promise<void> {
  await expect(async () => {
    const state = await page.evaluate(() => localStorage.getItem('pathfinder-block-editor-state'));
    expect(state).toContain(expectedContent);
  }).toPass({ timeout: 5000 });
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
