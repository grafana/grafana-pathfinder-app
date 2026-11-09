import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { checkBundledTutorialPublication } from '../check-bundled-tutorial-publication.mjs';

const title = JSON.parse(
  readFileSync(new URL('../../src/bundled-interactives/first-dashboard/content.json', import.meta.url))
).title;

function published(overrides = {}) {
  return async (url) => {
    const [, , id, file] = url.pathname.split('/');
    return { ok: true, json: async () => ({ id, title, ...overrides[`${id}/${file}`] }) };
  };
}

test('accepts the published migration', async () => {
  await checkBundledTutorialPublication(published());
});

test('rejects a missing RSS package', async () => {
  await assert.rejects(
    checkBundledTutorialPublication(async (url) =>
      url.pathname.includes('first-dashboard-rss') ? { ok: false, status: 404 } : published()(url)
    ),
    /publish interactive-tutorials #714/
  );
});

test('rejects the old RSS content under the dashboard ID', async () => {
  await assert.rejects(
    checkBundledTutorialPublication(
      published({ 'first-dashboard/content.json': { title: 'Make your first dashboard' } })
    ),
    /published title differs/
  );
});

test('rejects a mismatched package identity', async () => {
  await assert.rejects(
    checkBundledTutorialPublication(published({ 'welcome-to-grafana/manifest.json': { id: 'wrong' } })),
    /mismatched package ID/
  );
});
