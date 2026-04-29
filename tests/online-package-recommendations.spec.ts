import { test, expect } from './fixtures';
import pluginJson from '../src/plugin.json';

const PACKAGE_RECOMMENDATIONS_PATH = `/api/plugins/${pluginJson.id}/resources/package-recommendations`;

test.describe('online package recommendations endpoint', () => {
  test('GET returns the proxied repository.json with baseUrl + packages', async ({ request }) => {
    const response = await request.get(PACKAGE_RECOMMENDATIONS_PATH);

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
    const response = await request.post(PACKAGE_RECOMMENDATIONS_PATH, { data: {} });
    expect(response.status()).toBe(405);
  });

  test('docs panel triggers a call to the endpoint when the recommender is disabled', async ({ page }) => {
    // OSS dev container defaults acceptedTermsAndConditions to false, so the
    // recommender-disabled branch should run and hit the new endpoint.
    const requestPromise = page.waitForRequest(
      (req) => req.url().includes(PACKAGE_RECOMMENDATIONS_PATH) && req.method() === 'GET',
      { timeout: 15000 }
    );

    await page.goto('/dashboards');
    await page.waitForLoadState('networkidle');

    const helpButton = page.locator('button[aria-label="Help"]');
    await helpButton.click();

    const request = await requestPromise;
    expect(request.url()).toContain(PACKAGE_RECOMMENDATIONS_PATH);
  });
});
