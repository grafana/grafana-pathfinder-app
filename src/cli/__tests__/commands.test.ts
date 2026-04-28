import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { runAddBlock } from '../commands/add-block';
import { runAddChoice } from '../commands/add-choice';
import { runAddStep } from '../commands/add-step';
import { runCreate } from '../commands/create';
import { runEditBlock } from '../commands/edit-block';
import { runInspect } from '../commands/inspect';
import { runRemoveBlock } from '../commands/remove-block';
import { runSetManifest } from '../commands/set-manifest';
import { readPackage } from '../utils/package-io';
import type { ContentJson } from '../../types/package.types';

// `runX` functions return CommandOutcome objects. We assert on `status`,
// the structured `data` payload, and the resulting on-disk state after each
// call — that's the path the MCP layer (P3) will rely on.

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cli-cmd-test-'));
}

async function bootstrap(opts?: { id?: string }): Promise<string> {
  const dir = path.join(tempDir(), 'pkg');
  const r = await runCreate({
    dir,
    id: opts?.id ?? 'cmd-test-abc123',
    title: 'Cmd Test',
    type: 'guide',
  });
  if (r.status !== 'ok') {
    throw new Error(`bootstrap failed: ${r.message}`);
  }
  return dir;
}

function readContent(dir: string): ContentJson {
  return readPackage(dir).content;
}

// ---------------------------------------------------------------------------
// runCreate
// ---------------------------------------------------------------------------

describe('runCreate', () => {
  it('writes content.json and manifest.json with matching ids', async () => {
    const dir = path.join(tempDir(), 'pkg');
    const result = await runCreate({ dir, id: 'first-test', title: 'First Test', type: 'guide' });
    expect(result.status).toBe('ok');
    expect(fs.existsSync(path.join(dir, 'content.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'manifest.json'))).toBe(true);
    const state = readPackage(dir);
    expect(state.content.id).toBe('first-test');
    expect(state.manifest?.id).toBe('first-test');
  });

  it('rejects a non-empty target directory', async () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'sentinel'), 'x');
    const result = await runCreate({ dir, id: 'first-test', title: 'First Test', type: 'guide' });
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.code).toBe('DIR_NOT_EMPTY');
    }
  });

  it('rejects a non-kebab id', async () => {
    const dir = path.join(tempDir(), 'pkg');
    const result = await runCreate({ dir, id: 'Bad_ID' as unknown as string, title: 'Bad', type: 'guide' });
    expect(result.status).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// runAddBlock
// ---------------------------------------------------------------------------

describe('runAddBlock', () => {
  it('appends a leaf block at the top level with auto-id', async () => {
    const dir = await bootstrap();
    const result = await runAddBlock({
      dir,
      type: 'markdown',
      flagValues: { content: 'Hello' },
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }
    expect(result.data?.id).toBe('markdown-1');
    expect(result.data?.position).toBe('blocks[0]');
    const content = readContent(dir);
    expect(content.blocks).toHaveLength(1);
  });

  it('appends inside a section by --parent', async () => {
    const dir = await bootstrap();
    await runAddBlock({ dir, type: 'section', explicitId: 'intro', flagValues: { title: 'Intro' } });
    const result = await runAddBlock({
      dir,
      type: 'markdown',
      parentId: 'intro',
      flagValues: { content: 'Inside intro' },
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }
    expect(result.data?.position).toBe('blocks[0].blocks[0]');
  });

  it('routes to the right conditional branch with --branch', async () => {
    const dir = await bootstrap();
    await runAddBlock({
      dir,
      type: 'conditional',
      explicitId: 'cond',
      flagValues: { conditions: ['is-admin'] },
    });
    const t = await runAddBlock({
      dir,
      type: 'markdown',
      parentId: 'cond',
      branch: 'true',
      flagValues: { content: 'true branch' },
    });
    const f = await runAddBlock({
      dir,
      type: 'markdown',
      parentId: 'cond',
      branch: 'false',
      flagValues: { content: 'false branch' },
    });
    expect(t.status).toBe('ok');
    expect(f.status).toBe('ok');
    if (t.status === 'ok') {
      expect(t.data?.position).toBe('blocks[0].whenTrue[0]');
    }
    if (f.status === 'ok') {
      expect(f.data?.position).toBe('blocks[0].whenFalse[0]');
    }
  });

  it('rejects a container without --id', async () => {
    const dir = await bootstrap();
    const result = await runAddBlock({ dir, type: 'section', flagValues: { title: 'No id' } });
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.code).toBe('CONTAINER_REQUIRES_ID');
    }
  });

  it('rejects a missing required field with SCHEMA_VALIDATION', async () => {
    const dir = await bootstrap();
    // Markdown requires `content`.
    const result = await runAddBlock({ dir, type: 'markdown', flagValues: {} });
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.code).toBe('SCHEMA_VALIDATION');
    }
  });

  it('--if-absent no-ops when a matching container already exists', async () => {
    const dir = await bootstrap();
    await runAddBlock({ dir, type: 'section', explicitId: 'intro', flagValues: { title: 'Intro' } });
    const result = await runAddBlock({
      dir,
      type: 'section',
      explicitId: 'intro',
      ifAbsent: true,
      flagValues: { title: 'Intro' },
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.data?.appended).toBe(false);
    }
  });

  it('--if-absent reports IF_ABSENT_CONFLICT on scalar mismatch', async () => {
    const dir = await bootstrap();
    await runAddBlock({ dir, type: 'section', explicitId: 'intro', flagValues: { title: 'Intro' } });
    const result = await runAddBlock({
      dir,
      type: 'section',
      explicitId: 'intro',
      ifAbsent: true,
      flagValues: { title: 'Different' },
    });
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.code).toBe('IF_ABSENT_CONFLICT');
    }
  });

  it('rejects an unknown --parent with CONTAINER_NOT_FOUND', async () => {
    const dir = await bootstrap();
    const result = await runAddBlock({
      dir,
      type: 'markdown',
      parentId: 'nope',
      flagValues: { content: 'x' },
    });
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.code).toBe('CONTAINER_NOT_FOUND');
    }
  });
});

// ---------------------------------------------------------------------------
// runAddStep
// ---------------------------------------------------------------------------

describe('runAddStep', () => {
  it('appends a step to a guided block', async () => {
    const dir = await bootstrap();
    await runAddBlock({
      dir,
      type: 'guided',
      explicitId: 'walk',
      flagValues: { content: 'walk' },
    });
    const result = await runAddStep({
      dir,
      parentId: 'walk',
      flagValues: { action: 'button', reftarget: '[data-testid="b"]', description: 'Click' },
    });
    expect(result.status).toBe('ok');
    const content = readContent(dir);
    const guided = content.blocks[0] as { steps: unknown[] };
    expect(guided.steps).toHaveLength(1);
  });

  it('rejects a non-multistep/guided parent', async () => {
    const dir = await bootstrap();
    await runAddBlock({ dir, type: 'section', explicitId: 'intro', flagValues: { title: 'Intro' } });
    const result = await runAddStep({
      dir,
      parentId: 'intro',
      flagValues: { action: 'noop', description: 'x' },
    });
    expect(result.status).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// runAddChoice
// ---------------------------------------------------------------------------

describe('runAddChoice', () => {
  it('appends a choice and rejects duplicate ids', async () => {
    const dir = await bootstrap();
    await runAddBlock({
      dir,
      type: 'quiz',
      explicitId: 'check',
      flagValues: { question: 'Q?' },
    });
    const a = await runAddChoice({
      dir,
      parentId: 'check',
      flagValues: { id: 'a', text: 'A' },
    });
    expect(a.status).toBe('ok');
    const dup = await runAddChoice({
      dir,
      parentId: 'check',
      flagValues: { id: 'a', text: 'duplicate' },
    });
    expect(dup.status).toBe('error');
    if (dup.status === 'error') {
      expect(dup.code).toBe('DUPLICATE_ID');
    }
  });
});

// ---------------------------------------------------------------------------
// runEditBlock
// ---------------------------------------------------------------------------

describe('runEditBlock', () => {
  it('merges scalar fields and replaces arrays', async () => {
    const dir = await bootstrap();
    await runAddBlock({
      dir,
      type: 'interactive',
      flagValues: {
        action: 'navigate',
        reftarget: '[data-testid="x"]',
        content: 'old',
        requirements: ['old-req'],
      },
    });
    const result = await runEditBlock({
      dir,
      id: 'interactive-1',
      flagValues: { content: 'new', requirements: ['new-req'] },
    });
    expect(result.status).toBe('ok');
    const content = readContent(dir);
    const block = content.blocks[0] as unknown as Record<string, unknown>;
    expect(block.content).toBe('new');
    expect(block.requirements).toEqual(['new-req']);
  });

  it('reports BLOCK_NOT_FOUND on a missing id', async () => {
    const dir = await bootstrap();
    const result = await runEditBlock({ dir, id: 'nope', flagValues: { content: 'x' } });
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.code).toBe('BLOCK_NOT_FOUND');
    }
  });

  it('rejects when no flags are passed', async () => {
    const dir = await bootstrap();
    await runAddBlock({ dir, type: 'markdown', flagValues: { content: 'x' } });
    const result = await runEditBlock({ dir, id: 'markdown-1', flagValues: {} });
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.code).toBe('NO_CHANGES');
    }
  });
});

// ---------------------------------------------------------------------------
// runRemoveBlock
// ---------------------------------------------------------------------------

describe('runRemoveBlock', () => {
  it('removes a leaf block', async () => {
    const dir = await bootstrap();
    await runAddBlock({ dir, type: 'markdown', flagValues: { content: 'x' } });
    const result = await runRemoveBlock({ dir, id: 'markdown-1', cascade: false });
    expect(result.status).toBe('ok');
    expect(readContent(dir).blocks).toHaveLength(0);
  });

  it('refuses to remove a non-empty container without --cascade', async () => {
    const dir = await bootstrap();
    await runAddBlock({ dir, type: 'section', explicitId: 'intro', flagValues: { title: 'Intro' } });
    await runAddBlock({ dir, type: 'markdown', parentId: 'intro', flagValues: { content: 'inside' } });
    const result = await runRemoveBlock({ dir, id: 'intro', cascade: false });
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.code).toBe('CONTAINER_HAS_CHILDREN');
    }
  });

  it('cascades through a non-empty container with --cascade', async () => {
    const dir = await bootstrap();
    await runAddBlock({ dir, type: 'section', explicitId: 'intro', flagValues: { title: 'Intro' } });
    await runAddBlock({ dir, type: 'markdown', parentId: 'intro', flagValues: { content: 'inside' } });
    const result = await runRemoveBlock({ dir, id: 'intro', cascade: true });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.data?.childrenRemoved).toBe(1);
    }
    expect(readContent(dir).blocks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// runSetManifest
// ---------------------------------------------------------------------------

describe('runSetManifest', () => {
  it('updates only the supplied fields and preserves the rest', async () => {
    const dir = await bootstrap();
    const result = await runSetManifest({
      dir,
      flagValues: { description: 'Now with description', category: 'demo' },
    });
    expect(result.status).toBe('ok');
    const state = readPackage(dir);
    expect(state.manifest?.description).toBe('Now with description');
    expect(state.manifest?.category).toBe('demo');
    // Unchanged defaults still in place.
    expect(state.manifest?.repository).toBe('interactive-tutorials');
  });

  it('rejects when no field flags are passed', async () => {
    const dir = await bootstrap();
    const result = await runSetManifest({ dir, flagValues: {} });
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.code).toBe('NO_CHANGES');
    }
  });
});

// ---------------------------------------------------------------------------
// runInspect
// ---------------------------------------------------------------------------

describe('runInspect', () => {
  it('returns a package summary', async () => {
    const dir = await bootstrap();
    await runAddBlock({ dir, type: 'section', explicitId: 'intro', flagValues: { title: 'Intro' } });
    await runAddBlock({ dir, type: 'markdown', parentId: 'intro', flagValues: { content: 'x' } });
    const result = runInspect({ dir });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }
    expect(result.data?.id).toBe('cmd-test-abc123');
    expect(result.data?.blockCount).toBe(2);
    expect(result.data?.valid).toBe(true);
  });

  it('returns block details for --block <id>', async () => {
    const dir = await bootstrap();
    await runAddBlock({ dir, type: 'section', explicitId: 'intro', flagValues: { title: 'Intro' } });
    const result = runInspect({ dir, blockId: 'intro' });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }
    expect(result.data?.type).toBe('section');
    expect(result.data?.id).toBe('intro');
  });

  it('reports BLOCK_NOT_FOUND with the available id list', async () => {
    const dir = await bootstrap();
    await runAddBlock({ dir, type: 'section', explicitId: 'intro', flagValues: { title: 'Intro' } });
    const result = runInspect({ dir, blockId: 'nope' });
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.code).toBe('BLOCK_NOT_FOUND');
      expect((result.data?.availableIds as string[]).includes('intro')).toBe(true);
    }
  });
});
