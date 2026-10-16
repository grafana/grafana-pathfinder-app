import { test, expect } from './fixtures';
import { waitForGrafanaReady } from './helpers/grafana.helpers';

test('Grafana readiness does not wait for unrelated pending requests', async ({ page }) => {
  let releaseRequest!: () => void;
  let signalRequestStarted!: () => void;
  let requestIsPending = false;
  const heldRequest = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  const requestStarted = new Promise<void>((resolve) => {
    signalRequestStarted = resolve;
  });
  await page.route('**/__e2e_pending_request', async (route) => {
    requestIsPending = true;
    signalRequestStarted();
    await heldRequest;
    requestIsPending = false;
    await route.fulfill({ json: {} });
  });

  await page.goto('/');
  await page.evaluate(() => {
    void fetch('/__e2e_pending_request');
  });
  await requestStarted;

  try {
    await waitForGrafanaReady(page);
    await expect(page.getByRole('button', { name: 'Help', exact: true })).toBeVisible();
    expect(requestIsPending).toBe(true);
  } finally {
    releaseRequest();
  }
});
