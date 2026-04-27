import { test, expect } from './fixtures';
import { testIds } from '../src/constants/testIds';
import {
  openBlockEditor,
  createMarkdownBlock,
  clearBlockEditorState,
  waitForGrafanaReady,
} from './helpers/block-editor.helpers';

// Skipped by default. Run on-demand with `SCREENSHOT_MODE=1` to refresh the
// images that ship with docs/sources/block-editor/_index.md. The PNGs live in
// docs/sources/block-editor/screenshots/ for convenience but are referenced
// from the doc as /media/docs/pathfinder/<name>.png — they are uploaded to the
// Grafana static site by hand, not served from this repo.
test.skip(
  !process.env.SCREENSHOT_MODE,
  'Set SCREENSHOT_MODE=1 to regenerate the block editor documentation screenshots'
);

const SCREENSHOTS = 'docs/sources/block-editor/screenshots';

test.describe.configure({ mode: 'serial' });

test.describe('Block editor user doc screenshots', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearBlockEditorState(page);
  });

  test('grafana help button', async ({ page }) => {
    await page.goto('/');
    await waitForGrafanaReady(page);
    await page.screenshot({ path: `${SCREENSHOTS}/block-editor-help-button.png`, fullPage: false });
  });

  test('editor tab in sidebar', async ({ page }) => {
    await openBlockEditor(page);
    const panel = page.getByTestId(testIds.docsPanel.container);
    await panel.screenshot({ path: `${SCREENSHOTS}/block-editor-tab.png` });
  });

  test('empty editor canvas', async ({ page }) => {
    await openBlockEditor(page);
    const editor = page.getByTestId(testIds.blockEditor.container);
    await editor.screenshot({ path: `${SCREENSHOTS}/block-editor-empty.png` });
  });

  test('block palette open', async ({ page }) => {
    await openBlockEditor(page);
    await page.getByTestId(testIds.blockEditor.palette).getByTestId(testIds.blockEditor.addBlockButton).click();
    const modal = page.getByTestId(testIds.blockEditor.addBlockModal);
    await expect(modal).toBeVisible();
    await modal.scrollIntoViewIfNeeded();
    await modal.screenshot({ path: `${SCREENSHOTS}/block-editor-palette.png` });
  });

  test('markdown block form', async ({ page }) => {
    await openBlockEditor(page);
    await page.getByTestId(testIds.blockEditor.palette).getByTestId(testIds.blockEditor.addBlockButton).click();
    await page.getByTestId(testIds.blockEditor.blockTypeButton('markdown')).click();
    await expect(page.getByTestId(testIds.blockEditor.blockFormModal)).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOTS}/block-editor-markdown-form.png`, fullPage: false });
  });

  test('interactive block form (Show me / Do it)', async ({ page }) => {
    await openBlockEditor(page);
    await page.getByTestId(testIds.blockEditor.palette).getByTestId(testIds.blockEditor.addBlockButton).click();
    await page.getByTestId(testIds.blockEditor.blockTypeButton('interactive')).click();
    await expect(page.getByTestId(testIds.blockEditor.blockFormModal)).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOTS}/block-editor-interactive-form.png`, fullPage: false });
  });

  test('section block form', async ({ page }) => {
    await openBlockEditor(page);
    await page.getByTestId(testIds.blockEditor.palette).getByTestId(testIds.blockEditor.addBlockButton).click();
    await page.getByTestId(testIds.blockEditor.blockTypeButton('section')).click();
    await expect(page.getByTestId(testIds.blockEditor.blockFormModal)).toBeVisible();
    await page.getByTestId(testIds.blockEditor.sectionTitleInput).fill('Set up your data source');
    await page.screenshot({ path: `${SCREENSHOTS}/block-editor-section-form.png`, fullPage: false });
  });

  test('multistep block form', async ({ page }) => {
    await openBlockEditor(page);
    await page.getByTestId(testIds.blockEditor.palette).getByTestId(testIds.blockEditor.addBlockButton).click();
    await page.getByTestId(testIds.blockEditor.blockTypeButton('multistep')).click();
    await expect(page.getByTestId(testIds.blockEditor.blockFormModal)).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOTS}/block-editor-multistep-form.png`, fullPage: false });
  });

  test('editor populated with multiple blocks', async ({ page }) => {
    await openBlockEditor(page);
    await createMarkdownBlock(
      page,
      '# Welcome to Prometheus\n\nIn this guide you will configure a Prometheus data source and run your first query.'
    );
    await createMarkdownBlock(
      page,
      '## Prerequisites\n\n- A running Prometheus instance\n- Editor or admin permissions'
    );
    const panel = page.getByTestId(testIds.docsPanel.container);
    await panel.screenshot({ path: `${SCREENSHOTS}/block-editor-with-blocks.png` });
  });

  test('more actions menu', async ({ page }) => {
    await openBlockEditor(page);
    await createMarkdownBlock(page, '# Welcome');
    await page.getByTestId(testIds.blockEditor.moreActionsButton).click();
    await page.getByRole('menuitem', { name: 'Copy JSON' }).waitFor({ state: 'visible' });
    const panel = page.getByTestId(testIds.docsPanel.container);
    await panel.screenshot({ path: `${SCREENSHOTS}/block-editor-more-actions.png` });
  });

  test('JSON view mode', async ({ page }) => {
    await openBlockEditor(page);
    await createMarkdownBlock(page, '# Welcome');
    const viewModeToggle = page.getByTestId(testIds.blockEditor.viewModeToggle);
    const jsonButton = viewModeToggle.locator('button[aria-label="JSON"]');
    await jsonButton.click();
    const panel = page.getByTestId(testIds.docsPanel.container);
    await panel.screenshot({ path: `${SCREENSHOTS}/block-editor-json-view.png` });
  });

  test('preview view mode', async ({ page }) => {
    await openBlockEditor(page);
    await createMarkdownBlock(
      page,
      '# Welcome to Prometheus\n\nThis guide walks you through setting up a Prometheus data source.\n\n## What you will learn\n\n- How to add a data source\n- How to write a basic PromQL query'
    );
    const viewModeToggle = page.getByTestId(testIds.blockEditor.viewModeToggle);
    const previewButton = viewModeToggle.locator('button[aria-label="Preview"]');
    await previewButton.click();
    const panel = page.getByTestId(testIds.docsPanel.container);
    await panel.screenshot({ path: `${SCREENSHOTS}/block-editor-preview-view.png` });
  });
});
