import { createHash } from 'node:crypto';

import { test, expect } from './fixtures';

const resources = '/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/default';

// Mirrors services.AchievementProgressName and AchievementAwardName.
function rowName(kind: 'progress' | 'award', ...parts: string[]) {
  return `achievement-${kind}-${createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 32)}`;
}

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
  const prefix = `${resources}/backend/api/v1/achievements`;
  const definitions = await (await request.get(`${prefix}/definitions`)).json();
  const tiers: Array<{ id: string; at: number }> = definitions.achievements.find(
    (item: { id: string }) => item.id === 'guides-finished'
  ).tiers;
  expect(tiers.length).toBeGreaterThan(1);
  const user = await (await request.get('/api/user')).json();
  const subject = `user:${user.id}`;
  const progressRow = `${resources}/achievementprogresses/${rowName('progress', subject, 'guides-finished')}`;
  const awarded = [];
  for (const tier of tiers) {
    const award = `${resources}/achievementawards/${rowName('award', subject, 'guides-finished', tier.id)}`;
    if ((await request.get(award)).status() === 200) {
      awarded.push(tier.id);
    }
  }
  // Achievement rows cannot be deleted, so reset the persistent user's progress to its awards: each run then writes.
  expect(awarded.length, 'the test user holds every guides-finished award; use a fresh instance').toBeLessThan(
    tiers.length
  );
  const existing = await request.get(progressRow);
  expect([200, 404]).toContain(existing.status());
  const reset = {
    achievementId: 'guides-finished',
    tierIds: awarded,
    units: [],
    points: 0,
    updatedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    userId: subject,
    orgId: user.orgId,
    stackNamespace: 'default',
    schemaVersion: 2,
  };
  if (existing.status() === 200 || awarded.length > 0) {
    const metadata = { name: rowName('progress', subject, 'guides-finished'), namespace: 'default' };
    const body = { apiVersion: 'pathfinderbackend.ext.grafana.app/v1alpha1', kind: 'AchievementProgress', spec: reset };
    const written =
      existing.status() === 200
        ? await request.put(progressRow, {
            data: {
              ...body,
              metadata: { ...metadata, resourceVersion: (await existing.json()).metadata.resourceVersion },
            },
          })
        : await request.post(`${resources}/achievementprogresses`, { data: { ...body, metadata } });
    expect(written.ok(), await written.text()).toBe(true);
  }
  const beforeResponse = await request.get(`${prefix}/my`);
  expect(beforeResponse.status(), await beforeResponse.text()).toBe(200);
  const before = await beforeResponse.json();
  expect(before.capability.available).toBe(true);
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
  const decisions = [];
  for (let retry = 0; retry < 2; retry++) {
    const response = await request.post(`${prefix}/events`, { data: event });
    expect(response.status(), await response.text()).toBe(200);
    const body = await response.json();
    expect(body.retry).toBe(false);
    decisions.push(body.decisions[0]);
  }
  const [first, repeat] = decisions;
  expect(['award', 'tier_up', 'increment']).toContain(first.decision);
  expect(first.reason).toBeUndefined();
  const stored = await (await request.get(progressRow)).json();
  expect(stored.spec).toMatchObject({
    userId: subject,
    units: [expect.any(String)],
    eventIds: [event.eventId],
    points: first.units,
  });
  expect([...stored.spec.tierIds].sort()).toEqual([...awarded, ...first.awarded].sort());
  expect(repeat.decision).toBe('ignored');
  expect(repeat.reason).toBe('duplicate');
  expect(repeat.awarded).toEqual([]);
  expect(repeat.units).toBe(first.units);
  const after = await (await request.get(`${prefix}/my`)).json();
  const progress = after.progress.find((item: { achievementId: string }) => item.achievementId === 'guides-finished');
  expect(progress.units).toBe(first.units);
  expect(progress.next).toBe(first.next);
  expect(after.awards.some((item: { achievementId: string }) => item.achievementId === 'guides-finished')).toBe(true);
  expect(after.legacy).toEqual([]);
});
