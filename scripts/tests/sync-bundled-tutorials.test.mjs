import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { syncBundledTutorials } from '../sync-bundled-tutorials.mjs';

function fixture(t) {
  const temp = mkdtempSync(join(tmpdir(), 'tutorial-sync-test-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const source = join(temp, 'source');
  const root = join(temp, 'app');
  const write = (path, data) => {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify(data));
  };
  const content = { id: 'intro', title: 'Intro', blocks: [] };
  const manifest = { id: 'intro', type: 'guide', description: 'Start here' };
  write(join(source, 'intro/content.json'), content);
  write(join(source, 'intro/manifest.json'), manifest);
  write(join(root, 'src/constants/bundled-tutorials.json'), [{ id: 'intro', url: ['/'] }]);
  write(join(root, 'src/bundled-interactives/intro/content.json'), { ...content, title: 'Old title' });
  write(join(root, 'src/bundled-interactives/intro/manifest.json'), manifest);
  write(join(root, 'src/bundled-interactives/index.json'), { interactives: [] });
  write(join(root, 'src/bundled-interactives/repository.json'), {});
  const git = (...args) =>
    execFileSync('git', args, { cwd: source, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init');
  const commit = () => {
    git('add', '.');
    git(
      '-c',
      'user.name=Sync test',
      '-c',
      'user.email=sync@example.test',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'fixture'
    );
    return git('rev-parse', 'HEAD');
  };
  const revision = commit();
  return { root, source, write, commit, revision, validate: () => {} };
}

test('sync is idempotent and ignores unrelated upstream changes', (t) => {
  const f = fixture(t);
  assert.deepEqual(syncBundledTutorials(f.source, f).changed, ['intro']);
  assert.deepEqual(syncBundledTutorials(f.source, f).changed, []);
  const lock = readFileSync(join(f.root, 'src/constants/bundled-tutorials-source.json'), 'utf8');
  f.write(join(f.source, 'unrelated.json'), {});
  f.revision = f.commit();
  assert.deepEqual(syncBundledTutorials(f.source, f).changed, []);
  assert.equal(readFileSync(join(f.root, 'src/constants/bundled-tutorials-source.json'), 'utf8'), lock);
});

test('copies asset and manifest changes and adapts repository provenance', (t) => {
  const f = fixture(t);
  f.write(join(f.source, 'intro/content.json'), {
    id: 'intro',
    title: 'New',
    blocks: [{ type: 'image', src: 'assets/picture.json' }],
  });
  f.write(join(f.source, 'intro/assets/picture.json'), { pixels: 1 });
  f.revision = f.commit();
  syncBundledTutorials(f.source, f);
  assert.equal(
    JSON.parse(readFileSync(join(f.root, 'src/bundled-interactives/intro/manifest.json'))).repository,
    'bundled'
  );
  assert.deepEqual(JSON.parse(readFileSync(join(f.root, 'src/bundled-interactives/intro/assets/picture.json'))), {
    pixels: 1,
  });
});

for (const failure of ['missing', 'asset', 'validation', 'revision']) {
  test(`${failure} failure leaves bundled content unchanged`, (t) => {
    const f = fixture(t);
    const target = join(f.root, 'src/bundled-interactives/intro/content.json');
    const before = readFileSync(target, 'utf8');
    if (failure === 'missing') {
      rmSync(join(f.source, 'intro/content.json'));
    }
    if (failure === 'asset') {
      f.write(join(f.source, 'intro/content.json'), {
        id: 'intro',
        title: 'Intro',
        blocks: [{ src: '../missing.png' }],
      });
    }
    if (failure === 'missing' || failure === 'asset') {
      f.revision = f.commit();
    }
    if (failure === 'validation') {
      f.validate = () => {
        throw new Error('invalid content');
      };
    }
    if (failure === 'revision') {
      f.revision = '0'.repeat(40);
    }
    assert.throws(() => syncBundledTutorials(f.source, f));
    assert.equal(readFileSync(target, 'utf8'), before);
  });
}

test('workflow updates one signed PR and keeps the schedule gated', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/sync-bundled-tutorials.yml', import.meta.url), 'utf8');
  assert.match(workflow, /branch: codex\/sync-bundled-tutorials/);
  assert.match(workflow, /BUNDLED_TUTORIAL_SYNC_ENABLED == 'true'/);
  assert.match(workflow, /sign-commits: true/);
  assert.match(workflow, /grafana\/shared-workflows\/actions\/create-github-app-token@/);
  assert.doesNotMatch(workflow, /private-key:|BUNDLED_TUTORIAL_SYNC_PRIVATE_KEY/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /cron: '17 6 \* \* \*'/);
});

test('restores a missing bundled tutorial and remains idempotent', (t) => {
  const f = fixture(t);
  rmSync(join(f.root, 'src/bundled-interactives/intro'), { recursive: true });
  assert.deepEqual(syncBundledTutorials(f.source, f).changed, ['intro']);
  assert.equal(JSON.parse(readFileSync(join(f.root, 'src/bundled-interactives/intro/content.json'))).title, 'Intro');
  assert.deepEqual(syncBundledTutorials(f.source, f).changed, []);
});
