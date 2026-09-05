import { readdirSync, readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';
import { testIds } from '../../src/constants/testIds';
import { dismissBadgeCelebrations } from './utils/guide-runner/badge-celebrations';

function browserProcessCommands(): string[] {
  return readdirSync('/proc', { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .flatMap((entry) => {
      try {
        return [readFileSync(`/proc/${entry.name}/cmdline`, 'utf8').replaceAll('\0', ' ')];
      } catch {
        return [];
      }
    })
    .filter((command) => command.includes('/ms-playwright/'));
}

test('launches the bundled full Chromium browser', async ({ page }) => {
  test.skip(process.platform !== 'linux', 'Runner image browser verification is Linux-specific');
  const browserCommands = browserProcessCommands();
  expect(browserCommands).not.toHaveLength(0);
  expect(browserCommands).not.toEqual(expect.arrayContaining([expect.stringContaining('/chromium_headless_shell-')]));
  expect(browserCommands).toEqual(expect.arrayContaining([expect.stringContaining('/chromium-')]));

  await page.setContent('<main>Pathfinder E2E runner</main>');
  await expect(page.getByRole('main')).toHaveText('Pathfinder E2E runner');
});

test('dismisses a moving badge toast through DOM event dispatch', async ({ page }) => {
  await page.setContent(`
    <style>
      @keyframes badge-slide {
        from { transform: translateX(0); }
        to { transform: translateX(200px); }
      }
      [data-testid="${testIds.learningPaths.badgeToast}"] {
        animation: badge-slide 1500ms linear;
        position: fixed;
      }
    </style>
    <div data-testid="${testIds.learningPaths.badgeToast}">
      Badge unlocked!
      <button data-testid="${testIds.learningPaths.badgeToastDismiss}">Dismiss</button>
    </div>
    <script>
      document.querySelector('[data-testid="${testIds.learningPaths.badgeToastDismiss}"]').addEventListener('click', (event) => {
        event.currentTarget.parentElement.remove();
      });
    </script>
  `);
  const toast = page.getByTestId(testIds.learningPaths.badgeToast);

  await expect(toast).toBeVisible();
  await expect(toast).toHaveCSS('animation-duration', '1.5s');
  await dismissBadgeCelebrations(page);

  await expect(toast).toHaveCount(0);
});
