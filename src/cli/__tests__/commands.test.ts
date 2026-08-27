import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { Command } from 'commander';

import { runAddBlock } from '../commands/add-block';
import { runAddChoice } from '../commands/add-choice';
import { runAddStep } from '../commands/add-step';
import { runCreate } from '../commands/create';
import { editBlockSpec, runEditBlock } from '../commands/edit-block';
import { runInspect } from '../commands/inspect';
import { runRemoveBlock } from '../commands/remove-block';
import { runSetManifest, setManifestSpec } from '../commands/set-manifest';
import { runValidate } from '../commands/validate';
import { collectCommanderInput, mountCommander, parseCommandInput } from '../contracts';
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
      fields: { content: 'Hello' },
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

  describe('video src', () => {
    it('accepts a YouTube embed URL', async () => {
      const dir = await bootstrap();
      const result = await runAddBlock({
        dir,
        type: 'video',
        fields: { src: 'https://www.youtube.com/embed/dQw4w9WgXcQ' },
      });
      expect(result.status).toBe('ok');
    });

    it('normalizes a YouTube watch URL to the embed form and emits INPUT_NORMALIZED', async () => {
      const dir = await bootstrap();
      const result = await runAddBlock({
        dir,
        type: 'video',
        fields: { src: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      });
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') {
        return;
      }
      // Issue #2: normalize-on-write replaces the round-tripping error
      // path. The agent sees a soft warning naming the rewrite (so it
      // learns the canonical form) and the block is persisted with the
      // embed URL.
      const warning = result.warnings?.find((w) => w.code === 'INPUT_NORMALIZED');
      expect(warning).toBeDefined();
      expect(warning?.path).toBe('src');
      expect(warning?.message).toContain('https://www.youtube.com/embed/dQw4w9WgXcQ');
      const content = readContent(dir);
      const block = content.blocks[0] as { src?: string };
      expect(block.src).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
    });

    it('normalizes a youtu.be share URL to the embed form', async () => {
      const dir = await bootstrap();
      const result = await runAddBlock({
        dir,
        type: 'video',
        fields: { src: 'https://youtu.be/dQw4w9WgXcQ' },
      });
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') {
        return;
      }
      expect(result.warnings?.some((w) => w.code === 'INPUT_NORMALIZED')).toBe(true);
      const content = readContent(dir);
      const block = content.blocks[0] as { src?: string };
      expect(block.src).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
    });

    it('passes non-YouTube URLs through unchanged (e.g. Vimeo)', async () => {
      const dir = await bootstrap();
      const result = await runAddBlock({
        dir,
        type: 'video',
        fields: { src: 'https://player.vimeo.com/video/12345' },
      });
      expect(result.status).toBe('ok');
    });
  });

  it('appends inside a section by --parent', async () => {
    const dir = await bootstrap();
    await runAddBlock({ dir, type: 'section', id: 'intro', fields: { title: 'Intro' } });
    const result = await runAddBlock({
      dir,
      type: 'markdown',
      parent: 'intro',
      fields: { content: 'Inside intro' },
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
      id: 'cond',
      fields: { conditions: ['is-admin'] },
    });
    const t = await runAddBlock({
      dir,
      type: 'markdown',
      parent: 'cond',
      branch: 'true',
      fields: { content: 'true branch' },
    });
    const f = await runAddBlock({
      dir,
      type: 'markdown',
      parent: 'cond',
      branch: 'false',
      fields: { content: 'false branch' },
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
    const result = await runAddBlock({ dir, type: 'section', fields: { title: 'No id' } });
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.code).toBe('CONTAINER_REQUIRES_ID');
    }
  });

  it('rejects a missing required field with SCHEMA_VALIDATION', async () => {
    const dir = await bootstrap();
    // Markdown requires `content`.
    const result = await runAddBlock({ dir, type: 'markdown', fields: {} });
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.code).toBe('SCHEMA_VALIDATION');
    }
  });

  it('--if-absent no-ops when a matching container already exists', async () => {
    const dir = await bootstrap();
    await runAddBlock({ dir, type: 'section', id: 'intro', fields: { title: 'Intro' } });
    const result = await runAddBlock({
      dir,
      type: 'section',
      id: 'intro',
      ifAbsent: true,
      fields: { title: 'Intro' },
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.data?.appended).toBe(false);
    }
  });

  it('--if-absent reports IF_ABSENT_CONFLICT on scalar mismatch', async () => {
    const dir = await bootstrap();
    await runAddBlock({ dir, type: 'section', id: 'intro', fields: { title: 'Intro' } });
    const result = await runAddBlock({
      dir,
      type: 'section',
      id: 'intro',
      ifAbsent: true,
      fields: { title: 'Different' },
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
      parent: 'nope',
      fields: { content: 'x' },
    });
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.code).toBe('CONTAINER_NOT_FOUND');
    }
  });

  describe('selector warnings (issue #3)', () => {
    it('emits UNVERIFIED_SELECTOR when an interactive block is added with a reftarget', async () => {
      const dir = await bootstrap();
      const result = await runAddBlock({
        dir,
        type: 'interactive',
        fields: { action: 'button', reftarget: '[data-testid="my-btn"]', content: 'Click it' },
      });
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') {
        return;
      }
      const warning = result.warnings?.find((w) => w.code === 'UNVERIFIED_SELECTOR');
      expect(warning).toBeDefined();
      expect(warning?.path).toBe('blocks[0]/reftarget');
    });

    it('does NOT emit UNVERIFIED_SELECTOR for noop interactive blocks (no reftarget written)', async () => {
      const dir = await bootstrap();
      const result = await runAddBlock({
        dir,
        type: 'interactive',
        fields: { action: 'noop', content: 'just look here' },
      });
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') {
        return;
      }
      expect(result.warnings?.some((w) => w.code === 'UNVERIFIED_SELECTOR')).toBeFalsy();
    });

    it('emits UNVERIFIED_SELECTOR on code-block add (reftarget is required for that type)', async () => {
      const dir = await bootstrap();
      const result = await runAddBlock({
        dir,
        type: 'code-block',
        fields: { reftarget: '[data-testid="monaco-editor"]', code: 'SELECT 1', language: 'sql' },
      });
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') {
        return;
      }
      expect(result.warnings?.some((w) => w.code === 'UNVERIFIED_SELECTOR')).toBe(true);
    });

    it('emits UNVERIFIED_SELECTOR from runAddStep when a step writes a reftarget', async () => {
      const dir = await bootstrap();
      await runAddBlock({ dir, type: 'guided', id: 'walk', fields: { content: 'walk' } });
      const result = await runAddStep({
        dir,
        parent: 'walk',
        action: 'button',
        reftarget: '[data-testid="b"]',
        description: 'Click',
      });
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') {
        return;
      }
      const warning = result.warnings?.find((w) => w.code === 'UNVERIFIED_SELECTOR');
      expect(warning).toBeDefined();
      // Path is position-anchored so a reviewer can grep for the exact step.
      expect(warning?.path).toContain('reftarget');
    });

    it('does NOT emit UNVERIFIED_SELECTOR from runAddStep for noop steps', async () => {
      const dir = await bootstrap();
      await runAddBlock({ dir, type: 'multistep', id: 'ms', fields: { content: 'walk' } });
      const result = await runAddStep({ dir, parent: 'ms', action: 'noop', description: 'just look' });
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') {
        return;
      }
      expect(result.warnings?.some((w) => w.code === 'UNVERIFIED_SELECTOR')).toBeFalsy();
    });

    it('emits UNVERIFIED_SELECTOR from runEditBlock when reftarget is changed', async () => {
      const dir = await bootstrap();
      await runAddBlock({
        dir,
        type: 'interactive',
        id: 'click-x',
        fields: { action: 'button', reftarget: '[data-testid="old"]', content: 'Click' },
      });
      const result = await runEditBlock({ dir, id: 'click-x', reftarget: '[data-testid="new"]' });
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') {
        return;
      }
      const warning = result.warnings?.find((w) => w.code === 'UNVERIFIED_SELECTOR');
      expect(warning).toBeDefined();
      // Edits identify the block by id rather than position — the path
      // anchors on the id so a reviewer can find the changed block.
      expect(warning?.path).toBe('<id:click-x>/reftarget');
    });

    it('does NOT emit UNVERIFIED_SELECTOR from runEditBlock when reftarget is unchanged', async () => {
      const dir = await bootstrap();
      await runAddBlock({
        dir,
        type: 'interactive',
        id: 'click-x',
        fields: { action: 'button', reftarget: '[data-testid="old"]', content: 'before' },
      });
      const result = await runEditBlock({ dir, id: 'click-x', content: 'after' });
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') {
        return;
      }
      // The pre-existing reftarget is untouched — the original write was the
      // moment of risk, not this content-only edit. No re-arm.
      expect(result.warnings?.some((w) => w.code === 'UNVERIFIED_SELECTOR')).toBeFalsy();
    });
  });

  describe('composition warnings (issue #8)', () => {
    it('emits MULTISTEP_COMPOSITION_HINT when a multistep block is appended', async () => {
      const dir = await bootstrap();
      const result = await runAddBlock({
        dir,
        type: 'multistep',
        id: 'walk',
        fields: { content: 'walk' },
      });
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') {
        return;
      }
      expect(result.warnings).toEqual([
        {
          code: 'MULTISTEP_COMPOSITION_HINT',
          message: expect.stringMatching(/multistep is for tightly-coupled ordered steps/),
        },
      ]);
    });

    it('does NOT emit MULTISTEP_COMPOSITION_HINT for other block types', async () => {
      const dir = await bootstrap();
      const result = await runAddBlock({
        dir,
        type: 'markdown',
        fields: { content: 'hello' },
      });
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') {
        return;
      }
      expect(result.warnings).toBeUndefined();
    });

    it('does NOT emit MULTISTEP_COMPOSITION_HINT on an --if-absent no-op', async () => {
      const dir = await bootstrap();
      // First call creates the multistep — expected to carry the hint.
      const first = await runAddBlock({
        dir,
        type: 'multistep',
        id: 'walk',
        fields: { content: 'walk' },
      });
      expect(first.status).toBe('ok');
      if (first.status === 'ok') {
        expect(first.warnings?.[0]?.code).toBe('MULTISTEP_COMPOSITION_HINT');
      }
      // Second call is an idempotent no-op — no append happened, so no hint.
      const second = await runAddBlock({
        dir,
        type: 'multistep',
        id: 'walk',
        ifAbsent: true,
        fields: { content: 'walk' },
      });
      expect(second.status).toBe('ok');
      if (second.status === 'ok') {
        expect(second.data?.appended).toBe(false);
        expect(second.warnings).toBeUndefined();
      }
    });
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
      id: 'walk',
      fields: { content: 'walk' },
    });
    const result = await runAddStep({
      dir,
      parent: 'walk',
      action: 'button',
      reftarget: '[data-testid="b"]',
      description: 'Click',
    });
    expect(result.status).toBe('ok');
    const content = readContent(dir);
    const guided = content.blocks[0] as { steps: unknown[] };
    expect(guided.steps).toHaveLength(1);
  });

  it('rejects a non-multistep/guided parent', async () => {
    const dir = await bootstrap();
    await runAddBlock({ dir, type: 'section', id: 'intro', fields: { title: 'Intro' } });
    const result = await runAddStep({ dir, parent: 'intro', action: 'noop', description: 'x' });
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
      id: 'check',
      fields: { question: 'Q?' },
    });
    const a = await runAddChoice({ dir, parent: 'check', id: 'a', text: 'A' });
    expect(a.status).toBe('ok');
    const dup = await runAddChoice({ dir, parent: 'check', id: 'a', text: 'duplicate' });
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
      fields: {
        action: 'navigate',
        reftarget: '[data-testid="x"]',
        content: 'old',
        requirements: ['is-admin'],
      },
    });
    const result = await runEditBlock({
      dir,
      id: 'interactive-1',
      content: 'new',
      requirements: ['is-editor'],
    });
    expect(result.status).toBe('ok');
    const content = readContent(dir);
    const block = content.blocks[0] as unknown as Record<string, unknown>;
    expect(block.content).toBe('new');
    expect(block.requirements).toEqual(['is-editor']);
  });

  it('reports BLOCK_NOT_FOUND on a missing id', async () => {
    const dir = await bootstrap();
    const result = await runEditBlock({ dir, id: 'nope', content: 'x' });
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.code).toBe('BLOCK_NOT_FOUND');
    }
  });

  it('rejects when no flags are passed', async () => {
    const dir = await bootstrap();
    await runAddBlock({ dir, type: 'markdown', fields: { content: 'x' } });
    const result = await runEditBlock({ dir, id: 'markdown-1' });
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.code).toBe('NO_CHANGES');
    }
  });

  // The parameter union means a flag can be valid for the command and meaningless
  // for the block being edited. Dropping those is what lets one command address
  // any block type.
  it('drops parameters the addressed block type does not declare', async () => {
    const dir = await bootstrap();
    await runAddBlock({ dir, type: 'markdown', id: 'md-1', fields: { content: 'x' } });

    const result = await runEditBlock({ dir, id: 'md-1', content: 'y', src: 'https://example.com/i.png' });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }
    expect((result.data as { changed: string[] }).changed).toEqual(['content']);
    const block = readContent(dir).blocks[0] as unknown as Record<string, unknown>;
    expect(block.src).toBeUndefined();
  });

  it('reports NO_CHANGES when every parameter passed belongs to another block type', async () => {
    const dir = await bootstrap();
    await runAddBlock({ dir, type: 'markdown', id: 'md-1', fields: { content: 'x' } });

    const result = await runEditBlock({ dir, id: 'md-1', src: 'https://example.com/i.png' });

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.code).toBe('NO_CHANGES');
    }
  });

  // Declared in order to be refused, in the schema, so both entrypoints answer the
  // same way and name the command that does the job.
  it('refuses reordering and names move-block', () => {
    for (const [param, instead] of [
      ['position', 'to-position'],
      ['before', 'before'],
      ['after', 'after'],
    ] as const) {
      const parsed = parseCommandInput(editBlockSpec, { dir: '/tmp/pkg', id: 'md-1', [param]: 'x' });
      expect(parsed.ok).toBe(false);
      if (parsed.ok) {
        continue;
      }
      expect(parsed.outcome.code).toBe('SCHEMA_VALIDATION');
      expect(parsed.outcome.message).toContain(`move-block <dir> <id> --${instead}`);
    }
  });
});

// ---------------------------------------------------------------------------
// runRemoveBlock
// ---------------------------------------------------------------------------

describe('runRemoveBlock', () => {
  it('removes a leaf block', async () => {
    const dir = await bootstrap();
    await runAddBlock({ dir, type: 'markdown', fields: { content: 'x' } });
    const result = await runRemoveBlock({ dir, id: 'markdown-1', cascade: false });
    expect(result.status).toBe('ok');
    expect(readContent(dir).blocks).toHaveLength(0);
  });

  it('refuses to remove a non-empty container without --cascade', async () => {
    const dir = await bootstrap();
    await runAddBlock({ dir, type: 'section', id: 'intro', fields: { title: 'Intro' } });
    await runAddBlock({ dir, type: 'markdown', parent: 'intro', fields: { content: 'inside' } });
    const result = await runRemoveBlock({ dir, id: 'intro', cascade: false });
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.code).toBe('CONTAINER_HAS_CHILDREN');
    }
  });

  it('cascades through a non-empty container with --cascade', async () => {
    const dir = await bootstrap();
    await runAddBlock({ dir, type: 'section', id: 'intro', fields: { title: 'Intro' } });
    await runAddBlock({ dir, type: 'markdown', parent: 'intro', fields: { content: 'inside' } });
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
    const result = await runSetManifest({ dir, description: 'Now with description', category: 'demo' });
    expect(result.status).toBe('ok');
    const state = readPackage(dir);
    expect(state.manifest?.description).toBe('Now with description');
    expect(state.manifest?.category).toBe('demo');
    // Unchanged defaults still in place.
    expect(state.manifest?.repository).toBe('interactive-tutorials');
  });

  it('rejects when no field flags are passed', async () => {
    const dir = await bootstrap();
    const result = await runSetManifest({ dir });
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.code).toBe('NO_CHANGES');
    }
  });

  // A supplied key is a change, and `[]` is a supplied key. The heuristic this
  // replaces read `[]` as "unset", making a list impossible to clear (§3.2).
  it('clears an array field when sent an empty array', async () => {
    const dir = await bootstrap();
    expect((await runSetManifest({ dir, provides: ['loki-basics'] })).status).toBe('ok');
    expect(readPackage(dir).manifest?.provides).toEqual(['loki-basics']);

    const cleared = await runSetManifest({ dir, provides: [] });
    expect(cleared.status).toBe('ok');
    expect(readPackage(dir).manifest?.provides).toEqual([]);
  });

  // Why that is safe: Commander sets `[]` on every repeatable option it holds, so if
  // those counted as supplied, one `--description` would clear every list on the
  // manifest. They are dropped by option source rather than by value shape.
  it('forwards only the flags the command line actually set', async () => {
    const command = mountCommander(setManifestSpec, { positionals: ['dir'] });
    let raw: Record<string, unknown> | undefined;
    // Replaces the generated action, which would otherwise run the mutation and
    // call process.exit. Commander parsing itself is unchanged.
    command.action(function (this: Command, dirArg: string) {
      raw = collectCommanderInput(['dir'], [dirArg], this.opts(), (name) => this.getOptionValueSource(name));
    });

    await command.parseAsync(['/tmp/pkg', '--description', 'only this'], { from: 'user' });

    expect(raw).toEqual({ dir: '/tmp/pkg', description: 'only this' });
  });
});

// ---------------------------------------------------------------------------
// runInspect
// ---------------------------------------------------------------------------

describe('runInspect', () => {
  it('returns a package summary', async () => {
    const dir = await bootstrap();
    await runAddBlock({ dir, type: 'section', id: 'intro', fields: { title: 'Intro' } });
    await runAddBlock({ dir, type: 'markdown', parent: 'intro', fields: { content: 'x' } });
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
    await runAddBlock({ dir, type: 'section', id: 'intro', fields: { title: 'Intro' } });
    const result = runInspect({ dir, block: 'intro' });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }
    expect(result.data?.type).toBe('section');
    expect(result.data?.id).toBe('intro');
  });

  it('reports BLOCK_NOT_FOUND with the available id list', async () => {
    const dir = await bootstrap();
    await runAddBlock({ dir, type: 'section', id: 'intro', fields: { title: 'Intro' } });
    const result = runInspect({ dir, block: 'nope' });
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.code).toBe('BLOCK_NOT_FOUND');
      expect((result.data?.availableIds as string[]).includes('intro')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// runValidate (in-memory artifact validation, used by the MCP)
// ---------------------------------------------------------------------------

describe('runValidate', () => {
  it('returns ok for a freshly built valid package', async () => {
    const dir = await bootstrap();
    await runAddBlock({ dir, type: 'markdown', fields: { content: 'Hi' } });
    const state = readPackage(dir);
    const result = runValidate({
      content: state.content,
      manifest: state.manifest,
      manifestSchemaVersionAuthored: state.manifestSchemaVersionAuthored,
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.data?.id).toBe('cmd-test-abc123');
      expect(result.data?.blocks).toBe(1);
    }
  });

  it('surfaces structured issues for a broken artifact', () => {
    // Force a content/manifest id mismatch — a cross-file check that
    // validatePackageState flags but a Zod parse on either file alone misses.
    const result = runValidate({
      content: { id: 'one', schemaVersion: '1.1.0', title: 'X', type: 'guide', blocks: [] } as unknown as ContentJson,
      manifest: { id: 'two', schemaVersion: '1.1.0', repository: 'interactive-tutorials' } as unknown as Parameters<
        typeof runValidate
      >[0]['manifest'],
    });
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.code).toBe('SCHEMA_VALIDATION');
      expect(Array.isArray(result.data?.issues)).toBe(true);
    }
  });
});
