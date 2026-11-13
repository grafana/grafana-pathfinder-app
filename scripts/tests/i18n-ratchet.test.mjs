import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  changedTranslations,
  compareBaseline,
  flattenCatalog,
  inspectCatalogs,
  pruneBaseline,
} from '../lib/i18n-ratchet.mjs';
import { escapeAnnotation } from '../check-i18n.mjs';

const baseline = (locales, violations) => ({
  version: 1,
  groups: [{ locales, violations, reason: 'Existing debt', tracking: 'pending' }],
});

const inspect = (english, translated, locale = 'pt-BR') =>
  inspectCatalogs({ 'en-US': english, [locale]: translated }).violations.get(locale);

test('catalogs flatten nested keys and reject non-string leaves', () => {
  assert.deepEqual(flattenCatalog({ panel: { title: 'Title' } }), { 'panel.title': 'Title' });
  for (const value of [null, [], 1, true]) {
    assert.throws(() => flattenCatalog({ key: value }), /Invalid catalog/);
  }
  assert.throws(() => flattenCatalog({ 'panel.title': 'First', panel: { title: 'Second' } }), /Duplicate flattened/);
});

test('additions and removals produce exact structural violations', () => {
  assert.deepEqual([...inspect({ added: 'New' }, { removed: 'Old' })], ['missing-key:added', 'obsolete-key:removed']);
});

test('empty placeholders preserve parity but remain advisory', () => {
  const result = inspectCatalogs({ 'en-US': { key: '{{name}}' }, 'pt-BR': { key: '  ' } });
  assert.equal(result.violations.get('pt-BR').size, 0);
  assert.deepEqual(result.empty.get('pt-BR'), ['key']);
});

test('plural requirements use locale categories and accept source forms and explicit zero overrides', () => {
  const english = { items_one: '{{count}} item', items_other: '{{count}} items' };
  assert.equal(inspect(english, { items_other: '{{count}} 件' }, 'ja-JP').size, 0);
  assert.deepEqual([...inspect(english, english)], ['missing-key:items_many']);
  assert.equal(inspect(english, { ...english, items_many: '{{count}} itens', items_zero: '{{count}} itens' }).size, 0);
  assert.ok(inspect(english, { ...english, items_few: '{{count}} 件' }, 'ja-JP').has('obsolete-key:items_few'));
  assert.ok(inspect(english, {}, 'ru-RU').has('missing-key:items_few'));
});

test('removed plural families become obsolete in all forms', () => {
  assert.deepEqual([...inspect({}, { items_many: '{{count}} itens' })], ['obsolete-key:items_many']);
});

test('placeholder names, escaping, and formatters match, regardless of order or repetition', () => {
  assert.equal(inspect({ key: '{{count}} {{- name}}' }, { key: '{{- name}} {{count}} {{count}}' }).size, 0);
  assert.equal(inspect({ key: '{{ value }}' }, { key: '{{value}}' }).size, 0);
  for (const translated of ['{{name}}', '{{- other}}', '{{- name, number}}']) {
    assert.match([...inspect({ key: '{{- name}}' }, { key: translated })][0], /^placeholder-mismatch:key:/);
  }
});

test('ratchet catches replacement debt even when the total count stays unchanged', () => {
  const debt = baseline(['pt-BR'], ['missing-key:old']);
  const actual = new Map([['pt-BR', new Set(['missing-key:new'])]]);
  assert.deepEqual(compareBaseline(actual, debt), {
    added: ['pt-BR: missing-key:new'],
    stale: ['pt-BR: missing-key:old'],
  });
  assert.deepEqual(compareBaseline(new Map(), debt), { added: [], stale: ['pt-BR: missing-key:old'] });
});

test('baseline metadata and duplicate entries are validated', () => {
  const actual = new Map();
  const debt = baseline(['pt-BR'], ['missing-key:key']);
  for (const patch of [
    { reason: '' },
    { tracking: '' },
    { tracking: 'by-design' },
    { violations: ['unknown:key'] },
    { locales: ['pt-BR', 'pt-BR'] },
  ]) {
    assert.throws(() => compareBaseline(actual, { ...debt, groups: [{ ...debt.groups[0], ...patch }] }));
  }
  for (const tracking of ['#1234', 'https://github.com/grafana/grafana-pathfinder-app/issues/1234']) {
    assert.doesNotThrow(() => compareBaseline(actual, { ...debt, groups: [{ ...debt.groups[0], tracking }] }));
  }
});

test('prune splits shared groups, preserves metadata, and never adds exceptions', () => {
  const debt = baseline(['pt-BR', 'de-DE', 'fr-FR'], ['missing-key:a', 'missing-key:b']);
  const actual = new Map([
    ['pt-BR', new Set(['missing-key:b', 'missing-key:new'])],
    ['de-DE', new Set(['missing-key:a', 'missing-key:b'])],
    ['fr-FR', new Set()],
  ]);
  const pruned = pruneBaseline(debt, actual);
  assert.deepEqual(
    pruned.groups.map(({ locales, violations }) => ({ locales, violations })),
    [
      { locales: ['pt-BR'], violations: ['missing-key:b'] },
      { locales: ['de-DE'], violations: ['missing-key:a', 'missing-key:b'] },
    ]
  );
  assert.ok(pruned.groups.every((group) => group.reason === 'Existing debt' && group.tracking === 'pending'));
  assert.deepEqual(compareBaseline(actual, pruned), { added: ['pt-BR: missing-key:new'], stale: [] });
  assert.deepEqual(pruneBaseline(pruned, actual), pruned);
  assert.equal(debt.groups.length, 1);
});

test('English changes warn only for unchanged, nonempty locale values', () => {
  const before = { 'en-US': { key: 'Old' }, 'pt-BR': { key: 'Velho' }, 'de-DE': { key: 'Alt' }, 'fr-FR': { key: '' } };
  const after = {
    'en-US': { key: 'New', added: 'New key' },
    'pt-BR': { key: 'Velho' },
    'de-DE': { key: 'Neu' },
    'fr-FR': { key: '' },
  };
  assert.deepEqual(changedTranslations(before, after), [
    { key: 'key', before: 'Old', after: 'New', locales: ['pt-BR'] },
  ]);
});

test('English plural changes also warn for unchanged locale-specific forms', () => {
  const before = {
    'en-US': { items_other: 'Items' },
    'ja-JP': { items_other: '項目' },
    'pt-BR': { items_many: 'Itens' },
  };
  const after = { ...before, 'en-US': { items_other: 'New items' } };
  assert.deepEqual(changedTranslations(before, after)[0].locales, ['ja-JP', 'pt-BR']);
});

test('GitHub annotation escaping prevents injected workflow commands', () => {
  assert.equal(escapeAnnotation('100%\r\n::error::fake'), '100%25%0D%0A::error::fake');
});

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'i18n-ratchet-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ['scripts/lib', 'src/locales/en-US', 'src/locales/pt-BR']) {
    mkdirSync(path.join(root, dir), { recursive: true });
  }
  for (const file of ['check-i18n.mjs', 'lib/i18n-ratchet.mjs']) {
    copyFileSync(new URL(`../${file}`, import.meta.url), path.join(root, 'scripts', file));
  }
  writeFileSync(
    path.join(root, 'src/locales/i18next-parser.config.js'),
    "module.exports = { locales: ['en-US', 'pt-BR'] };\n"
  );
  const write = (file, value) => writeFileSync(path.join(root, file), `${JSON.stringify(value, null, 2)}\n`);
  const catalog = (locale, value) => write(`src/locales/${locale}/grafana-pathfinder-app.json`, value);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const run = (...args) =>
    spawnSync(process.execPath, ['scripts/check-i18n.mjs', ...args], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_ACTIONS: 'true',
        GITHUB_STEP_SUMMARY: path.join(root, 'summary.md'),
        I18N_BASE_REF: '',
      },
    });
  catalog('en-US', { key: 'Old' });
  catalog('pt-BR', { key: 'Velho' });
  write('src/locales/parity-baseline.json', { version: 1, groups: [] });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  const commit = () => {
    git('add', '.');
    git('commit', '-qm', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  return { root, write, catalog, git, run, commit };
}

test('CLI fails on new debt and stale entries, and pruning cannot hide new debt', (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  f.catalog('en-US', { key: 'Old', added: 'New' });
  assert.equal(f.run().status, 1);
  f.write('src/locales/parity-baseline.json', baseline(['pt-BR'], ['missing-key:added']));
  assert.equal(f.run().status, 0);
  f.catalog('pt-BR', { key: 'Velho', added: '' });
  assert.match(f.run().stdout, /Resolved baseline entry/);
  assert.equal(f.run().status, 1);
  assert.equal(f.run('--prune').status, 0);
  f.catalog('en-US', { key: 'Old', added: 'New', another: 'More' });
  assert.equal(f.run('--prune').status, 1);
});

test('CLI rejects missing catalogs, invalid JSON, and unknown arguments', (t) => {
  const f = fixture(t);
  assert.equal(f.run('--unknown').status, 1);
  rmSync(path.join(f.root, 'src/locales/pt-BR/grafana-pathfinder-app.json'));
  assert.equal(f.run().status, 1);
  writeFileSync(path.join(f.root, 'src/locales/pt-BR/grafana-pathfinder-app.json'), '{');
  assert.equal(f.run().status, 1);
});

test('CI skips unrelated changes and runs for translation or checker changes', (t) => {
  const f = fixture(t);
  const base = f.commit();
  const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const block = workflow.split('      - name: Detect translation changes\n')[1].split('      - if:')[0];
  const script = block.split('        run: |\n')[1].replace(/^ {10}/gm, '');
  const output = path.join(f.root, 'changes-output');
  const detect = (ref) => {
    writeFileSync(output, '');
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
      cwd: f.root,
      encoding: 'utf8',
      env: { ...process.env, CHANGE_BASE: ref, GITHUB_OUTPUT: output },
    });
    assert.equal(result.status, 0, result.stderr);
    return readFileSync(output, 'utf8').trim();
  };
  f.write('unrelated.json', { unrelated: true });
  f.commit();
  assert.equal(detect(base), 'relevant=false');
  assert.equal(detect(''), 'relevant=true');
  assert.equal(detect('0000000000000000000000000000000000000000'), 'relevant=true');
  assert.equal(detect('unavailable-commit'), 'relevant=true');
  for (const file of [
    'src/locales/pt-BR/grafana-pathfinder-app.json',
    'src/locales/parity-baseline.json',
    'scripts/check-i18n.mjs',
    'scripts/lib/i18n-ratchet.mjs',
    'scripts/tests/i18n-ratchet.test.mjs',
    '.github/workflows/ci.yml',
    'package.json',
  ]) {
    f.git('reset', '--hard', base);
    mkdirSync(path.dirname(path.join(f.root, file)), { recursive: true });
    writeFileSync(path.join(f.root, file), 'changed\n');
    f.commit();
    assert.equal(detect(base), 'relevant=true', file);
  }
});

test('CLI summary renders catalog keys and values as literal Markdown code', (t) => {
  const f = fixture(t);
  const key = 'key [review](https://example.invalid) `heading`';
  const before = '[old](https://example.invalid)';
  const after =
    '[review](https://example.invalid) ![image](https://example.invalid/pixel) ' +
    '<img src="https://example.invalid/image"> &amp; | `one` ``two`` ```three```\n# heading';
  f.catalog('en-US', { [key]: before });
  f.catalog('pt-BR', { [key]: 'Tradução' });
  const base = f.commit();
  f.catalog('en-US', { [key]: after });
  const result = f.run('--base', base);
  assert.equal(result.status, 0, result.stderr);
  const summary = readFileSync(path.join(f.root, 'summary.md'), 'utf8');
  assert.ok(summary.includes(`### \`\` ${JSON.stringify(key)} \`\``));
  assert.ok(summary.includes(`- Before: \` ${JSON.stringify(before)} \``));
  assert.ok(summary.includes(`- After: \`\`\`\` ${JSON.stringify(after)} \`\`\`\``));
  assert.ok(!summary.includes('\n# heading'));
});

test('CLI uses the merge base and reports wording changes without failing', (t) => {
  const f = fixture(t);
  const original = f.commit();
  f.catalog('en-US', { key: 'New' });
  f.commit();
  const feature = f.git('rev-parse', 'HEAD');
  f.git('checkout', '-q', '-b', 'base', original);
  f.catalog('pt-BR', { key: 'Novo' });
  const base = f.commit();
  f.git('checkout', '-q', '--detach', feature);
  const result = f.run('--base', base);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /You updated key/);
  const summary = readFileSync(path.join(f.root, 'summary.md'), 'utf8');
  assert.ok(summary.includes('- Before: ` "Old" `'));
  assert.ok(summary.includes('- After: ` "New" `'));
  assert.equal(f.run('--base', 'does-not-exist').status, 1);
});
