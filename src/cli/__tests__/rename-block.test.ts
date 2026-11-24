import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { runCreate } from '../commands/create';
import { runRenameBlock } from '../commands/rename-block';
import { readPackage } from '../utils/package-io';

const section = (id: string) => ({
  type: 'section',
  id,
  title: 'Setup',
  blocks: [{ type: 'markdown', content: 'Hi' }],
});
const interactive = (fields: Record<string, unknown>) => ({
  type: 'interactive',
  action: 'highlight',
  reftarget: 'button',
  content: 'Click it',
  ...fields,
});

async function writePackage(blocks: unknown[], extra: Record<string, unknown> = {}): Promise<string> {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cli-rename-block-')), 'pkg');
  const created = await runCreate({ dir, id: 'rename-block-test', title: 'Rename block', type: 'guide' });
  if (created.status !== 'ok') {
    throw new Error(`bootstrap failed: ${created.message}`);
  }
  const contentPath = path.join(dir, 'content.json');
  const content = JSON.parse(fs.readFileSync(contentPath, 'utf8'));
  fs.writeFileSync(contentPath, JSON.stringify({ ...content, ...extra, blocks }, null, 2));
  return dir;
}

function snapshot(dir: string): Record<string, string> {
  return Object.fromEntries(fs.readdirSync(dir).map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));
}

describe('runRenameBlock', () => {
  it('renames the block and rewrites every supported reference in one write', async () => {
    const dir = await writePackage([
      section('setup'),
      interactive({
        id: 'next',
        requirements: ['section-completed:setup', 'is-admin'],
        objectives: ['section-completed:section-setup'],
        verify: 'on-page:/explore, section-completed:setup',
      }),
      {
        type: 'multistep',
        content: 'Do it',
        steps: [{ action: 'highlight', reftarget: 'button', requirements: ['section-completed:setup'] }],
      },
      {
        type: 'conditional',
        conditions: ['section-completed:setup'],
        whenTrue: [interactive({ requirements: ['section-completed:setup-extra'] })],
        whenFalse: [{ type: 'markdown', content: 'Not yet' }],
      },
    ]);

    const result = await runRenameBlock({ dir, id: 'setup', newId: 'install' });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }
    expect(result.data?.referencesRewritten).toEqual([
      'blocks[1].requirements[0]',
      'blocks[1].objectives[0]',
      'blocks[1].verify',
      'blocks[2].steps[0].requirements[0]',
      'blocks[3].conditions[0]',
    ]);
    const blocks = readPackage(dir).content.blocks as any[];
    expect(blocks[0].id).toBe('install');
    expect(blocks[1].requirements).toEqual(['section-completed:install', 'is-admin']);
    expect(blocks[1].objectives).toEqual(['section-completed:section-install']);
    expect(blocks[1].verify).toBe('on-page:/explore, section-completed:install');
    expect(blocks[2].steps[0].requirements).toEqual(['section-completed:install']);
    expect(blocks[3].conditions).toEqual(['section-completed:install']);
    expect(blocks[3].whenTrue[0].requirements).toEqual(['section-completed:setup-extra']);
  });

  it('rewrites only the refs the runtime resolves to the renamed block', async () => {
    const dir = await writePackage([
      section('1'),
      section('section-1'),
      interactive({
        id: 'next',
        requirements: ['section-completed:section-1', 'section-completed:section-section-1'],
      }),
    ]);

    const result = await runRenameBlock({ dir, id: 'section-1', newId: 'install' });

    expect(result.status === 'ok' && result.data?.referencesRewritten).toEqual(['blocks[2].requirements[1]']);
    expect((readPackage(dir).content.blocks as any[])[2].requirements).toEqual([
      'section-completed:section-1',
      'section-completed:section-install',
    ]);
  });

  it('writes the prefixed ref when the new id starts with section-', async () => {
    const dir = await writePackage([
      section('setup'),
      interactive({ id: 'next', requirements: ['section-completed:setup'] }),
    ]);

    const result = await runRenameBlock({ dir, id: 'setup', newId: 'section-2' });

    expect(result.status).toBe('ok');
    expect((readPackage(dir).content.blocks as any[])[1].requirements).toEqual(['section-completed:section-section-2']);
  });

  it.each(['a$$b', 'a$&b', 'a$`b', "a$'b", '$1', 'a b'])(
    'writes the id %j into every reference literally',
    async (newId) => {
      const dir = await writePackage([
        section('setup'),
        interactive({
          id: 'next',
          requirements: ['section-completed:setup'],
          objectives: ['section-completed:section-setup'],
          verify: 'is-admin, section-completed:setup',
        }),
      ]);

      const result = await runRenameBlock({ dir, id: 'setup', newId });

      expect(result.status).toBe('ok');
      const blocks = readPackage(dir).content.blocks as any[];
      expect(blocks[0].id).toBe(newId);
      expect(blocks[1].requirements).toEqual([`section-completed:${newId}`]);
      expect(blocks[1].objectives).toEqual([`section-completed:section-${newId}`]);
      expect(blocks[1].verify).toBe(`is-admin, section-completed:${newId}`);
    }
  );

  it('renames a nested block with no references', async () => {
    const dir = await writePackage([
      { type: 'collapsible', id: 'more', title: 'More', blocks: [{ type: 'markdown', id: 'note', content: 'Hi' }] },
    ]);

    const result = await runRenameBlock({ dir, id: 'note', newId: 'aside' });

    expect(result.status).toBe('ok');
    expect((readPackage(dir).content.blocks as any[])[0].blocks[0].id).toBe('aside');
  });

  it('reports no change when the new id equals the old one', async () => {
    const dir = await writePackage([section('setup')]);

    const result = await runRenameBlock({ dir, id: 'setup', newId: 'setup' });

    expect(result.status === 'ok' && result.data).toEqual({ id: 'setup', renamed: false, referencesRewritten: [] });
  });

  describe('leaves every file unchanged when it refuses', () => {
    it.each([
      {
        name: 'the new id is taken',
        blocks: [section('setup'), interactive({ id: 'next' })],
        newId: 'next',
        code: 'DUPLICATE_ID',
      },
      {
        name: 'the old id does not exist',
        blocks: [section('setup')],
        id: 'missing',
        newId: 'install',
        code: 'BLOCK_NOT_FOUND',
      },
      {
        name: 'the new id has a comma',
        blocks: [section('setup'), interactive({ id: 'next', verify: 'section-completed:setup' })],
        newId: 'a,is-admin',
        code: 'INVALID_BLOCK_ID',
      },
      {
        name: 'the new id has edge whitespace',
        blocks: [section('setup'), interactive({ id: 'next', requirements: ['section-completed:setup'] })],
        newId: ' install',
        code: 'INVALID_BLOCK_ID',
      },
      {
        name: 'a compiled locale annotation lists the id',
        blocks: [section('setup')],
        extra: {
          translation: {
            language: 'fr-FR',
            canonicalLanguage: 'en-US',
            canonicalTitle: 'Rename block',
            staleBlockIds: ['setup'],
            fallbackBlockIds: [],
          },
        },
        newId: 'install',
        code: 'UNSUPPORTED_REFERENCE',
      },
      {
        name: 'the package fails validation after the rename',
        blocks: [section('setup'), interactive({ id: 'next', requirements: ['not-a-requirement'] })],
        newId: 'install',
        code: 'SCHEMA_VALIDATION',
      },
    ])('when $name', async ({ blocks, extra, id, newId, code }) => {
      const dir = await writePackage(blocks, extra);
      const before = snapshot(dir);

      const result = await runRenameBlock({ dir, id: id ?? 'setup', newId });

      expect(result.status).toBe('error');
      expect(result.status === 'error' && result.code).toBe(code);
      expect(snapshot(dir)).toEqual(before);
    });
  });
});
