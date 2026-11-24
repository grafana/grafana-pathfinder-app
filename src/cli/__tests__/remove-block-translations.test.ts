/**
 * @jest-environment node
 */

/**
 * `remove-block` and the translation sidecars: orphaned entries are listed
 * after a removal, and `--prune-translations` deletes them.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { runRemoveBlock } from '../commands/remove-block';

const failWriteFor = { tag: undefined as string | undefined };

jest.mock('../utils/package-io', () => {
  const actual = jest.requireActual('../utils/package-io');
  return {
    ...actual,
    writePackageSidecar: (dir: string, tag: string, sidecar: unknown) => {
      if (tag === failWriteFor.tag) {
        throw new Error('disk full');
      }
      return actual.writePackageSidecar(dir, tag, sidecar);
    },
  };
});

type Loose = Record<string, any>;

const CONTENT = {
  schemaVersion: '1.1.0',
  id: 'prune-demo',
  title: 'Prune demo',
  blocks: [
    { type: 'markdown', id: 'intro', content: 'Hello' },
    {
      type: 'section',
      id: 'setup',
      title: 'Setup',
      blocks: [
        { type: 'markdown', id: 'tip', content: 'A tip' },
        {
          type: 'multistep',
          id: 'add-panel',
          content: 'Add a panel.',
          steps: [{ id: 'open-menu', action: 'button', reftarget: 'Add', description: 'Open the menu.' }],
        },
      ],
    },
    { type: 'markdown', id: 'outro', content: 'Bye' },
  ],
};

const MANIFEST = { schemaVersion: '1.1.0', id: 'prune-demo', type: 'guide', repository: 'interactive-tutorials' };

const sidecar = (language: string) => ({
  schemaVersion: '1.0.0',
  language,
  blocks: {
    intro: { content: 'intro text' },
    setup: { title: 'setup title' },
    tip: { content: 'tip text' },
    'add-panel': { content: 'panel text', steps: { 'open-menu': { description: 'menu text' } } },
    outro: { content: 'outro text' },
  },
});

let root: string;
let pkg: string;

const sidecarText = (tag: string) => fs.readFileSync(path.join(pkg, 'i18n', `${tag}.json`), 'utf-8');
const sidecarKeys = (tag: string) => Object.keys(JSON.parse(sidecarText(tag)).blocks);
const contentText = () => fs.readFileSync(path.join(pkg, 'content.json'), 'utf-8');
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

function textOf(outcome: Loose): string {
  return outcome.text ?? '';
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'remove-block-translations-'));
  pkg = path.join(root, 'prune-demo');
  fs.mkdirSync(path.join(pkg, 'i18n'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'content.json'), json(CONTENT));
  fs.writeFileSync(path.join(pkg, 'manifest.json'), json(MANIFEST));
  fs.writeFileSync(path.join(pkg, 'i18n', 'ja.json'), json(sidecar('ja')));
  fs.writeFileSync(path.join(pkg, 'i18n', 'ja-JP.json'), json(sidecar('ja-JP')));
});

afterEach(() => {
  failWriteFor.tag = undefined;
  fs.rmSync(root, { recursive: true, force: true });
});

describe('remove-block with translation sidecars', () => {
  it('lists the entry of a removed block in every sidecar and leaves the sidecars alone', async () => {
    const before = [sidecarText('ja'), sidecarText('ja-JP')];
    const outcome = await runRemoveBlock({ dir: pkg, id: 'intro', cascade: false });
    expect(outcome.status).toBe('ok');
    expect(textOf(outcome)).toContain('i18n/ja.json: blocks.intro');
    expect(textOf(outcome)).toContain('i18n/ja-JP.json: blocks.intro');
    expect(textOf(outcome)).not.toContain('blocks.outro');
    expect(outcome).toMatchObject({ details: { 'translation entries orphaned': 2 } });
    expect([sidecarText('ja'), sidecarText('ja-JP')]).toEqual(before);
  });

  it('lists the cascaded children and the step entries under a removed block', async () => {
    const outcome = await runRemoveBlock({ dir: pkg, id: 'setup', cascade: true });
    expect(outcome.status).toBe('ok');
    const lines = textOf(outcome)
      .split('\n')
      .map((line) => line.trim());
    expect(lines).toEqual(
      expect.arrayContaining([
        'i18n/ja.json: blocks.setup',
        'i18n/ja.json: blocks.tip',
        'i18n/ja.json: blocks.add-panel',
        'i18n/ja.json: blocks.add-panel.steps.open-menu',
      ])
    );
    expect(lines.join('\n')).not.toContain('blocks.intro');
  });

  it('keeps the children entries with --orphan-children, because the children still exist', async () => {
    const outcome = await runRemoveBlock({ dir: pkg, id: 'setup', cascade: false, orphanChildren: true });
    expect(outcome.status).toBe('ok');
    expect(textOf(outcome)).toContain('blocks.setup');
    expect(textOf(outcome)).not.toContain('blocks.tip');
    expect(textOf(outcome)).not.toContain('blocks.add-panel');

    const pruned = await runRemoveBlock({ dir: pkg, id: 'tip', cascade: false, pruneTranslations: true });
    expect(pruned.status).toBe('ok');
    expect(sidecarKeys('ja')).toEqual(['intro', 'setup', 'add-panel', 'outro']);
  });

  it('with --prune-translations deletes the entries from every sidecar and says so', async () => {
    const outcome = await runRemoveBlock({ dir: pkg, id: 'setup', cascade: true, pruneTranslations: true });
    expect(outcome.status).toBe('ok');
    expect(textOf(outcome)).toContain('Pruned translation entries');
    expect(outcome).toMatchObject({ details: { 'translation entries pruned': 8 } });
    for (const tag of ['ja', 'ja-JP']) {
      expect(sidecarKeys(tag)).toEqual(['intro', 'outro']);
    }
    expect(JSON.parse(sidecarText('ja')).blocks.intro).toEqual({ content: 'intro text' });
  });

  it('leaves the output alone when no sidecar has an entry for the removed block', async () => {
    fs.writeFileSync(path.join(pkg, 'i18n', 'ja.json'), json({ schemaVersion: '1.0.0', language: 'ja', blocks: {} }));
    fs.rmSync(path.join(pkg, 'i18n', 'ja-JP.json'));
    const outcome = await runRemoveBlock({ dir: pkg, id: 'outro', cascade: false, pruneTranslations: true });
    expect(outcome.status).toBe('ok');
    expect(outcome).not.toHaveProperty('text');
    expect(outcome).not.toHaveProperty('hints');
    expect(JSON.stringify([(outcome as Loose).details, (outcome as Loose).data])).not.toContain('ranslation');
  });

  it('is unchanged in a package without sidecars', async () => {
    fs.rmSync(path.join(pkg, 'i18n'), { recursive: true });
    const outcome = await runRemoveBlock({ dir: pkg, id: 'intro', cascade: false, pruneTranslations: true });
    expect(outcome).toMatchObject({
      status: 'ok',
      details: { type: 'markdown', id: 'intro', 'children removed': 0, 'children orphaned': 0, 'package valid': true },
    });
    expect(outcome).not.toHaveProperty('text');
    expect(outcome).not.toHaveProperty('hints');
    expect(fs.existsSync(path.join(pkg, 'i18n'))).toBe(false);
  });

  it('changes no sidecar when the removal is rejected', async () => {
    const before = [sidecarText('ja'), sidecarText('ja-JP'), contentText()];
    const notEmpty = await runRemoveBlock({ dir: pkg, id: 'setup', cascade: false, pruneTranslations: true });
    expect(notEmpty).toMatchObject({ status: 'error', code: 'CONTAINER_HAS_CHILDREN' });
    const missing = await runRemoveBlock({ dir: pkg, id: 'nope', cascade: false, pruneTranslations: true });
    expect(missing.status).toBe('error');
    expect([sidecarText('ja'), sidecarText('ja-JP'), contentText()]).toEqual(before);
  });

  it('reports a sidecar it cannot write, after the block is already removed', async () => {
    failWriteFor.tag = 'ja-JP';
    const outcome = await runRemoveBlock({ dir: pkg, id: 'intro', cascade: false, pruneTranslations: true });
    expect(outcome).toMatchObject({ status: 'error', code: 'SIDECAR_WRITE_FAILED' });
    expect((outcome as Loose).message).toContain('disk full');
    expect((outcome as Loose).message).toContain('Pruned: ja');
    expect(contentText()).not.toContain('"intro"');
    expect(sidecarKeys('ja')).not.toContain('intro');
    expect(sidecarKeys('ja-JP')).toContain('intro');
  });

  it('says which sidecar it could not read', async () => {
    fs.writeFileSync(path.join(pkg, 'i18n', 'ja-JP.json'), '{ not json');
    const outcome = await runRemoveBlock({ dir: pkg, id: 'intro', cascade: false });
    expect(outcome.status).toBe('ok');
    expect(textOf(outcome)).toContain('i18n/ja.json: blocks.intro');
    expect((outcome as Loose).hints.join(' ')).toContain('i18n/ja-JP.json');
  });
});
