import { test, expect } from './fixtures';
import { testIds } from '../src/constants/testIds';

const guideUrl = 'https://interactive-learning.grafana.net/packages/passive-completion-test/content.json';

for (const kind of ['guided', 'multistep'] as const) {
  for (const surface of ['sidebar', 'pop-out', 'handoff'] as const) {
    test(`${kind} completes from manual Grafana actions in ${surface}`, async ({ page, context }) => {
      await context.addInitScript(() => {
        const counts: Record<string, number> = {};
        (window as unknown as { completionCounts: Record<string, number> }).completionCounts = counts;
        window.addEventListener('pathfinder:progress', (event) => {
          const detail = (event as CustomEvent).detail;
          if (detail.kind === 'step' && detail.completed) {
            counts[detail.stepId] = (counts[detail.stepId] ?? 0) + 1;
          }
        });
      });
      await context.route('**/api/plugins/grafana-pathfinder-app/settings', async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        await route.fulfill({
          response,
          json: { ...body, jsonData: { ...body.jsonData, enableTwoTabController: true, enableAutoDetection: false } },
        });
      });
      await context.route('**/api/plugins/grafana-pathfinder-app/resources/pathfinder-settings', (route) =>
        route.fulfill({
          json: {
            metadata: { name: 'default', resourceVersion: '1' },
            spec: { enableTwoTabController: true, enableAutoDetection: false },
          },
        })
      );
      await context.route(guideUrl.replace('content.json', 'manifest.json'), (route) =>
        route.fulfill({ json: { id: 'passive-completion-test', type: 'guide', repository: 'interactive-tutorials' } })
      );
      await context.route(guideUrl, (route) =>
        route.fulfill({
          json: {
            id: 'passive-completion-test',
            title: 'Manual dashboard creation',
            blocks: [
              {
                type: kind,
                id: 'create-dashboard',
                content: 'Create a dashboard using Grafana.',
                steps: [
                  { action: 'button', reftarget: 'New' },
                  { action: 'highlight', reftarget: 'a[href="/dashboard/new"]' },
                  ...(surface === 'handoff'
                    ? [{ action: 'highlight', reftarget: '[data-testid="data-testid sidebar add new panel"]' }]
                    : []),
                ],
              },
              {
                type: 'interactive',
                id: 'dashboard-open',
                content: 'The dashboard editor is open.',
                action: 'noop',
                objectives: ['on-page:/dashboard/new'],
              },
            ],
          },
        })
      );
      await page.goto(`/dashboards?doc=${encodeURIComponent(guideUrl)}`);
      await expect(page.getByTestId(testIds.docsPanel.container)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId(testIds.interactive.step('create-dashboard'))).toBeVisible();
      if (surface === 'handoff') {
        await page.getByRole('button', { name: 'New', exact: true }).last().click();
        await page.getByRole('menuitem', { name: 'New dashboard', exact: true }).click();
        await expect(page).toHaveURL(/\/dashboard\/new/);
      }
      let reader = page;
      if (surface !== 'sidebar') {
        const opened = context.waitForEvent('page');
        await page.getByTestId(testIds.docsPanel.openControllerTabButton).click();
        reader = await opened;
        await page.getByRole('button', { name: 'Accept', exact: true }).click();
        await expect(reader.getByTestId(testIds.guideReader.controllerStatus)).toContainText(/connected/i);
        await expect(
          reader
            .getByTestId(surface !== 'sidebar' ? testIds.guideReader.overlay : testIds.docsPanel.container)
            .getByTestId(testIds.interactive.step('create-dashboard'))
        ).toBeVisible();
        await page.bringToFront();
      }
      await expect(
        reader
          .getByTestId(surface !== 'sidebar' ? testIds.guideReader.overlay : testIds.docsPanel.container)
          .getByTestId(testIds.interactive.step('create-dashboard'))
      ).not.toHaveAttribute('data-test-step-state', 'completed');
      if (surface === 'handoff') {
        await page.getByRole('button', { name: 'Panel', exact: true }).click();
      } else {
        await expect(page).toHaveURL(/\/dashboards(?:\?|$)/);
        await expect(page.locator('.interactive-highlight-persistent')).toHaveCount(0);
        await page.getByRole('button', { name: 'New', exact: true }).last().click();
        await expect(
          reader
            .getByTestId(surface !== 'sidebar' ? testIds.guideReader.overlay : testIds.docsPanel.container)
            .getByTestId(testIds.interactive.step('create-dashboard'))
        ).not.toHaveAttribute('data-test-step-state', 'completed');
        await page.getByRole('menuitem', { name: 'New dashboard', exact: true }).click();
        await expect(page).toHaveURL(/\/dashboard\/new/);
      }
      await expect(
        reader
          .getByTestId(surface !== 'sidebar' ? testIds.guideReader.overlay : testIds.docsPanel.container)
          .getByTestId(testIds.interactive.step('create-dashboard'))
      ).toHaveAttribute('data-test-step-state', 'completed');
      await expect(
        reader
          .getByTestId(surface !== 'sidebar' ? testIds.guideReader.overlay : testIds.docsPanel.container)
          .getByTestId(testIds.interactive.step('dashboard-open'))
      ).toHaveAttribute('data-test-step-state', 'completed', { timeout: 15_000 });
      expect(
        await reader.evaluate(
          () => (window as unknown as { completionCounts: Record<string, number> }).completionCounts['create-dashboard']
        )
      ).toBe(1);
      if (reader !== page) {
        await reader.close();
      }
    });
  }
}

test('Do section waits for objectives after its actions finish', async ({ page, context }) => {
  await context.route(guideUrl.replace('content.json', 'manifest.json'), (route) =>
    route.fulfill({
      json: {
        id: 'passive-completion-test',
        type: 'guide',
        repository: 'interactive-tutorials',
      },
    })
  );
  await context.route(guideUrl, (route) =>
    route.fulfill({
      json: {
        id: 'passive-completion-test',
        title: 'Objective gate',
        blocks: [
          {
            type: 'section',
            id: 'waiting',
            title: 'Create a dashboard',
            autoCollapse: false,
            blocks: [
              {
                type: 'interactive',
                id: 'open-dashboard',
                action: 'button',
                reftarget: 'New',
                content: 'Open a new dashboard.',
                objectives: ['on-page:/dashboard/new'],
              },
            ],
          },
        ],
      },
    })
  );
  await page.goto(`/dashboards?doc=${encodeURIComponent(guideUrl)}`);
  await page.getByTestId(testIds.interactive.doSectionButton('section-waiting')).click();
  await expect(page.getByText('Waiting for completion', { exact: false })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId(testIds.interactive.step('open-dashboard'))).not.toHaveAttribute(
    'data-test-step-state',
    'completed'
  );
  await page.getByRole('menuitem', { name: 'New dashboard', exact: true }).click();
  await expect(page.getByTestId(testIds.interactive.step('open-dashboard'))).toHaveAttribute(
    'data-test-step-state',
    'completed'
  );
  await expect(page.getByTestId(testIds.interactive.section('section-waiting'))).toHaveClass(/completed/);
});
