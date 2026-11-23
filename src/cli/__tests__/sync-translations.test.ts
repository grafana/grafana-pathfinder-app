/**
 * @jest-environment node
 */

/**
 * Behavioural tests for `pathfinder-cli sync-translations`: disk, git and the
 * outcome envelope. The stamping rules themselves are covered in
 * `src/lib/guide-translation/sync-translations.test.ts`.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { COMMAND_SPECS } from '../commands/manifest';
import { runSyncTranslations, SyncTranslationsCommand } from '../commands/sync-translations';
import type { CommandOutcome } from '../utils/output';

const GOLDEN = path.join(
  __dirname,
  '..',
  '..',
  'lib',
  'guide-translation',
  'fixtures',
  'packages',
  'translation-golden'
);

let root: string;
let pkg: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-translations-'));
  pkg = path.join(root, 'golden');
  fs.cpSync(GOLDEN, pkg, { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

type Mutable = Record<string, any>;

function readSidecar(tag: string, dir = pkg): Mutable {
  return JSON.parse(fs.readFileSync(path.join(dir, 'i18n', `${tag}.json`), 'utf-8'));
}

function writeSidecar(tag: string, value: unknown, dir = pkg): void {
  fs.writeFileSync(path.join(dir, 'i18n', `${tag}.json`), `${JSON.stringify(value, null, 2)}\n`);
}

function rawSidecar(tag: string, dir = pkg): string {
  return fs.readFileSync(path.join(dir, 'i18n', `${tag}.json`), 'utf-8');
}

/** The fixture sidecars as a translator hands them over: no tooling fields. */
function stripTooling(tag: string, dir = pkg): void {
  const sidecar = readSidecar(tag, dir);
  delete sidecar._available;
  for (const entry of [sidecar.guide, sidecar.manifest, ...Object.values<Mutable>(sidecar.blocks ?? {})]) {
    delete entry?._sourceHash;
    delete entry?._reviewHash;
  }
  writeSidecar(tag, sidecar, dir);
}

function run(
  args: Partial<{ dir: string; locale: string; accept: string[]; check: boolean }> = {}
): Promise<CommandOutcome> {
  return Promise.resolve(runSyncTranslations(SyncTranslationsCommand.parse({ dir: pkg, ...args })));
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args],
    {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  ).trim();
}

function initRepo(dir: string): void {
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
}

function ok(outcome: CommandOutcome): Extract<CommandOutcome, { status: 'ok' }> {
  if (outcome.status !== 'ok') {
    throw new Error(`expected ok, got ${outcome.code}: ${outcome.message}`);
  }
  return outcome;
}

function failed(outcome: CommandOutcome): Extract<CommandOutcome, { status: 'error' }> {
  if (outcome.status !== 'error') {
    throw new Error(`expected an error, got ok: ${outcome.summary}`);
  }
  return outcome;
}

describe('registration', () => {
  it('is in the command manifest', () => {
    expect(COMMAND_SPECS.get('sync-translations')?.name).toBe('sync-translations');
  });
});

describe('a plain run', () => {
  it('stamps the tooling fields a translator left out, and a second run writes nothing', async () => {
    stripTooling('ja');
    stripTooling('ja-JP');
    const committedJa = fs.readFileSync(path.join(GOLDEN, 'i18n', 'ja.json'), 'utf-8');
    const committedJaJP = fs.readFileSync(path.join(GOLDEN, 'i18n', 'ja-JP.json'), 'utf-8');

    const first = ok(await run());
    expect(first.summary).toMatch(/^Wrote \d+ change\(s\) to 2 sidecar\(s\)$/);
    expect(rawSidecar('ja')).toBe(committedJa);
    expect(rawSidecar('ja-JP')).toBe(committedJaJP);

    const before = fs.statSync(path.join(pkg, 'i18n', 'ja.json')).mtimeMs;
    const second = ok(await run());
    expect(second.summary).toMatch(/nothing written/);
    expect(fs.statSync(path.join(pkg, 'i18n', 'ja.json')).mtimeMs).toBe(before);
  });

  it('writes two-space JSON with a trailing newline and keeps the file key order', async () => {
    stripTooling('ja');
    await run({ locale: 'ja' });
    const text = rawSidecar('ja');
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toBe(`${JSON.stringify(JSON.parse(text), null, 2)}\n`);
    expect(Object.keys(JSON.parse(text))).toEqual([
      'schemaVersion',
      'language',
      'guide',
      'manifest',
      'blocks',
      '_available',
    ]);
  });

  it('never re-stamps an entry whose English changed, and says it is stale', async () => {
    const content = JSON.parse(fs.readFileSync(path.join(pkg, 'content.json'), 'utf-8'));
    content.blocks[0].content = 'Rewritten English.';
    fs.writeFileSync(path.join(pkg, 'content.json'), `${JSON.stringify(content, null, 2)}\n`);
    const before = rawSidecar('ja');

    const outcome = ok(await run());

    expect(rawSidecar('ja')).toBe(before);
    expect(outcome.summary).toMatch(/nothing written/);
    expect(JSON.stringify(outcome.data?.stale)).toContain(content.blocks[0].id);
  });

  it('reports a lapsed review and leaves its hash alone', async () => {
    const sidecar = readSidecar('ja');
    sidecar.blocks.intro.content = '書き換えた本文。';
    writeSidecar('ja', sidecar);
    const outcome = ok(await run());
    expect(readSidecar('ja').blocks.intro._reviewHash).toBe(sidecar.blocks.intro._reviewHash);
    expect(outcome.data?.reviewLapsed).toEqual({ ja: ['intro'], 'ja-JP': [] });
  });

  it('succeeds with nothing to do for a package with no sidecars', async () => {
    fs.rmSync(path.join(pkg, 'i18n'), { recursive: true });
    expect(ok(await run()).summary).toMatch(/No translation sidecars/);
  });
});

describe('--check', () => {
  it('exits non-zero, lists what it would write, and writes nothing', async () => {
    stripTooling('ja');
    const before = rawSidecar('ja');
    const outcome = failed(await run({ check: true }));
    expect(outcome.code).toBe('TRANSLATIONS_OUT_OF_SYNC');
    expect(outcome.message).toContain('i18n/ja.json: _sourceHash intro');
    expect(outcome.message).toContain('i18n/ja.json: _reviewHash intro');
    expect(outcome.message).toContain('i18n/ja.json: _available: true');
    expect(rawSidecar('ja')).toBe(before);
  });

  it('succeeds when nothing would change', async () => {
    expect(ok(await run({ check: true })).summary).toMatch(/in sync/);
  });
});

describe('--accept', () => {
  async function staleIntro(): Promise<void> {
    const content = JSON.parse(fs.readFileSync(path.join(pkg, 'content.json'), 'utf-8'));
    content.blocks[0].content = 'Rewritten English.';
    content.title = 'A new title';
    fs.writeFileSync(path.join(pkg, 'content.json'), `${JSON.stringify(content, null, 2)}\n`);
  }

  it('re-stamps only the named entries of the named locale', async () => {
    await staleIntro();
    const before = readSidecar('ja');
    ok(await run({ locale: 'ja', accept: ['intro'] }));
    const after = readSidecar('ja');
    expect(after.blocks.intro._sourceHash).not.toBe(before.blocks.intro._sourceHash);
    expect(after.guide._sourceHash).toBe(before.guide._sourceHash);
    ok(await run({ locale: 'ja', accept: ['guide'] }));
    expect(readSidecar('ja').guide._sourceHash).not.toBe(before.guide._sourceHash);
  });

  it('keeps a lapsed review lapsed after a translator accepts an edited translation', async () => {
    await staleIntro();
    const sidecar = readSidecar('ja');
    const reviewHash = sidecar.blocks.intro._reviewHash;
    sidecar.blocks.intro.content = '書き換えた本文。';
    writeSidecar('ja', sidecar);
    const outcome = ok(await run({ locale: 'ja', accept: ['intro'] }));
    expect(readSidecar('ja').blocks.intro._reviewHash).toBe(reviewHash);
    expect((outcome.data as Mutable).reviewLapsed.ja).toEqual(['intro']);
    expect((outcome.data as Mutable).stale.ja).not.toContain('intro');
  });

  it('requires --locale', async () => {
    const outcome = failed(await run({ accept: ['intro'] }));
    expect(outcome.code).toBe('INVALID_OPTIONS');
  });

  it('refuses an entry the sidecar does not have, and writes nothing', async () => {
    stripTooling('ja');
    const before = rawSidecar('ja');
    const outcome = failed(await run({ locale: 'ja', accept: ['nowhere'] }));
    expect(outcome.code).toBe('INVALID_OPTIONS');
    expect(outcome.message).toContain('ja: nowhere');
    expect(rawSidecar('ja')).toBe(before);
  });

  it('refuses a locale that has no sidecar', async () => {
    expect(failed(await run({ locale: 'fr' })).code).toBe('NOT_FOUND');
  });
});

describe('unreadable input', () => {
  it('refuses to sync when a sidecar cannot be read, and writes nothing', async () => {
    stripTooling('ja');
    const before = rawSidecar('ja');
    fs.writeFileSync(path.join(pkg, 'i18n', 'ja-JP.json'), '{ not json');
    const outcome = failed(await run());
    expect(outcome.code).toBe('SIDECAR_UNREADABLE');
    expect(rawSidecar('ja')).toBe(before);
  });

  it('reports a missing package directory', async () => {
    expect(failed(await run({ dir: path.join(root, 'missing') })).code).toBe('NOT_FOUND');
  });
});

describe('baseRef', () => {
  it('records the commit that last changed content.json and its repository-relative path', async () => {
    const repo = path.join(root, 'repo');
    fs.mkdirSync(path.join(repo, 'guides'), { recursive: true });
    fs.renameSync(pkg, path.join(repo, 'guides', 'golden'));
    pkg = path.join(repo, 'guides', 'golden');
    initRepo(repo);
    const commit = git(repo, 'rev-parse', 'HEAD');
    fs.writeFileSync(path.join(repo, 'unrelated.txt'), 'later\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'unrelated');

    ok(await run());

    expect(readSidecar('ja').baseRef).toEqual({ commit, path: 'guides/golden/content.json' });
    expect(Object.keys(readSidecar('ja')).slice(0, 3)).toEqual(['schemaVersion', 'language', 'baseRef']);
    expect(ok(await run()).summary).toMatch(/nothing written/);
  });

  it('is left unchanged while an entry is stale, so a partial retranslation does not advance it', async () => {
    initRepo(root);
    ok(await run());
    const held = readSidecar('ja').baseRef;
    const content = JSON.parse(fs.readFileSync(path.join(pkg, 'content.json'), 'utf-8'));
    content.blocks[0].content = 'Rewritten English.';
    fs.writeFileSync(path.join(pkg, 'content.json'), `${JSON.stringify(content, null, 2)}\n`);
    git(root, 'commit', '-q', '-am', 'edit english');

    ok(await run());
    expect(readSidecar('ja').baseRef).toEqual(held);

    ok(await run({ locale: 'ja', accept: ['intro'] }));
    expect(readSidecar('ja').baseRef).not.toEqual(held);
  });

  it('is left absent, with a note, outside a git repository', async () => {
    const outcome = ok(await run());
    expect(readSidecar('ja').baseRef).toBeUndefined();
    expect(outcome.hints?.join('\n')).toContain('baseRef not advanced');
  });

  it('is left absent while content.json has uncommitted changes', async () => {
    initRepo(root);
    fs.appendFileSync(path.join(pkg, 'content.json'), '\n');
    const outcome = ok(await run());
    expect(readSidecar('ja').baseRef).toBeUndefined();
    expect(outcome.hints?.join('\n')).toContain('uncommitted');
  });

  it('is left absent, with a note, in a shallow clone', async () => {
    const source = path.join(root, 'source');
    fs.mkdirSync(source);
    fs.cpSync(pkg, path.join(source, 'golden'), { recursive: true });
    initRepo(source);
    fs.appendFileSync(path.join(source, 'golden', 'README.md'), 'second commit\n');
    git(source, 'add', '-A');
    git(source, 'commit', '-q', '-m', 'second');
    const clone = path.join(root, 'clone');
    git(root, 'clone', '-q', '--depth', '1', `file://${source}`, clone);

    const outcome = ok(await run({ dir: path.join(clone, 'golden') }));

    expect(readSidecar('ja', path.join(clone, 'golden')).baseRef).toBeUndefined();
    expect(outcome.hints?.join('\n')).toContain('shallow');
  });
});
