import { test, expect } from './fixtures';
import { openBlockEditor, clearBlockEditorState } from './helpers/block-editor.helpers';
import { testIds } from '../src/constants/testIds';

/**
 * Title-row responsive regression (header redesign, #1256 / PR #1429).
 *
 * At the 320px floating-panel minimum the title row must not overflow
 * horizontally when the widest status badge ("Published (modified)") is shown,
 * and the status must stay visible. Regression guard for the title-area shrink
 * fix in `header.styles.ts`.
 *
 * The "published (modified)" backend state can't be reached without a live
 * backend, so we (1) force the optional-backend feature toggle client-side so
 * the status badge renders at all, and (2) rewrite the rendered badge's label to
 * the widest value. The real title-row flex layout is what's under test.
 */

// Forces the aggregation backend toggle on before boot so `isBackendApiAvailable()`
// returns true and the header renders the publish-status badge.
function forceBackendToggle() {
  let bootData: unknown;
  Object.defineProperty(window, 'grafanaBootData', {
    configurable: true,
    get() {
      return bootData;
    },
    set(value: unknown) {
      try {
        const toggles = (value as { settings?: { featureToggles?: Record<string, boolean> } })?.settings
          ?.featureToggles;
        if (toggles) {
          toggles['aggregation.pathfinderbackend-ext-grafana-com.enabled'] = true;
        }
      } catch {
        // ignore
      }
      bootData = value;
    },
  });
}

test.describe('Block editor header — title row responsive', () => {
  test.beforeAll(async ({ request }) => {
    await request.post('/api/plugins/grafana-pathfinder-app/settings', {
      data: { enabled: true, jsonData: {} },
    });
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(forceBackendToggle);
    await page.goto('/');
    await clearBlockEditorState(page);
  });

  test('title row does not overflow at 320px with the widest status badge', async ({ page }) => {
    await openBlockEditor(page);

    const titleRow = page.getByTestId(testIds.blockEditor.titleRow);
    await expect(titleRow).toBeVisible();

    // Force the status badge to its widest label ("Published (modified)").
    const badgeForced = await titleRow.evaluate((row) => {
      const candidates = Array.from(row.querySelectorAll('*')).filter((el) =>
        /^(Draft|Published)/.test((el.textContent || '').trim())
      );
      const badge = candidates[candidates.length - 1];
      if (!badge) {
        return false;
      }
      let changed = false;
      badge.childNodes.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE && (node.textContent || '').trim()) {
          node.textContent = 'Published (modified)';
          changed = true;
        }
      });
      if (!changed) {
        badge.textContent = 'Published (modified)';
      }
      return true;
    });
    expect(badgeForced).toBe(true);

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
    const statusVisible = await titleRow.evaluate((row) => {
      const badge = Array.from(row.querySelectorAll('*')).find(
        (el) => (el.textContent || '').trim() === 'Published (modified)'
      );
      if (!badge) {
        return false;
      }
      const b = badge.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      return b.width > 0 && b.right <= r.right + 1;
    });
    expect(statusVisible).toBe(true);
  });
});
