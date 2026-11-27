/**
 * @jest-environment node
 */

/** `pathfinder-cli stamp-ids`: disk, `--check`, validation, the manifest left alone. */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { ContentJson } from '../../types/package.types';
import { COMMAND_SPECS } from '../commands/manifest';
import { runStampIds, StampIdsCommand } from '../commands/stamp-ids';
import { readPackage, validatePackageState } from '../utils/package-io';

type Loose = Record<string, any>;

function guide(blocks: Loose[]): ContentJson {
  return { schemaVersion: '1.1.0', id: 'stamp-demo', title: 'Stamp demo', blocks } as unknown as ContentJson;
}

function ids(content: ContentJson): unknown[] {
  const out: unknown[] = [];
  const visit = (blocks: Loose[]) => {
    for (const block of blocks) {
      out.push(block.id);
      for (const step of block.steps ?? []) {
        out.push(step.id);
      }
      visit(block.blocks ?? []);
      visit(block.whenTrue ?? []);
      visit(block.whenFalse ?? []);
    }
  };
  visit(content.blocks as Loose[]);
  return out;
}

const md = (extra: Loose = {}) => ({ type: 'markdown', content: 'Some text', ...extra });
const step = (extra: Loose = {}) => ({ action: 'button', reftarget: 'Save', description: 'Click Save.', ...extra });

describe('stamp-ids command', () => {
  let root: string;
  let pkg: string;

  const manifestText = `${JSON.stringify(
    { schemaVersion: '1.1.0', id: 'stamp-demo', type: 'guide', repository: 'interactive-tutorials' },
    null,
    2
  )}\n`;

  function writeGuide(blocks: Loose[]): void {
    fs.writeFileSync(path.join(pkg, 'content.json'), `${JSON.stringify(guide(blocks), null, 2)}\n`);
  }

  const contentText = () => fs.readFileSync(path.join(pkg, 'content.json'), 'utf-8');
  const manifestOnDisk = () => fs.readFileSync(path.join(pkg, 'manifest.json'), 'utf-8');

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-ids-'));
    pkg = path.join(root, 'stamp-demo');
    fs.mkdirSync(pkg);
    fs.writeFileSync(path.join(pkg, 'manifest.json'), manifestText);
    writeGuide([
      md(),
      { type: 'multistep', content: 'Add it.', steps: [step(), step(), step()] },
      { type: 'callout', title: 'Note', content: 'Outside the table.' },
    ]);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('is in the command manifest', () => {
    expect(COMMAND_SPECS.get('stamp-ids')).toBeDefined();
    expect(StampIdsCommand.parse({ dir: 'x' })).toEqual({ dir: 'x', check: false });
  });

  it('writes the stamped ids, leaves other blocks and the manifest alone, and validates', async () => {
    const outcome = await runStampIds({ dir: pkg, check: false });
    expect(outcome.status).toBe('ok');
    const state = readPackage(pkg, { mintIds: false });
    expect(ids(state.content)).toEqual([
      'markdown-1',
      'multistep-1',
      'multistep-1-step-1',
      'multistep-1-step-2',
      'multistep-1-step-3',
      undefined,
    ]);
    expect(manifestOnDisk()).toBe(manifestText);
    expect(validatePackageState(state.content, state.manifest).ok).toBe(true);
  });

  it('gives byte-identical output on a second run and changes nothing on its own output', async () => {
    await runStampIds({ dir: pkg, check: false });
    const afterFirst = contentText();
    const outcome = await runStampIds({ dir: pkg, check: false });
    expect(outcome.status).toBe('ok');
    expect(contentText()).toBe(afterFirst);
  });

  it('--check lists what it would stamp, exits non-zero and writes nothing', async () => {
    const before = contentText();
    const outcome = await runStampIds({ dir: pkg, check: true });
    expect(outcome).toMatchObject({ status: 'error', code: 'IDS_MISSING' });
    expect(outcome.status === 'error' && outcome.message).toContain('multistep-1-step-3');
    expect(contentText()).toBe(before);
  });

  it('--check passes once every id is there', async () => {
    await runStampIds({ dir: pkg, check: false });
    expect((await runStampIds({ dir: pkg, check: true })).status).toBe('ok');
  });

  it('does not mint ids on blocks outside the table when it reads', async () => {
    await runStampIds({ dir: pkg, check: false });
    expect(JSON.parse(contentText()).blocks[2]).not.toHaveProperty('id');
  });

  it('writes nothing when the stamped guide would not validate', async () => {
    writeGuide([md(), { type: 'section', title: 'S', blocks: [{ type: 'section', title: 'Nested', blocks: [md()] }] }]);
    const before = contentText();
    const outcome = await runStampIds({ dir: pkg, check: false });
    expect(outcome.status).toBe('error');
    expect(contentText()).toBe(before);
  });

  it('reports a missing directory', async () => {
    const outcome = await runStampIds({ dir: path.join(root, 'nope'), check: false });
    expect(outcome).toMatchObject({ status: 'error', code: 'NOT_FOUND' });
  });
});
