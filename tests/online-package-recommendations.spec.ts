import { satisfies } from 'semver';
import type { APIRequestContext } from '@playwright/test';
import { testIds } from '../src/constants/testIds';
import { test, expect } from './fixtures';
import { waitForGrafanaReady } from './helpers/grafana.helpers';

const PACKAGE_RECOMMENDATIONS_PATH = `/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/default/backend/package-recommendations`;

const PUBLIC_FEED_PATH = '/api/plugins/grafana-pathfinder-app/resources/package-recommendations';

async function sdkAvailable(request: APIRequestContext): Promise<boolean> {
  const health = await request.get(PACKAGE_RECOMMENDATIONS_PATH.replace('package-recommendations', 'health'));
  if (health.status() === 404 && !satisfies(process.env.GRAFANA_TEST_IMAGE_VERSION ?? '', '>=13.3.0')) {
    return false;
  }
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({ status: 'ok' });
  return true;
}

test.describe('online package recommendations endpoint', () => {
  test('GET returns the proxied repository.json with baseUrl + packages', async ({ request }) => {
    const available = await sdkAvailable(request);
    const response = await request.get(available ? PACKAGE_RECOMMENDATIONS_PATH : PUBLIC_FEED_PATH);

    // 200 when the public CDN is reachable from the dev container; 503 if the
    // host blocks egress. Both are valid endpoint behaviours; assert the shape
    // for the success case and tolerate sticky-503 for the offline case.
    if (response.status() === 503) {
      const body = await response.json();
      expect(body).toMatchObject({ error: 'package-index-unavailable' });
      return;
    }

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(typeof body.baseUrl).toBe('string');
    expect(body.baseUrl).toMatch(/^https:\/\/interactive-learning\.grafana(-dev|-ops)?\.net\/packages\/$/);
    expect(Array.isArray(body.packages)).toBe(true);

    if (body.packages.length > 0) {
      // Every entry must have id + path. Only the targeted subset participates
      // in recommendations; untargeted entries (milestone steps,
      // recommends/suggests targets) stay in the response so the package
      // resolver can find them by ID.
      for (const entry of body.packages) {
        expect(typeof entry.id).toBe('string');
        expect(typeof entry.path).toBe('string');
      }
      const targeted = body.packages.find((p: { targeting?: unknown }) => p.targeting);
      expect(targeted).toBeDefined();
      expect(targeted.targeting.match).toBeDefined();
    }
  });

  test('rejects non-GET methods with 405', async ({ request }) => {
    const available = await sdkAvailable(request);
    const response = await request.post(available ? PACKAGE_RECOMMENDATIONS_PATH : PUBLIC_FEED_PATH, { data: {} });
    expect(response.status()).toBe(405);
  });

  test('docs panel opens with the catalogue available or unavailable', async ({ page, request }) => {
    const available = await sdkAvailable(request);
    const catalogue = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === (available ? PACKAGE_RECOMMENDATIONS_PATH : PUBLIC_FEED_PATH) &&
        response.request().method() === 'GET'
    );
    await page.goto('/dashboards');
    await waitForGrafanaReady(page);
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    await expect(page.getByTestId(testIds.sidebarHub.container)).toBeVisible();
    await expect(page.getByTestId(testIds.sidebarHub.loading)).toHaveCount(0);
    const response = await catalogue;
    expect([200, 503]).toContain(response.status());
  });
});
