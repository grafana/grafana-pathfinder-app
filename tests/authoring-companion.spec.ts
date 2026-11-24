import type { Locator } from '@playwright/test';
import { test, expect } from './fixtures';
import { testIds } from '../src/constants/testIds';

test('the bundled lesson teaches recording and preview in the real editor', async ({ page }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(12_000);
  await page.setViewportSize({ width: 1720, height: 1100 });
  await page.goto('/a/grafana-pathfinder-app?doc=bundled:welcome-to-grafana');
  await page.getByRole('button', { name: 'Close Welcome to Grafana', exact: true }).click();
  await page.getByRole('button', { name: 'More options', exact: true }).click();
  await page.getByText('Create guide', { exact: true }).click();
  await page.getByRole('button', { name: 'Create your first guide', exact: true }).click();
  const floating = page.getByRole('dialog', {
    name: 'Interactive learning floating panel',
    exact: true,
    includeHidden: true,
  });
  await expect(floating).toBeVisible();
  await expect(page.getByLabel('Guide title', { exact: true })).toBeVisible();

  if (process.env.AUTHORING_EVIDENCE) {
    await page.screenshot({ path: `${process.env.AUTHORING_EVIDENCE}/editor-before-action.png`, fullPage: true });
  }
  const introduction = floating.locator('[data-interactive-section][id$="explain-the-task"]');
  await introduction.getByRole('button', { name: 'Do it', exact: true }).click();
  if (process.env.AUTHORING_EVIDENCE) {
    await page.screenshot({ path: `${process.env.AUTHORING_EVIDENCE}/editor-after-action.png`, fullPage: true });
  }
  await expect(page.getByLabel('Guide title', { exact: true })).toHaveValue("Find your team's dashboards");
  const instruction = floating.locator('.interactive-guided-instruction-text');
  await introduction.getByRole('button', { name: /Start guided interaction/ }).click();
  await expect(instruction).toContainText('Choose Add block');
  await page.getByTestId(testIds.blockEditor.palette).getByTestId(testIds.blockEditor.addBlockButton).click();
  await expect(instruction).toContainText('Choose Markdown');
  await page.getByTestId(testIds.blockEditor.blockTypeButton('markdown')).click();
  await expect(instruction).toContainText('Choose Raw');
  await page.getByTestId(testIds.blockEditor.rawMarkdownTab).click();
  await expect(instruction).toContainText('Enter a short introduction');
  await page.getByTestId(testIds.blockEditor.markdownTextarea).fill('Use this guide to find dashboards for your team.');
  await expect(instruction).toContainText('Add the Markdown block');
  await page.getByTestId(testIds.blockEditor.submitButton).click();
  await introduction.getByRole('button', { name: 'Mark section as complete', exact: true }).click();
  await expect(introduction).toHaveClass(/completed/);

  const modes = page.getByTestId(testIds.blockEditor.viewModeToggle);
  await modes.getByRole('radio', { name: 'Preview', exact: true }).click();
  await expect(page.getByTestId(testIds.blockEditor.container)).toContainText(
    'Use this guide to find dashboards for your team.'
  );
  await expect(introduction).toHaveClass(/completed/);
  await modes.getByRole('radio', { name: 'Edit', exact: true }).click();
  await expect(page.getByTestId(testIds.blockEditor.content)).toContainText(
    'Use this guide to find dashboards for your team.'
  );
  await expect(introduction).toHaveClass(/completed/);

  const recording = floating.locator('[data-interactive-section][id$="record-an-activity"]');
  await recording.getByRole('button', { name: 'Go there', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboards/);
  await expect(floating).toBeVisible();
  await recording
    .getByRole('button', { name: /Start guided interaction/ })
    .first()
    .click();
  await expect(instruction).toContainText('Choose Add block');
  await page.getByTestId(testIds.blockEditor.palette).getByTestId(testIds.blockEditor.addBlockButton).click();
  await expect(instruction).toContainText('Choose Section');
  const sectionButton = page.getByTestId(testIds.blockEditor.blockTypeButton('section'));
  await expect(sectionButton).toHaveClass(/interactive-guided-active/);
  await sectionButton.click();
  await expect(instruction).toContainText('Enter Search the dashboard list');
  await page.getByTestId(testIds.blockEditor.sectionTitleInput).fill('Search the dashboard list');
  await expect(instruction).toContainText('Choose Add and record');
  await page.getByTestId(testIds.blockEditor.addAndRecordButton).click();
  await expect(page.getByTestId(testIds.blockEditor.recordStopButton)).toBeVisible();
  await recording.getByRole('button', { name: /Start guided interaction/ }).click();
  await expect(instruction).toContainText('Enter team');
  await page.getByRole('textbox', { name: 'Search for dashboards and folders' }).fill('team');
  await page.getByRole('textbox', { name: 'Search for dashboards and folders' }).press('Tab');
  await expect(page.locator('[data-record-overlay="banner"]')).toContainText('1 block');
  await expect(instruction).toContainText('choose Stop');
  await expect(page.getByTestId(testIds.blockEditor.recordStopButton)).toHaveClass(/interactive-guided-active/);
  await page.getByTestId(testIds.blockEditor.recordStopButton).click();
  await expect(recording).toHaveClass(/completed/);

  const editor = page.getByTestId(testIds.blockEditor.container);
  const form = page.getByTestId(testIds.blockEditor.blockFormModal);
  const clickGuided = async (target: Locator, description: string) => {
    await expect(instruction).toContainText(description);
    if (description !== 'Select Preview') {
      await expect(target).toHaveClass(/interactive-guided-active/);
    }
    await target.click();
  };
  const improve = floating.locator('[data-interactive-section][id$="improve-the-recording"]');
  await improve.getByRole('button', { name: /Start guided interaction/ }).click();
  await clickGuided(editor.getByRole('button', { name: 'Edit block', exact: true }).last(), 'Edit the recorded search');
  await expect(instruction).toContainText('Replace the description');
  await expect(form.locator('textarea')).toHaveClass(/interactive-guided-active/);
  await form.locator('textarea').fill('Search for a service or dashboard name. Try team for this practice guide.');
  await clickGuided(form.getByRole('button', { name: 'Test', exact: true }), 'Choose Test');
  await expect(instruction).toContainText('Select the suggested on-page:/dashboards');
  await page.locator('.interactive-guided-active').filter({ hasText: 'on-page:/dashboards' }).click();
  await expect(
    form.getByTestId('interactive-block-requirements').getByText('on-page:/dashboards', { exact: true })
  ).toBeVisible();
  await clickGuided(form.getByRole('button', { name: 'Update block', exact: true }), 'Choose Update block');
  await improve.getByRole('button', { name: 'Mark section as complete', exact: true }).click();

  const explain = floating.locator('[data-interactive-section][id$="explain-a-control"]');
  await explain.getByRole('button', { name: /Start guided interaction/ }).click();
  await clickGuided(page.getByTestId(testIds.blockEditor.sectionNestedAddButton), 'Add a block inside');
  await clickGuided(page.getByTestId(testIds.blockEditor.blockTypeButton('interactive')), 'Choose Interactive');
  await clickGuided(form.getByRole('button', { name: 'Pick element', exact: true }), 'Choose Pick element');
  const searchBox = (await page.locator('input[placeholder="Search for dashboards and folders"]').boundingBox())!;
  await page.mouse.move(searchBox.x + searchBox.width / 2, searchBox.y + searchBox.height / 2);
  await page.mouse.click(searchBox.x + searchBox.width / 2, searchBox.y + searchBox.height / 2);
  await expect(instruction).toContainText('Enter: This search matches');
  await expect(form.locator('textarea')).toHaveClass(/interactive-guided-active/);
  await form
    .locator('textarea')
    .fill(
      'This search matches dashboards and folders that you can access. An empty result can mean that you need a different name or more permissions.'
    );
  await clickGuided(form.getByRole('button', { name: 'Test', exact: true }), 'Choose Test');
  await expect(instruction).toContainText("Clear Show 'Do it' button");
  await form.getByText("Show 'Do it' button", { exact: true }).click();
  await expect(form.getByLabel("Show 'Do it' button", { exact: true })).not.toBeChecked();
  await clickGuided(form.getByRole('button', { name: 'Add block', exact: true }), 'Add the explanatory highlight');
  await explain.getByRole('button', { name: 'Mark section as complete', exact: true }).click();

  const floatingHeader = floating.getByText('Create your first interactive guide', { exact: true }).first();
  const headerBox = (await floatingHeader.boundingBox())!;
  await page.mouse.move(headerBox.x + 20, headerBox.y + 10);
  await page.mouse.down();
  await page.mouse.move(60, 120, { steps: 10 });
  await page.mouse.up();
  const preview = floating.locator('[data-interactive-section][id$="try-the-guide"]');
  await preview.getByRole('button', { name: /Start guided interaction/ }).click();
  await clickGuided(page.getByRole('button', { name: 'Clear', exact: true }), 'Clear the dashboard search filter');
  await clickGuided(modes.getByRole('radio', { name: 'Preview', exact: true }), 'Select Preview');
  const searchAction = editor.locator('[data-targetaction="formfill"]');
  await searchAction.getByRole('button', { name: 'Show me', exact: true }).click();
  await searchAction.getByRole('button', { name: 'Do it', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Search for dashboards and folders' })).toHaveValue('team');
  await expect(searchAction).toHaveAttribute('data-test-step-state', 'completed');
  const explanation = editor.locator('[data-targetaction="highlight"]');
  await expect(explanation.getByRole('button', { name: 'Do it', exact: true })).toHaveCount(0);
  await explanation.getByRole('button', { name: 'Show me', exact: true }).click();
  await modes.getByRole('radio', { name: 'Edit', exact: true }).click();
  await expect(page.getByLabel('Guide title', { exact: true })).toBeVisible();
  if (await preview.getByRole('button', { name: 'Mark section as complete', exact: true }).count()) {
    await preview.getByRole('button', { name: 'Mark section as complete', exact: true }).click();
  }

  const save = floating.locator('[data-interactive-section][id$="save-your-work"]');
  await save.getByRole('button', { name: 'Skip', exact: true }).first().click();
  await save.getByRole('button', { name: /Start guided interaction/ }).click();
  await clickGuided(page.getByTestId(testIds.blockEditor.moreActionsButton), 'Open More actions');
  const popupPromise = page.waitForEvent('popup');
  await clickGuided(page.getByRole('menuitem', { name: 'Download JSON', exact: true }), 'Choose Download JSON');
  const popup = await popupPromise;
  const downloaded = JSON.parse((await popup.locator('pre').textContent())!);
  await popup.close();
  expect(downloaded.blocks.find((block: { type: string }) => block.type === 'section')).toMatchObject({
    blocks: [
      expect.objectContaining({ action: 'formfill', requirements: expect.arrayContaining(['on-page:/dashboards']) }),
      expect.objectContaining({ action: 'highlight', doIt: false }),
    ],
  });
  if (process.env.AUTHORING_EVIDENCE) {
    await page.screenshot({ path: `${process.env.AUTHORING_EVIDENCE}/guide-preview-export.png`, fullPage: true });
  }
  await floating.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(editor).toBeVisible();
});

test('the lesson action keeps an existing reader tab from displacing the editor', async ({ page }) => {
  await page.goto('/a/grafana-pathfinder-app?doc=bundled:welcome-to-grafana');
  await page.getByRole('button', { name: 'More options', exact: true }).click();
  await page.getByText('Create guide', { exact: true }).click();
  await page.getByRole('button', { name: 'Create your first guide', exact: true }).click();
  const floating = page.getByRole('dialog', { name: 'Interactive learning floating panel', exact: true });
  await expect(page.getByLabel('Guide title', { exact: true })).toBeVisible();
  await floating.locator('[data-interactive-section][id$="explain-the-task"]').getByRole('button', { name: 'Do it', exact: true }).click();
  if (process.env.AUTHORING_EVIDENCE) {
    await page.screenshot({ path: `${process.env.AUTHORING_EVIDENCE}/existing-tab-displaces-editor.png`, fullPage: true });
  }
  await expect(page.getByLabel('Guide title', { exact: true })).toHaveValue("Find your team's dashboards");
});

test('the authoring recommendation opens the floating lesson and docked editor', async ({ page }) => {
  await page.goto('/a/grafana-pathfinder-app?doc=bundled:welcome-to-grafana');
  await expect(page.getByTestId(testIds.docsPanel.recommendationsTab)).toBeVisible();
  await page.getByTestId('data-testid navigation mega-menu').getByTestId('data-testid Home breadcrumb').click();
  await page.getByRole('button', { name: 'Close Welcome to Grafana', exact: true }).click();
  await page.getByTestId(testIds.docsPanel.recommendationsTab).click();
  await page.getByText('Create your first interactive guide', { exact: true }).click();
  await page.getByRole('button', { name: 'Start guide', exact: true }).click();
  if (process.env.AUTHORING_EVIDENCE) {
    await page.screenshot({ path: `${process.env.AUTHORING_EVIDENCE}/recommendation-after-click.png`, fullPage: true });
  }
  await expect(page.getByRole('dialog', { name: 'Interactive learning floating panel', exact: true })).toBeVisible();
  await expect(page.getByLabel('Guide title', { exact: true })).toBeVisible();
});

test('the bundled authoring lesson also opens by its direct link', async ({ page }) => {
  await page.goto('/a/grafana-pathfinder-app?doc=bundled:create-your-first-guide/content.json');
  await expect(page.getByText('Explain the task to your reader', { exact: true })).toBeVisible();
});

test('ordinary reader menus cannot open a guide beside the editor', async ({ page }) => {
  await page.goto('/a/grafana-pathfinder-app?doc=bundled:welcome-to-grafana');
  await page.getByRole('button', { name: 'More options', exact: true }).click();
  await expect(page.getByText('Create guide', { exact: true })).toBeVisible();
  await expect(page.getByText('Open beside guide editor', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Interactive learning floating panel', exact: true })).toHaveCount(0);
});
