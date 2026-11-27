/**
 * @jest-environment node
 */

/** `add-block` and `add-step` in a guide that ships a translation sidecar stamp ids by the stamp-ids rule (#2393). */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { runAddBlock } from '../commands/add-block';
import { runAddStep, type AddStepInput } from '../commands/add-step';
import { readPackage } from '../utils/package-io';

type Loose = Record<string, any>;

const step = (extra: Loose = {}) => ({ action: 'button', reftarget: 'Save', description: 'Click Save.', ...extra });

describe('add-block and add-step ids in a guide with a translation sidecar', () => {
  let root: string;
  let pkg: string;

  function writeGuide(blocks: Loose[], { sidecar }: { sidecar: boolean }): void {
    fs.writeFileSync(
      path.join(pkg, 'content.json'),
      `${JSON.stringify({ schemaVersion: '1.1.0', id: 'ids-demo', title: 'Ids demo', blocks }, null, 2)}\n`
    );
    if (sidecar) {
      fs.mkdirSync(path.join(pkg, 'i18n'), { recursive: true });
      fs.writeFileSync(path.join(pkg, 'i18n', 'ja.json'), JSON.stringify({ schemaVersion: '1.0.0', language: 'ja' }));
    }
  }

  const blocksOnDisk = () => readPackage(pkg, { mintIds: false }).content.blocks as Loose[];
  const addStep = (args: Partial<AddStepInput>) => runAddStep({ dir: pkg, ...step(), ...args } as AddStepInput);

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'add-ids-'));
    pkg = path.join(root, 'ids-demo');
    fs.mkdirSync(pkg);
    fs.writeFileSync(
      path.join(pkg, 'manifest.json'),
      JSON.stringify({ schemaVersion: '1.1.0', id: 'ids-demo', type: 'guide', repository: 'interactive-tutorials' })
    );
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe('add-block', () => {
    // markdown-2 exists, so the stamp-ids rule picks markdown-1 and the read-time rule markdown-3.
    const existing = [{ type: 'markdown', id: 'markdown-2', content: 'Kept' }];

    it('gives a new translatable block the smallest free <type>-<n> and reports it', async () => {
      writeGuide(existing, { sidecar: true });
      const outcome = await runAddBlock({ dir: pkg, type: 'markdown', fields: { content: 'New' } });

      expect(outcome).toMatchObject({ status: 'ok', data: { id: 'markdown-1' } });
      expect(outcome.status === 'ok' && outcome.summary).toContain('(id: markdown-1)');
      expect(blocksOnDisk().map((block) => block.id)).toEqual(['markdown-2', 'markdown-1']);
    });

    it('keeps the read-time rule in a guide without a sidecar', async () => {
      writeGuide(existing, { sidecar: false });
      const outcome = await runAddBlock({ dir: pkg, type: 'markdown', fields: { content: 'New' } });

      expect(outcome).toMatchObject({ status: 'ok', data: { id: 'markdown-3' } });
    });

    it('uses an explicit id unchanged', async () => {
      writeGuide(existing, { sidecar: true });
      const outcome = await runAddBlock({ dir: pkg, type: 'markdown', id: 'welcome', fields: { content: 'New' } });

      expect(outcome).toMatchObject({ status: 'ok', data: { id: 'welcome' } });
      expect(blocksOnDisk().map((block) => block.id)).toEqual(['markdown-2', 'welcome']);
    });

    it('stamps every id-less translatable block and step in the guide, nested ones included', async () => {
      writeGuide(
        [
          { type: 'section', id: 'intro', title: 'Intro', blocks: [{ type: 'markdown', content: 'Untouched' }] },
          { type: 'multistep', id: 'save', content: 'Save it.', steps: [step()] },
        ],
        { sidecar: true }
      );
      const outcome = await runAddBlock({ dir: pkg, type: 'markdown', parent: 'intro', fields: { content: 'New' } });

      expect(outcome).toMatchObject({ status: 'ok', data: { id: 'markdown-2', idsStamped: 2 } });
      const [intro, save] = blocksOnDisk();
      expect(intro!.blocks.map((block: Loose) => block.id)).toEqual(['markdown-1', 'markdown-2']);
      expect(save!.steps[0].id).toBe('save-step-1');
    });

    it('gives a block type outside the projection table its usual id', async () => {
      writeGuide(existing, { sidecar: true });
      const outcome = await runAddBlock({ dir: pkg, type: 'callout', fields: { title: 'Note', content: 'Text' } });

      expect(outcome).toMatchObject({ status: 'ok', data: { id: 'callout-1' } });
    });

    it('stamps nothing when an --if-absent retry matches an existing block', async () => {
      writeGuide(
        [
          { type: 'markdown', id: 'markdown-1', content: 'New' },
          { type: 'multistep', id: 'save', content: 'Save it.', steps: [step()] },
        ],
        { sidecar: true }
      );
      const outcome = await runAddBlock({ dir: pkg, type: 'markdown', ifAbsent: true, fields: { content: 'New' } });

      expect(outcome).toMatchObject({ status: 'ok', data: { appended: false, id: 'markdown-1' } });
      expect(outcome.status === 'ok' && outcome.data).not.toHaveProperty('idsStamped');
      expect(blocksOnDisk()[1]!.steps[0].id).toBeUndefined();
    });

    it('treats a sidecar that fails to parse as present', async () => {
      writeGuide(existing, { sidecar: true });
      fs.writeFileSync(path.join(pkg, 'i18n', 'ja.json'), '{ not json');
      const outcome = await runAddBlock({ dir: pkg, type: 'markdown', fields: { content: 'New' } });

      expect(outcome).toMatchObject({ status: 'ok', data: { id: 'markdown-1' } });
    });

    it('stamps a new block in a conditional branch and the id-less blocks beside it', async () => {
      writeGuide(
        [
          {
            type: 'conditional',
            id: 'admin-only',
            conditions: ['is-admin'],
            whenTrue: [{ type: 'markdown', content: 'Admin text' }],
            whenFalse: [{ type: 'markdown', content: 'Viewer text' }],
          },
        ],
        { sidecar: true }
      );
      const outcome = await runAddBlock({
        dir: pkg,
        type: 'markdown',
        parent: 'admin-only',
        branch: 'false',
        fields: { content: 'New' },
      });

      expect(outcome).toMatchObject({ status: 'ok', data: { id: 'markdown-3', idsStamped: 2 } });
      const [conditional] = blocksOnDisk();
      expect(conditional!.whenTrue.map((block: Loose) => block.id)).toEqual(['markdown-1']);
      expect(conditional!.whenFalse.map((block: Loose) => block.id)).toEqual(['markdown-2', 'markdown-3']);
    });

    it('leaves the guide untouched when the add is rejected', async () => {
      writeGuide([{ type: 'markdown', content: 'Untouched' }], { sidecar: true });
      const before = fs.readFileSync(path.join(pkg, 'content.json'), 'utf-8');
      const outcome = await runAddBlock({ dir: pkg, type: 'markdown', parent: 'missing', fields: { content: 'New' } });

      expect(outcome.status).toBe('error');
      expect(fs.readFileSync(path.join(pkg, 'content.json'), 'utf-8')).toBe(before);
    });
  });

  describe('add-step', () => {
    it('gives a new step <block-id>-step-<k>, stamps the rest of the guide and reports the id', async () => {
      writeGuide(
        [
          { type: 'section', id: 'intro', title: 'Intro', blocks: [{ type: 'markdown', content: 'Untouched' }] },
          {
            type: 'section',
            id: 'work',
            title: 'Work',
            blocks: [{ type: 'guided', id: 'save', content: 'Save it.', steps: [step()] }],
          },
        ],
        { sidecar: true }
      );
      const outcome = await addStep({ parent: 'save' });

      expect(outcome).toMatchObject({ status: 'ok', data: { id: 'save-step-2', idsStamped: 2 } });
      expect(outcome.status === 'ok' && outcome.summary).toContain('id: save-step-2');
      const [intro, work] = blocksOnDisk();
      expect(intro!.blocks[0].id).toBe('markdown-1');
      expect(work!.blocks[0].steps.map((s: Loose) => s.id)).toEqual(['save-step-1', 'save-step-2']);
    });

    it('uses an explicit step id unchanged', async () => {
      writeGuide([{ type: 'multistep', id: 'save', content: 'Save it.', steps: [] }], { sidecar: true });
      const outcome = await addStep({ parent: 'save', id: 'open-dialog' });

      expect(outcome).toMatchObject({ status: 'ok', data: { id: 'open-dialog' } });
    });

    it('adds no step id and reports none in a guide without a sidecar', async () => {
      writeGuide([{ type: 'multistep', id: 'save', content: 'Save it.', steps: [step()] }], { sidecar: false });
      const outcome = await addStep({ parent: 'save' });

      expect(outcome.status).toBe('ok');
      expect(outcome.status === 'ok' && outcome.data).not.toHaveProperty('id');
      expect(blocksOnDisk()[0]!.steps.map((s: Loose) => s.id)).toEqual([undefined, undefined]);
    });
  });
});
