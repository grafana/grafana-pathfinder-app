import { test, expect } from './fixtures';
import { openBlockEditor, clearBlockEditorState } from './helpers/block-editor.helpers';
import { testIds } from '../src/constants/testIds';

const guide = {
  id: 'conditional-workflow-regression',
  title: 'Conditional workflow regression',
  blocks: [
    {
      type: 'section',
      id: 'workflow',
      title: 'Configure and save',
      autoCollapse: false,
      blocks: [
        {
          type: 'interactive',
          id: 'open',
          action: 'button',
          reftarget: '#fixture-open',
          content: 'Open the editor',
          doIt: true,
        },
        {
          type: 'conditional',
          id: 'editor-open',
          conditions: ['exists-reftarget'],
          reftarget: '#fixture[data-open="true"]',
          whenTrue: [
            {
              type: 'interactive',
              id: 'fill',
              action: 'button',
              reftarget: '#fixture-fill',
              content: 'Fill the service',
              doIt: true,
            },
            {
              type: 'interactive',
              id: 'save',
              action: 'button',
              reftarget: '#fixture-save',
              content: 'Save the service',
              doIt: true,
            },
          ],
          whenFalse: [{ type: 'markdown', content: 'Open the editor to configure your service.' }],
        },
      ],
    },
    { type: 'markdown', content: 'Your service configuration is saved.' },
  ],
};

for (const execution of ['individual', 'section'] as const) {
  test(`requires every active conditional step before completing the guide (${execution})`, async ({ page }) => {
    await page.goto('/');
    await clearBlockEditorState(page);
    await page.reload();
    await openBlockEditor(page);
    await page.getByTestId(testIds.blockEditor.moreActionsButton).click();
    await page.getByRole('menuitem', { name: 'Import', exact: true }).click();
    const modal = page.getByTestId(testIds.blockEditor.importModal);
    await modal.locator('input[type="file"]').setInputFiles({
      name: 'conditional.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(guide)),
    });
    await modal.getByTestId(testIds.blockEditor.importButton).click();
    await expect(modal).not.toBeVisible();
    await page
      .getByTestId(testIds.blockEditor.viewModeToggle)
      .getByRole('radio', { name: 'Preview', exact: true })
      .check();
    await page.evaluate(() => {
      const fixture = document.createElement('div');
      fixture.id = 'fixture';
      fixture.style.cssText = 'position:fixed;left:350px;top:200px;z-index:10000;background:white;padding:20px';
      for (const action of ['open', 'fill', 'save']) {
        const button = document.createElement('button');
        button.id = `fixture-${action}`;
        button.textContent = action;
        button.onclick = () => {
          fixture.setAttribute(`data-${action}`, 'true');
          if (action === 'save') {
            fixture.setAttribute('data-open', 'false');
          }
        };
        fixture.append(button);
      }
      document.body.append(fixture);
    });
    const section = page.getByTestId(testIds.interactive.section('section-workflow'));
    const progress = page.getByTestId(testIds.guideProgress.percentage);
    await section.getByRole('button', { name: 'Do it', exact: true }).first().click();
    await expect(page.locator('#fixture')).toHaveAttribute('data-open', 'true');
    await expect(section.getByText('Fill the service', { exact: true })).toBeVisible();
    await expect(progress).not.toContainText('100%');
    await expect(section.locator('[data-step-id="open"]').getByText('Completed', { exact: true })).toBeVisible();
    if (execution === 'section') {
      await section.getByTestId(testIds.interactive.doSectionButton('section-workflow')).click();
    } else {
      await section.locator('[data-step-id="fill"]').getByRole('button', { name: 'Do it', exact: true }).click();
      await expect(page.locator('#fixture')).toHaveAttribute('data-fill', 'true');
      await expect(progress).not.toContainText('100%');
      await expect(section.locator('[data-step-id="fill"]').getByText('Completed', { exact: true })).toBeVisible();
      await section.locator('[data-step-id="save"]').getByRole('button', { name: 'Do it', exact: true }).click();
    }
    await expect(page.locator('#fixture')).toHaveAttribute('data-save', 'true', { timeout: 20000 });
    await expect(progress).toContainText('100%');
    await expect(section.locator('[data-step-id="save"]').getByText('Completed', { exact: true })).toBeVisible();
    await expect(page.locator('#fixture')).toHaveAttribute('data-open', 'false');
    await page.getByRole('button', { name: 'Reset guide', exact: true }).click();
    await expect(progress).toHaveText(/^0%/);
    await expect(section.getByText('Open the editor to configure your service.', { exact: true })).toBeVisible();
    await expect(section.locator('[data-step-id="save"]')).toHaveCount(0);
  });
}
