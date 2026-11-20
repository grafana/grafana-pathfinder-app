import { test, expect } from './fixtures';

test('SDK achievement routes enforce identity and expose catalogue availability', async ({ request }) => {
  test.skip(process.env.PATHFINDER_SDK_E2E !== '1', 'Requires the locally registered SDK provider');
  const prefix = '/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/default/backend/api/v1/achievements';
  const definitions = await request.get(`${prefix}/definitions`);
  if (process.env.PATHFINDER_ACHIEVEMENTS_FIXTURE === '1') {
    expect(definitions.status(), await definitions.text()).toBe(200);
    const body = await definitions.json();
    expect(body.achievements.some((item: { id: string }) => item.id === 'guides-finished')).toBe(true);
  } else if (definitions.status() === 503) {
    expect(await definitions.json()).toEqual({ error: 'definitions-unavailable' });
    expect(Number(definitions.headers()['retry-after'])).toBeGreaterThan(0);
  } else {
    expect(definitions.status(), await definitions.text()).toBe(200);
    expect((await definitions.json()).achievements).toBeInstanceOf(Array);
  }
  const denied = await request.get(prefix.replace('/namespaces/default/', '/namespaces/org-999/') + '/my');
  expect(denied.status()).toBe(403);
});

test('SDK achievement writes persist and retries do not count a guide twice', async ({ request }) => {
  test.skip(
    process.env.PATHFINDER_SDK_E2E !== '1' || process.env.PATHFINDER_ACHIEVEMENTS_FIXTURE !== '1',
    'Requires the temporary acceptance build with the known achievement catalogue'
  );
  const prefix = '/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/default/backend/api/v1/achievements';
  const beforeResponse = await request.get(`${prefix}/my`);
  expect(beforeResponse.status(), await beforeResponse.text()).toBe(200);
  const before = await beforeResponse.json();
  expect(before.capability.available).toBe(true);
  const oldUnits =
    before.progress.find((item: { achievementId: string }) => item.achievementId === 'guides-finished')?.units ?? 0;
  const guideId = `sdk-achievement-${Date.now()}`;
  const event = {
    schemaVersion: 1,
    eventId: guideId,
    entity: 'guides',
    action: 'completed',
    occurredAt: new Date().toISOString(),
    context: { guideSource: 'bundled', guideId, guideCategory: 'interactive' },
    userId: 'user:forged',
  };
  for (let retry = 0; retry < 2; retry++) {
    const response = await request.post(`${prefix}/events`, { data: event });
    expect(response.status(), await response.text()).toBe(200);
    const body = await response.json();
    expect(body.retry).toBe(false);
    expect(body.decisions[0].units).toBe(oldUnits + 1);
  }
  const after = await (await request.get(`${prefix}/my`)).json();
  expect(after.progress.find((item: { achievementId: string }) => item.achievementId === 'guides-finished').units).toBe(
    oldUnits + 1
  );
  expect(after.awards.some((item: { achievementId: string }) => item.achievementId === 'guides-finished')).toBe(true);
  expect(after.legacy).toEqual([]);
});
