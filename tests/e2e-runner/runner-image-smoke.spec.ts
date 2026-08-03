import { readdirSync, readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

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
