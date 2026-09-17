import { test, expect } from './fixtures';
import { testIds } from '../src/constants/testIds';
import { TIMEOUTS } from './constants';
import { gunzipSync } from 'node:zlib';

interface FaroEvent {
  name: string;
  attributes: Record<string, string>;
}

test('correlates private and CDN failures with committed rendering without leaking private content', async ({
  page,
}) => {
  const events: FaroEvent[] = [];
  const payloads: unknown[] = [];
  await page.route(/https:\/\/faro-collector-[^/]+\/collect\//, async (route) => {
    if (route.request().method() === 'POST') {
      let body = route.request().postDataBuffer()!;
      if (body[0] === 0x1f && body[1] === 0x8b) {
        body = gunzipSync(body);
      }
      const payload = JSON.parse(body.toString()) as { events?: FaroEvent[] };
      payloads.push(payload);
      events.push(...(payload.events ?? []));
    }
    await route.fulfill({ status: 202, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await page.addInitScript(() => {
    localStorage.setItem('pathfinder.faro.local', 'true');
    let boot: unknown;
    Object.defineProperty(window, 'grafanaBootData', {
      configurable: true,
      get: () => boot,
      set: (value) => {
        value.settings.buildInfo.env = 'development';
        value.settings.namespace = 'stacks-telemetry-test';
        value.settings.featureToggles['aggregation.pathfinderbackend-ext-grafana-app.enabled'] = true;
        boot = value;
      },
    });
  });
  await page.route(
    '**/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/*/interactiveguides/*',
    async (route) => {
      const id = new URL(route.request().url()).pathname.split('/').pop();
      if (id === 'private-missing') {
        await route.fulfill({ status: 404, json: { message: 'private upstream body' } });
        return;
      }
      await route.fulfill({
        json: {
          metadata: { name: id },
          spec: {
            id,
            title: 'Private fixture title',
            status: 'published',
            blocks: [{ type: 'markdown', content: id === 'private-invalid' ? 42 : 'Private fixture rendered' }],
          },
        },
      });
    }
  );
  await page.route('https://interactive-learning.grafana.net/packages/telemetry-test/*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{invalid json' })
  );
  await page.route('https://interactive-learning.grafana.net/packages/telemetry-recovered/*', (route) =>
    route.request().url().endsWith('unstyled.html')
      ? route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Recovered CDN fixture</p>' })
      : route.fulfill({ status: 404, body: 'Not found' })
  );
  await page.goto('/a/grafana-pathfinder-app/docs?doc=api:private-missing');
  await expect(page.getByTestId(testIds.docsPanel.container)).toBeVisible({ timeout: TIMEOUTS.UI_READY });

  const openGuide = async (url: string) => {
    await page.evaluate(
      (guideUrl) =>
        document.dispatchEvent(
          new CustomEvent('pathfinder-auto-open-docs', {
            detail: {
              url: guideUrl,
              title: guideUrl.startsWith('backend-guide:') ? 'Private fixture title' : 'Public fixture',
              source: 'content_link',
            },
          })
        ),
      url
    );
  };
  const outcomes = () => events.filter((event) => event.name === 'pathfinder_guide_render');
  await expect(page.getByText('Unable to load documentation')).toBeVisible();
  await expect.poll(() => outcomes().some((event) => event.attributes.http_status === '404')).toBe(true);
  await openGuide('backend-guide:private-invalid');
  await expect.poll(() => outcomes().some((event) => event.attributes.reason === 'schema-invalid')).toBe(true);
  await openGuide('backend-guide:private-valid');
  await expect(page.getByText('Private fixture rendered')).toBeVisible();
  await expect.poll(() => outcomes().some((event) => event.attributes.outcome === 'rendered')).toBe(true);
  await openGuide('https://interactive-learning.grafana.net/packages/telemetry-test/content.json');
  await expect
    .poll(() => outcomes().some((event) => event.attributes.stage === 'decode' && event.attributes.outcome === 'error'))
    .toBe(true);

  await openGuide('https://interactive-learning.grafana.net/packages/telemetry-recovered');
  await expect(page.getByText('Recovered CDN fixture')).toBeVisible();
  await expect.poll(() => outcomes().filter((event) => event.attributes.outcome === 'rendered').length).toBe(2);

  const terminal = outcomes().filter((event) =>
    ['rendered', 'error', 'timeout', 'cancelled'].includes(event.attributes.outcome!)
  );
  expect(new Set(terminal.map((event) => event.attributes.load_id)).size).toBe(terminal.length);
  const completed = terminal.filter((event) => event.attributes.outcome !== 'cancelled');
  expect(completed).toHaveLength(5);
  for (const outcome of completed) {
    expect(
      events.some(
        (event) => event.name === 'pathfinder_guide_request' && event.attributes.load_id === outcome.attributes.load_id
      )
    ).toBe(true);
  }
  const serialized = JSON.stringify(payloads);
  for (const privateValue of [
    'private-missing',
    'private-invalid',
    'private-valid',
    'Private fixture title',
    'Private fixture rendered',
    'private upstream body',
  ]) {
    expect(serialized).not.toContain(privateValue);
  }
});
