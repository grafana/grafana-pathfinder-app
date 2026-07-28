import { test, expect } from './fixtures';
import { openBlockEditor, clearBlockEditorState } from './helpers/block-editor.helpers';
import { testIds } from '../src/constants/testIds';

/**
 * Title-row responsive regression: at the 320px floating-panel minimum the
 * title row must not overflow horizontally when a wide status badge is shown,
 * and the status must stay visible. Guards the title-area shrink behavior in
 * `header.styles.ts` — `titleArea` must shrink below its ~180px preferred width
 * so a non-shrinking status cluster fits instead of pushing the row into
 * overflow.
 *
 * The real "Published (modified)" badge only renders with a live backend, which
 * isn't available in e2e, so the test injects a stand-in the width of that
 * badge into the real status cluster. The title-row / titleArea / rightCluster
 * flex layout under test is exercised for real; only the badge's content is
 * synthetic.
 */

// Approximate rendered width of the widest status badge ("Published (modified)").
const WIDEST_BADGE_PX = 150;
const STANDIN_TESTID = 'title-row-status-standin';

test.describe('Block editor header — title row responsive', () => {
  // Ensure the plugin is enabled. Keep devMode on so this doesn't clobber the
  // parallel block-editor spec, which needs it for its recording test.
  test.beforeAll(async ({ request }) => {
    await request.post('/api/plugins/grafana-pathfinder-app/settings', {
      data: { enabled: true, jsonData: { devMode: true, devModeUserIds: [1] } },
    });
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearBlockEditorState(page);
  });

  test('title row does not overflow at 320px with a wide status badge', async ({ page }) => {
    await openBlockEditor(page);

    const titleRow = page.getByTestId(testIds.blockEditor.titleRow);
    await expect(titleRow).toBeVisible();

    // Inject a stand-in the width of the widest status badge into the real
    // status cluster (rightCluster = the title row's last element child).
    const injected = await titleRow.evaluate(
      (row, args) => {
        const cluster = row.lastElementChild as HTMLElement | null;
        if (!cluster) {
          return false;
        }
        const standin = document.createElement('span');
        standin.setAttribute('data-testid', args.testId);
        standin.textContent = 'Published (modified)';
        standin.style.flexShrink = '0';
        standin.style.width = `${args.widthPx}px`;
        standin.style.whiteSpace = 'nowrap';
        cluster.appendChild(standin);
        return true;
      },
      { widthPx: WIDEST_BADGE_PX, testId: STANDIN_TESTID }
    );
    expect(injected).toBe(true);

    // Constrain the editor to the 320px floating-panel minimum.
    await page.getByTestId(testIds.blockEditor.container).evaluate((container) => {
      const el = container as HTMLElement;
      el.style.width = '320px';
      el.style.maxWidth = '320px';
      void el.offsetWidth; // force reflow
    });

    // 1. No horizontal overflow.
    const overflow = await titleRow.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // 2. Status stays visible within the row (not clipped past the right edge).
    const statusVisible = await page.getByTestId(STANDIN_TESTID).evaluate((standin) => {
      const row = standin.closest('[data-testid="block-editor-title-row"]');
      if (!row) {
        return false;
      }
      const s = standin.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      return s.width > 0 && s.right <= r.right + 1;
    });
    expect(statusVisible).toBe(true);
  });
});
