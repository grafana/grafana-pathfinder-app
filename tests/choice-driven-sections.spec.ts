import { resolve } from 'node:path';
import { test, expect } from './fixtures';
import { openBlockEditor, clearBlockEditorState } from './helpers/block-editor.helpers';
import { testIds } from '../src/constants/testIds';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await clearBlockEditorState(page);
  await page.reload();
  await openBlockEditor(page);
});

test('authors a generic checkbox group without manual variable wiring', async ({ page }) => {
  await page.getByTestId(testIds.blockEditor.palette).getByTestId(testIds.blockEditor.addBlockButton).click();
  await page.getByTestId(testIds.blockEditor.blockTypeButton('input')).click();
  const modal = page.getByTestId(testIds.blockEditor.blockFormModal);
  await modal.getByRole('radio', { name: 'Checkbox group', exact: true }).check();
  await modal.getByPlaceholder('e.g., What is the name of your Prometheus data source?').fill('Which environments?');
  await modal.getByLabel('Option 1', { exact: true }).fill('Development');
  await modal.getByRole('button', { name: 'Add option', exact: true }).click();
  await modal.getByLabel('Option 2', { exact: true }).fill('Production');
  await modal.getByTestId(testIds.blockEditor.submitButton).click();
  await expect(modal).not.toBeVisible();
  await page.getByTestId(testIds.blockEditor.palette).getByTestId(testIds.blockEditor.addBlockButton).click();
  await page.getByTestId(testIds.blockEditor.blockTypeButton('section')).click();
  await modal.getByTestId(testIds.blockEditor.sectionTitleInput).fill('Production setup');
  const requirements = modal.getByTestId('section-block-requirements');
  await requirements.getByRole('button', { name: 'Add condition', exact: true }).click();
  await requirements.getByPlaceholder('Pick a type…').click();
  await page.getByRole('option', { name: /^Checkbox option selected/ }).click();
  await requirements.getByPlaceholder('Select a question').click();
  await page.getByRole('option', { name: 'Which environments?', exact: true }).click();
  await modal.getByPlaceholder('Select an option').click();
  await page.getByRole('option', { name: 'Production', exact: true }).click();
  await requirements.getByRole('button', { name: 'Add', exact: true }).click();
  await modal.getByRole('combobox', { name: 'When requirements are not met', exact: true }).click();
  await page.getByRole('option', { name: 'Hide entire section', exact: true }).click();
  await modal.getByTestId(testIds.blockEditor.submitButton).click();
  await expect(modal).not.toBeVisible();
  await page
    .getByTestId(testIds.blockEditor.viewModeToggle)
    .getByRole('radio', { name: 'Preview', exact: true })
    .check();
  const group = page.getByRole('group', { name: 'Which environments?' });
  const development = group.getByRole('checkbox', { name: 'Development' });
  await development.focus();
  await page.keyboard.press('Space');
  await expect(development).toBeChecked();
  await page.keyboard.press('Tab');
  const production = group.getByRole('checkbox', { name: 'Production' });
  await expect(production).toBeFocused();
  await expect(page.getByText('Production setup', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Space');
  await expect(production).toBeChecked();
  await expect(page.getByText('Production setup', { exact: true })).toBeVisible();
});

test('shows all eight selection combinations and preserves section completion when selections change', async ({
  page,
}) => {
  await page.getByTestId(testIds.blockEditor.moreActionsButton).click();
  await page.getByRole('menuitem', { name: 'Import', exact: true }).click();
  const modal = page.getByTestId(testIds.blockEditor.importModal);
  await modal
    .locator('input[type="file"]')
    .setInputFiles(resolve('docs/developer/interactive-examples/choice-driven-guide.json'));
  await modal.getByTestId(testIds.blockEditor.importButton).click();
  await expect(modal).not.toBeVisible();
  await page
    .getByTestId(testIds.blockEditor.viewModeToggle)
    .getByRole('radio', { name: 'Preview', exact: true })
    .check();
  const group = page.getByRole('group', { name: 'Which signals do you want to configure?' });
  const names = ['Metrics', 'Logs', 'Traces'];
  for (let mask = 0; mask < 8; mask++) {
    for (let index = 0; index < names.length; index++) {
      const selected = Boolean(mask & (1 << index));
      const checkbox = group.getByRole('checkbox', { name: names[index]!, exact: true });
      if ((await checkbox.isChecked()) !== selected) {
        await group.getByText(names[index]!, { exact: true }).click();
      }
      const section = page.getByTestId(testIds.interactive.section(`section-${names[index]!.toLowerCase()}`));
      if (selected) {
        await expect(section).toBeVisible();
      } else {
        await expect(section).toHaveCount(0);
      }
    }
  }
  await group.getByText('Metrics', { exact: true }).click();
  await group.getByText('Traces', { exact: true }).click();
  await page
    .getByTestId(testIds.interactive.section('section-common'))
    .getByRole('button', { name: 'Mark section as complete', exact: true })
    .click();
  await page
    .getByTestId(testIds.interactive.section('section-logs'))
    .getByRole('button', { name: 'Mark section as complete', exact: true })
    .click();
  await expect(page.getByTestId(testIds.markComplete.percentage)).toContainText('100%');
  await group.getByText('Traces', { exact: true }).click();
  await expect(page.getByTestId(testIds.markComplete.percentage)).not.toContainText('100%');
  await group.getByText('Logs', { exact: true }).click();
  await group.getByText('Logs', { exact: true }).click();
  await expect(page.getByTestId(testIds.interactive.section('section-logs'))).toHaveClass(/completed/);
});
