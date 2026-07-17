import { expect, test } from '@playwright/test';

test('launches the bundled browser', async ({ page }) => {
  await page.setContent('<main>Pathfinder E2E runner</main>');

  await expect(page.getByRole('main')).toHaveText('Pathfinder E2E runner');
});
