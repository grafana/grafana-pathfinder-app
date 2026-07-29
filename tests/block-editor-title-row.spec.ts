import { test, expect } from './fixtures';
import { openBlockEditor, clearBlockEditorState } from './helpers/block-editor.helpers';
import { testIds } from '../src/constants/testIds';

/**
 * Header responsive regression at the 320px floating-panel minimum. Exercises the
 * REAL components (no synthetic stand-ins):
 *  - Edit: the content-sized title input must shrink under real width pressure
 *    (a long title) instead of pushing the row into horizontal overflow.
 *  - Preview: the status cluster relocates to the toolbar and must STAY visible
 *    at 320px — regression guard for the old `display:none` that hid it.
 *
 * The publish badge only renders with a live backend (unavailable in e2e), so its
 * narrow-width icon-collapse is covered structurally by the unit tests. Here we
 * assert the no-backend local-save indicator — the state e2e actually renders —
 * so the coverage is of real code, not an injected element.
 */

const NARROW_WIDTH = 320;

test.describe('Block editor header — responsive at 320px', () => {
  // No plugin-settings mutation here: the app is provisioned enabled
  // (provisioning/plugins/app.yaml), so POSTing settings would only race the
  // parallel block-editor spec.
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearBlockEditorState(page);
  });

  test('edit: the title input shrinks instead of overflowing the row', async ({ page }) => {
    await openBlockEditor(page);

    const titleRow = page.getByTestId(testIds.blockEditor.titleRow);
    await expect(titleRow).toBeVisible();

    // Real width pressure: a long title makes the content-sized input want far
    // more than 320px, so it must shrink (maxWidth:100% + minWidth:0) to fit.
    const titleInput = page.getByLabel('Guide title');
    await titleInput.fill('A deliberately long guide title that wants plenty of horizontal room');

    // Constrain the editor to the 320px floating-panel minimum.
    await page.getByTestId(testIds.blockEditor.container).evaluate((container) => {
      const el = container as HTMLElement;
      el.style.width = '320px';
      el.style.maxWidth = '320px';
      void el.offsetWidth; // force reflow
    });

    // 1. The row must not overflow horizontally.
    const rowOverflow = await titleRow.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(rowOverflow).toBeLessThanOrEqual(0);

    // 2. The input actually yielded — its content overflows its capped visible
    //    width (rather than widening the row). Proves the shrink mechanism.
    const inputClipped = await titleInput.evaluate((el: HTMLInputElement) => el.scrollWidth > el.clientWidth);
    expect(inputClipped).toBe(true);

    // 3. The no-backend local-save indicator stays visible in the row.
    await expect(page.getByLabel(/Saved|Saving/)).toBeVisible();
  });

  test('preview: the status indicator stays visible in the toolbar at 320px', async ({ page }) => {
    await openBlockEditor(page);

    // Switch to preview while the labeled rocker is still available (pre-constrain).
    await page.getByRole('radio', { name: 'Preview' }).click();

    const toolbar = page.getByTestId(testIds.blockEditor.toolbarRow);
    await expect(toolbar).toBeVisible();

    await page.getByTestId(testIds.blockEditor.container).evaluate((container) => {
      const el = container as HTMLElement;
      el.style.width = '320px';
      el.style.maxWidth = '320px';
      void el.offsetWidth; // force reflow
    });

    // Regression guard: the preview status cluster used to be `display:none`
    // at <=420px, hiding save-state for no-backend users. It must stay visible.
    const status = page.getByLabel(/Saved|Saving/);
    await expect(status).toBeVisible();

    // ...and within the toolbar's right edge (not clipped past it).
    const withinBounds = await status.evaluate((el) => {
      const toolbarEl = el.closest('[data-testid="block-editor-toolbar-row"]');
      if (!toolbarEl) {
        return false;
      }
      const s = el.getBoundingClientRect();
      const t = toolbarEl.getBoundingClientRect();
      return s.width > 0 && s.right <= t.right + 1;
    });
    expect(withinBounds).toBe(true);
  });
});
