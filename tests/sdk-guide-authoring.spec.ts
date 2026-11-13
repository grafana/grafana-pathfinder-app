import { test, expect } from './fixtures';
import { testIds } from '../src/constants/testIds';
import { openBlockEditor, createMarkdownBlock } from './helpers/block-editor.helpers';
import { markComplete } from './helpers/completion.helpers';

test.describe.configure({ mode: 'serial' });

test('OSS SDK guide authoring persists across reload and publishes', async ({ page, request }) => {
  test.setTimeout(120000);
  test.skip(process.env.PATHFINDER_SDK_E2E !== '1', 'Requires the locally registered SDK provider');
  page.setDefaultTimeout(15000);
  const prefix = '/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/default/backend/';
  const title = `SDK authoring ${Date.now()}`;
  await page.addInitScript(() => localStorage.setItem('grafana.openfeature.pathfinder.learning-insights', 'true'));
  const legacyRequests: string[] = [];
  const completionWrites: Array<{ guideId: string; ok: boolean }> = [];
  page.on('response', (response) => {
    if (response.url().endsWith(`${prefix}completion-records`) && response.request().method() === 'POST') {
      completionWrites.push({ guideId: response.request().postDataJSON().guideId, ok: response.ok() });
    }
  });
  page.on('request', (req) => {
    if (req.url().includes('/api/plugins/grafana-pathfinder-app/resources/')) {
      legacyRequests.push(req.url());
    }
  });
  await page.goto('/');
  await openBlockEditor(page);
  await page.getByLabel('Guide title', { exact: true }).fill(title);
  await page.getByLabel('Guide title', { exact: true }).blur();
  await createMarkdownBlock(page, 'Saved through the SDK on OSS.');
  const created = page.waitForResponse(
    (res) => res.url().includes(`${prefix}custom-guide`) && res.request().method() === 'POST'
  );
  await page.getByTestId(testIds.blockEditor.saveDraftButton).click();
  const createResponse = await created;
  expect(createResponse.status()).toBe(201);
  const original = await createResponse.json();
  const name = original.metadata.name;
  const assignmentsUrl = prefix.replace('/backend/', '/assignments');
  const assignmentName = `e2e-${name}`;
  const user = await (await request.get('/api/user')).json();
  try {
    await page.reload();
    await expect(page.getByTestId(testIds.blockEditor.container)).toBeVisible();
    await page.getByTestId(testIds.blockEditor.moreActionsButton).click();
    await page.getByTestId(testIds.blockEditor.libraryButton).click();
    const row = page
      .getByRole('dialog')
      .locator('div')
      .filter({ has: page.getByText(name, { exact: true }) })
      .filter({ has: page.getByRole('button', { name: 'Load', exact: true }) })
      .last();
    await row.getByRole('button', { name: 'Load', exact: true }).click();
    await expect(page.getByLabel('Guide title', { exact: true })).toHaveValue(title);
    await createMarkdownBlock(page, 'Edited after reloading the saved resource.');
    const updated = page.waitForResponse(
      (res) => res.url().includes(`${prefix}custom-guide`) && res.request().method() === 'PUT'
    );
    await page.getByTestId(testIds.blockEditor.saveDraftButton).click();
    expect((await updated).status()).toBe(200);
    const published = page.waitForResponse(
      (res) => res.url().includes(`${prefix}custom-guide`) && res.request().method() === 'PUT'
    );
    await page.getByTestId(testIds.blockEditor.publishButton).click();
    expect((await published).status()).toBe(200);
    const stored = await request.get(`${prefix}custom-guide?name=${encodeURIComponent(name)}`);
    expect(stored.ok()).toBe(true);
    const guide = await stored.json();
    expect(guide.spec.status).toBe('published');
    expect(guide.spec.blocks).toHaveLength(2);
    expect(guide.metadata.resourceVersion).not.toBe(original.metadata.resourceVersion);
    const assignmentBody = {
      data: {
        apiVersion: 'pathfinderbackend.ext.grafana.app/v1alpha1',
        kind: 'Assignment',
        metadata: { name: assignmentName, namespace: 'default' },
        spec: {
          schemaVersion: 1,
          userId: `user:${user.id}`,
          targetType: 'guide',
          targetId: name,
          targetSource: 'app-platform',
          ruleId: 'sdk-e2e',
          assignedAt: new Date().toISOString(),
          lifecycle: 'active',
        },
      },
    };
    await expect(async () => {
      const assigned = await request.post(assignmentsUrl, assignmentBody);
      if (assigned.status() === 409) {
        const existing = await (await request.get(`${assignmentsUrl}/${assignmentName}`)).json();
        expect(existing.spec).toMatchObject(assignmentBody.data.spec);
      } else {
        expect(assigned.ok(), await assigned.text()).toBe(true);
      }
    }).toPass({ intervals: [500, 1000, 2000], timeout: 15000 });
    await page.goto(`/a/grafana-pathfinder-app/fullscreen?doc=${encodeURIComponent(`api:${name}`)}`);
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    if (await page.getByTestId(testIds.markComplete.button).first().isVisible()) {
      await markComplete(page);
    }
    await expect.poll(() => completionWrites.some((write) => write.guideId === name && write.ok)).toBe(true);
    const personal = await request.get(`${prefix}completion-records/my?refresh=1`);
    expect((await personal.json()).completions).toEqual(
      expect.arrayContaining([expect.objectContaining({ guideId: name, guideSource: 'app-platform' })])
    );
    await page.getByRole('button', { name: 'My learning', exact: true }).click();
    const assignments = await request.get(`${prefix}assignments/my`);
    expect((await assignments.json()).assignments).toEqual(
      expect.arrayContaining([expect.objectContaining({ targetId: name, satisfied: true })])
    );
    const persistedAssignment = await (await request.get(`${assignmentsUrl}/${assignmentName}`)).json();
    expect(persistedAssignment.status.satisfied).toBe(true);
    const insights = page.waitForResponse((res) => res.url().includes(`${prefix}learning-insights`));
    await page.goto('/a/grafana-pathfinder-app/learning-insights');
    expect((await insights).ok()).toBe(true);
    expect(legacyRequests).toEqual([]);
  } finally {
    await request.delete(`${assignmentsUrl}/${assignmentName}`);
    const removed = await request.delete(`${prefix}custom-guide?name=${encodeURIComponent(name)}`);
    expect(removed.ok()).toBe(true);
  }
});

test('OSS settings save uses the SDK and survives reload', async ({ page, request }) => {
  test.skip(process.env.PATHFINDER_SDK_E2E !== '1', 'Requires the locally registered SDK provider');
  page.setDefaultTimeout(10000);
  const url = '/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/default/backend/pathfinder-settings';
  const original = await (await request.get(url)).json();
  try {
    await page.goto('/plugins/grafana-pathfinder-app');
    const enabled = page.locator('#pathfinder-enabled');
    await expect(enabled).toBeVisible();
    const wasEnabled = await enabled.isChecked();
    await enabled.setChecked(!wasEnabled, { force: true });
    const saved = page.waitForResponse((res) => res.url().endsWith(url) && res.request().method() === 'PUT');
    await page.getByTestId(testIds.appConfig.submit).click();
    expect((await saved).ok()).toBe(true);
    await page.reload();
    await expect(enabled).toBeChecked({ checked: !wasEnabled });
  } finally {
    const current = await (await request.get(url)).json();
    const restored = await request.put(url, { data: { ...current, spec: original.spec } });
    expect(restored.ok()).toBe(true);
  }
});

test('SDK-only runtime rejects legacy routes and unauthorized resource access', async ({ request, playwright }) => {
  test.skip(process.env.PATHFINDER_SDK_E2E !== '1', 'Requires the locally registered SDK provider');
  const prefix = '/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/default/backend/';
  expect((await request.get(`${prefix}health`)).ok()).toBe(true);
  expect((await request.get('/api/plugins/grafana-pathfinder-app/health')).ok()).toBe(true);
  for (const route of [
    'health',
    'pathfinder-settings',
    'custom-guide-repository',
    'custom-guides',
    'completion-records/my',
    'completion-records/capability',
    'assignments/my',
    'learning-insights',
    'package-recommendations',
  ]) {
    const response = await request.get(`/api/plugins/grafana-pathfinder-app/resources/${route}`);
    expect(response.status()).toBe(500);
    expect(await response.json()).toMatchObject({ messageId: 'plugin.requestFailureError' });
  }
  const legacyWrite = await request.post('/api/plugins/grafana-pathfinder-app/resources/completion-records', {
    data: {},
  });
  expect(legacyWrite.status()).toBe(500);
  expect(await legacyWrite.json()).toMatchObject({ messageId: 'plugin.requestFailureError' });
  const crossNamespace = await request.get(prefix.replace('/default/', '/org-99/') + 'pathfinder-settings');
  expect(crossNamespace.status()).toBe(403);
  const baseURL = process.env.GRAFANA_URL ?? 'http://localhost:3302';
  const anonymous = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  try {
    expect((await anonymous.get(`${prefix}pathfinder-settings`)).status()).toBe(401);
  } finally {
    await anonymous.dispose();
  }
  const login = `sdk-viewer-${Date.now()}`;
  const password = `local-${Date.now()}-Sdk!`;
  const created = await request.post('/api/admin/users', {
    data: { name: 'SDK E2E viewer', email: `${login}@localhost`, login, password },
  });
  expect(created.ok()).toBe(true);
  const { id } = await created.json();
  const viewer = await playwright.request.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
    httpCredentials: { username: login, password, send: 'always' },
  });
  try {
    expect((await request.patch(`/api/org/users/${id}`, { data: { role: 'Viewer' } })).ok()).toBe(true);
    expect((await (await viewer.get('/api/user')).json()).login).toBe(login);
    const settings = await (await request.get(`${prefix}pathfinder-settings`)).json();
    expect((await viewer.put(`${prefix}pathfinder-settings`, { data: settings })).status()).toBe(403);
    const name = `denied-${login}`;
    expect(
      (
        await viewer.post(`${prefix}custom-guide`, {
          data: {
            apiVersion: 'pathfinderbackend.ext.grafana.app/v1alpha1',
            kind: 'InteractiveGuide',
            metadata: { name },
            spec: { id: name, title: 'Denied guide', status: 'draft', schemaVersion: '1.0', blocks: [] },
          },
        })
      ).status()
    ).toBe(403);
    expect((await viewer.get(`${prefix}learning-insights`)).status()).toBe(403);
    const after = await (await request.get(`${prefix}pathfinder-settings`)).json();
    expect(after).toEqual(settings);
    expect((await request.get(`${prefix}custom-guide?name=${name}`)).status()).toBe(404);
  } finally {
    await viewer.dispose();
    expect((await request.delete(`/api/admin/users/${id}`)).ok()).toBe(true);
  }
});
