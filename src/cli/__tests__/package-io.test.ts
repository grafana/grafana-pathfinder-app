import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type {
  JsonBlock,
  JsonGuidedBlock,
  JsonInteractiveBlock,
  JsonMultistepBlock,
  JsonQuizBlock,
  JsonSectionBlock,
  JsonStep,
} from '../../types/json-guide.types';
import type { ContentJson, ManifestJson } from '../../types/package.types';
import {
  appendBlock,
  appendChoice,
  appendStep,
  collectAllIds,
  editBlock,
  findBlockById,
  findContainerById,
  mutateAndValidate,
  newPackageState,
  nextAutoBlockId,
  PackageIOError,
  readPackage,
  removeBlock,
  validatePackageState,
  writePackage,
  walkBlocks,
} from '../utils/package-io';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pathfinder-cli-'));
}

function writeBundle(dir: string, content: ContentJson, manifest?: ManifestJson): void {
  fs.writeFileSync(path.join(dir, 'content.json'), JSON.stringify(content, null, 2) + '\n');
  if (manifest) {
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  }
}

function baseContent(blocks: JsonBlock[] = []): ContentJson {
  return { schemaVersion: '1.1.0', id: 'unit-test-guide', title: 'Unit Test Guide', blocks };
}

function baseManifest(): ManifestJson {
  // Cast through unknown — same coupling pattern as production code; the test
  // doesn't care about the inferred-vs-declared block array divergence.
  return {
    schemaVersion: '1.1.0',
    id: 'unit-test-guide',
    type: 'guide',
    repository: 'interactive-tutorials',
    language: 'en',
    startingLocation: '/',
    depends: [],
    recommends: [],
    suggests: [],
    provides: [],
    conflicts: [],
    replaces: [],
    testEnvironment: { tier: 'cloud' },
  } as ManifestJson;
}

const markdown = (id?: string): JsonBlock => ({ type: 'markdown', content: 'hi', ...(id ? { id } : {}) });
const interactiveBlock = (overrides: Partial<JsonInteractiveBlock> = {}): JsonInteractiveBlock => ({
  type: 'interactive',
  action: 'navigate',
  reftarget: '[data-testid="x"]',
  content: 'click',
  ...overrides,
});
const section = (id: string, blocks: JsonBlock[] = []): JsonSectionBlock => ({ type: 'section', id, blocks });
const multistep = (id: string, steps: JsonStep[] = []): JsonMultistepBlock => ({
  type: 'multistep',
  id,
  content: 'step block',
  steps: steps.length > 0 ? steps : [{ action: 'noop' }],
});
const guided = (id: string, steps: JsonStep[] = []): JsonGuidedBlock => ({
  type: 'guided',
  id,
  content: 'guided block',
  steps: steps.length > 0 ? steps : [{ action: 'noop' }],
});
const quiz = (id: string, choices: JsonQuizBlock['choices'] = []): JsonQuizBlock => ({
  type: 'quiz',
  id,
  question: 'q?',
  choices: choices.length > 0 ? choices : [{ id: 'a', text: 'A' }],
});

// ---------------------------------------------------------------------------
// Disk I/O round-trip
// ---------------------------------------------------------------------------

describe('readPackage / writePackage', () => {
  it('reads and re-writes a package without altering field values', () => {
    const dir = makeTempDir();
    try {
      const content = baseContent([markdown('m1')]);
      const manifest = baseManifest();
      writeBundle(dir, content, manifest);

      const loaded = readPackage(dir);
      expect(loaded.content.id).toBe('unit-test-guide');
      expect(loaded.content.blocks).toHaveLength(1);
      expect(loaded.manifest?.id).toBe('unit-test-guide');

      writePackage(dir, loaded);
      const reread = readPackage(dir);
      expect(reread.content).toEqual(loaded.content);
      expect(reread.manifest).toEqual(loaded.manifest);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('tolerates missing manifest.json', () => {
    const dir = makeTempDir();
    try {
      writeBundle(dir, baseContent());
      const loaded = readPackage(dir);
      expect(loaded.manifest).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws NOT_FOUND for a non-existent directory', () => {
    expect(() => readPackage('/nonexistent-pathfinder-cli-test-dir')).toThrow(PackageIOError);
  });

  it('throws CONTENT_MISSING when content.json is absent', () => {
    const dir = makeTempDir();
    try {
      try {
        readPackage(dir);
      } catch (err) {
        expect(err).toBeInstanceOf(PackageIOError);
        expect((err as PackageIOError).code).toBe('CONTENT_MISSING');
        return;
      }
      throw new Error('expected throw');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws SCHEMA_VALIDATION on a non-kebab content id', () => {
    const dir = makeTempDir();
    try {
      fs.writeFileSync(path.join(dir, 'content.json'), JSON.stringify({ id: 'Bad_ID', title: 't', blocks: [] }));
      try {
        readPackage(dir);
      } catch (err) {
        expect(err).toBeInstanceOf(PackageIOError);
        expect((err as PackageIOError).code).toBe('SCHEMA_VALIDATION');
        return;
      }
      throw new Error('expected throw');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes files with trailing newline for stable diffs', () => {
    const dir = makeTempDir();
    try {
      writePackage(dir, { content: baseContent(), manifest: baseManifest() });
      const raw = fs.readFileSync(path.join(dir, 'content.json'), 'utf-8');
      expect(raw.endsWith('\n')).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Tree traversal
// ---------------------------------------------------------------------------

describe('walkBlocks / findBlockById / findContainerById / collectAllIds', () => {
  it('walks nested containers depth-first', () => {
    const content = baseContent([
      markdown('m1'),
      section('intro', [markdown('m2'), section('inner', [markdown('m3')])]),
    ]);
    const seen: string[] = [];
    for (const { block } of walkBlocks(content)) {
      if (typeof block.id === 'string') {
        seen.push(block.id);
      }
    }
    expect(seen).toEqual(['m1', 'intro', 'm2', 'inner', 'm3']);
  });

  it('walks both branches of a conditional', () => {
    const content = baseContent([
      {
        type: 'conditional',
        id: 'cond',
        conditions: ['is-admin'],
        whenTrue: [markdown('a')],
        whenFalse: [markdown('b')],
      },
    ]);
    const seen: string[] = [];
    for (const { block } of walkBlocks(content)) {
      if (typeof block.id === 'string') {
        seen.push(block.id);
      }
    }
    expect(seen).toEqual(['cond', 'a', 'b']);
  });

  it('findBlockById returns null when no match', () => {
    expect(findBlockById(baseContent([markdown('m1')]), 'missing')).toBeNull();
  });

  it('findContainerById throws when id matches a leaf', () => {
    const content = baseContent([markdown('m1')]);
    try {
      findContainerById(content, 'm1');
    } catch (err) {
      expect((err as PackageIOError).code).toBe('PARENT_NOT_CONTAINER');
      return;
    }
    throw new Error('expected throw');
  });

  it('findContainerById throws CONTAINER_NOT_FOUND on missing id', () => {
    try {
      findContainerById(baseContent(), 'nope');
    } catch (err) {
      expect((err as PackageIOError).code).toBe('CONTAINER_NOT_FOUND');
      return;
    }
    throw new Error('expected throw');
  });

  it('collectAllIds aggregates ids from leaves and containers', () => {
    const content = baseContent([markdown('m1'), section('intro', [markdown('m2')])]);
    expect(collectAllIds(content)).toEqual(new Set(['m1', 'intro', 'm2']));
  });
});

// ---------------------------------------------------------------------------
// nextAutoBlockId
// ---------------------------------------------------------------------------

describe('nextAutoBlockId', () => {
  it('returns markdown-1 for an empty guide', () => {
    expect(nextAutoBlockId(baseContent(), 'markdown')).toBe('markdown-1');
  });

  it('increments past the largest matching counter', () => {
    const content = baseContent([markdown('markdown-1'), markdown('markdown-3')]);
    expect(nextAutoBlockId(content, 'markdown')).toBe('markdown-4');
  });

  it('counts per-type', () => {
    const content = baseContent([markdown('markdown-2'), interactiveBlock({ id: 'interactive-1' })]);
    expect(nextAutoBlockId(content, 'markdown')).toBe('markdown-3');
    expect(nextAutoBlockId(content, 'interactive')).toBe('interactive-2');
  });

  it('ignores ids that share a prefix but have non-numeric tails', () => {
    const content = baseContent([markdown('markdown-intro'), markdown('markdown-2')]);
    expect(nextAutoBlockId(content, 'markdown')).toBe('markdown-3');
  });
});

// ---------------------------------------------------------------------------
// Mutators: appendBlock
// ---------------------------------------------------------------------------

describe('appendBlock', () => {
  it('appends a leaf block to the top level and auto-assigns an id', () => {
    const content = baseContent();
    const result = appendBlock(content, markdown());
    expect(result.appended).toBe(true);
    expect(result.id).toBe('markdown-1');
    expect(result.position).toBe('blocks[0]');
    expect(content.blocks).toHaveLength(1);
  });

  it('appends to a section by parentId', () => {
    const content = baseContent([section('intro')]);
    const result = appendBlock(content, markdown(), { parentId: 'intro' });
    expect(result.position).toBe('blocks[0].blocks[0]');
    expect((content.blocks[0] as JsonSectionBlock).blocks).toHaveLength(1);
  });

  it('rejects an unrecognized parent id', () => {
    try {
      appendBlock(baseContent(), markdown(), { parentId: 'nope' });
    } catch (err) {
      expect((err as PackageIOError).code).toBe('CONTAINER_NOT_FOUND');
      return;
    }
    throw new Error('expected throw');
  });

  it('rejects appending into a multistep parent (steps go through add-step)', () => {
    const content = baseContent([multistep('ms1')]);
    try {
      appendBlock(content, markdown(), { parentId: 'ms1' });
    } catch (err) {
      expect((err as PackageIOError).code).toBe('WRONG_PARENT_KIND');
      return;
    }
    throw new Error('expected throw');
  });

  it('requires --branch when parent is a conditional', () => {
    const content = baseContent([
      {
        type: 'conditional',
        id: 'cond',
        conditions: ['is-admin'],
        whenTrue: [],
        whenFalse: [],
      },
    ]);
    try {
      appendBlock(content, markdown(), { parentId: 'cond' });
    } catch (err) {
      expect((err as PackageIOError).code).toBe('BRANCH_REQUIRED');
      return;
    }
    throw new Error('expected throw');
  });

  it('routes to the right conditional branch', () => {
    const content = baseContent([
      {
        type: 'conditional',
        id: 'cond',
        conditions: ['is-admin'],
        whenTrue: [],
        whenFalse: [],
      },
    ]);
    const r1 = appendBlock(content, markdown(), { parentId: 'cond', branch: 'true' });
    const r2 = appendBlock(content, markdown(), { parentId: 'cond', branch: 'false' });
    expect(r1.position).toBe('blocks[0].whenTrue[0]');
    expect(r2.position).toBe('blocks[0].whenFalse[0]');
  });

  it('rejects a duplicate id', () => {
    const content = baseContent([markdown('m1')]);
    try {
      appendBlock(content, markdown('m1'));
    } catch (err) {
      expect((err as PackageIOError).code).toBe('DUPLICATE_ID');
      return;
    }
    throw new Error('expected throw');
  });

  it('requires --id for container types', () => {
    const content = baseContent();
    try {
      appendBlock(content, { type: 'section', blocks: [] } as unknown as JsonBlock);
    } catch (err) {
      expect((err as PackageIOError).code).toBe('CONTAINER_REQUIRES_ID');
      return;
    }
    throw new Error('expected throw');
  });
});

describe('appendBlock --if-absent', () => {
  it('no-ops on an existing matching container', () => {
    const content = baseContent([section('intro', [markdown('m1')])]);
    const result = appendBlock(content, section('intro'), { ifAbsent: true });
    expect(result.appended).toBe(false);
    expect(result.id).toBe('intro');
    // Existing children are preserved.
    expect((content.blocks[0] as JsonSectionBlock).blocks).toHaveLength(1);
  });

  it('reports IF_ABSENT_CONFLICT on scalar mismatch', () => {
    const content = baseContent([section('intro', [])]);
    (content.blocks[0] as JsonSectionBlock).title = 'Intro';
    try {
      appendBlock(content, { ...section('intro'), title: 'Different' }, { ifAbsent: true });
    } catch (err) {
      expect((err as PackageIOError).code).toBe('IF_ABSENT_CONFLICT');
      return;
    }
    throw new Error('expected throw');
  });

  it('creates a new block when --if-absent matches nothing', () => {
    const content = baseContent();
    const result = appendBlock(content, section('intro'), { ifAbsent: true });
    expect(result.appended).toBe(true);
    expect(result.id).toBe('intro');
  });
});

// ---------------------------------------------------------------------------
// Mutators: appendStep / appendChoice
// ---------------------------------------------------------------------------

describe('appendStep', () => {
  it('appends to a multistep block', () => {
    const content = baseContent([multistep('ms1', [{ action: 'noop' }])]);
    const result = appendStep(content, { action: 'navigate', reftarget: '.x' }, 'ms1');
    expect(result.position).toBe('blocks[0].steps[1]');
    expect((content.blocks[0] as JsonMultistepBlock).steps).toHaveLength(2);
  });

  it('rejects a non-multistep/guided parent', () => {
    const content = baseContent([section('intro')]);
    try {
      appendStep(content, { action: 'noop' }, 'intro');
    } catch (err) {
      expect((err as PackageIOError).code).toBe('WRONG_PARENT_KIND');
      return;
    }
    throw new Error('expected throw');
  });
});

describe('appendChoice', () => {
  it('appends to a quiz block', () => {
    const content = baseContent([quiz('q1', [{ id: 'a', text: 'A' }])]);
    const result = appendChoice(content, { id: 'b', text: 'B', correct: true }, 'q1');
    expect(result.position).toBe('blocks[0].choices[1]');
    expect((content.blocks[0] as JsonQuizBlock).choices).toHaveLength(2);
  });

  it('rejects duplicate choice id within the same quiz', () => {
    const content = baseContent([quiz('q1', [{ id: 'a', text: 'A' }])]);
    try {
      appendChoice(content, { id: 'a', text: 'duplicate' }, 'q1');
    } catch (err) {
      expect((err as PackageIOError).code).toBe('DUPLICATE_ID');
      return;
    }
    throw new Error('expected throw');
  });
});

// ---------------------------------------------------------------------------
// Mutators: editBlock
// ---------------------------------------------------------------------------

describe('editBlock', () => {
  it('merges scalar fields and replaces arrays', () => {
    const content = baseContent([interactiveBlock({ id: 'i1', requirements: ['old'] })]);
    const result = editBlock(content, 'i1', {
      patch: { content: 'new', requirements: ['new'] },
    });
    expect(result.changed.sort()).toEqual(['content', 'requirements']);
    const block = content.blocks[0] as JsonInteractiveBlock;
    expect(block.content).toBe('new');
    expect(block.requirements).toEqual(['new']);
  });

  it('rejects edits to forbidden structural fields', () => {
    const content = baseContent([section('intro', [markdown('m1')])]);
    for (const field of ['type', 'blocks', 'id', 'steps', 'choices', 'whenTrue', 'whenFalse']) {
      try {
        editBlock(content, 'intro', { patch: { [field]: 'x' } });
      } catch (err) {
        expect((err as PackageIOError).code).toBe('SCHEMA_VALIDATION');
        continue;
      }
      throw new Error(`expected throw for forbidden field ${field}`);
    }
  });

  it('reports BLOCK_NOT_FOUND on missing id', () => {
    try {
      editBlock(baseContent(), 'nope', { patch: {} });
    } catch (err) {
      expect((err as PackageIOError).code).toBe('BLOCK_NOT_FOUND');
      return;
    }
    throw new Error('expected throw');
  });
});

// ---------------------------------------------------------------------------
// Mutators: removeBlock
// ---------------------------------------------------------------------------

describe('removeBlock', () => {
  it('removes a leaf block', () => {
    const content = baseContent([markdown('m1'), markdown('m2')]);
    const result = removeBlock(content, 'm1');
    expect(result.removed).toBe('markdown');
    expect(result.childrenRemoved).toBe(0);
    expect(content.blocks).toHaveLength(1);
    expect((content.blocks[0] as JsonBlock).id).toBe('m2');
  });

  it('refuses to remove a non-empty container without --cascade', () => {
    const content = baseContent([section('intro', [markdown('m1')])]);
    try {
      removeBlock(content, 'intro');
    } catch (err) {
      expect((err as PackageIOError).code).toBe('CONTAINER_HAS_CHILDREN');
      return;
    }
    throw new Error('expected throw');
  });

  it('removes a container with cascade', () => {
    const content = baseContent([section('intro', [markdown('m1'), markdown('m2')])]);
    const result = removeBlock(content, 'intro', { cascade: true });
    expect(result.childrenRemoved).toBe(2);
    expect(content.blocks).toHaveLength(0);
  });

  it('reports BLOCK_NOT_FOUND on missing id', () => {
    try {
      removeBlock(baseContent(), 'nope');
    } catch (err) {
      expect((err as PackageIOError).code).toBe('BLOCK_NOT_FOUND');
      return;
    }
    throw new Error('expected throw');
  });
});

// ---------------------------------------------------------------------------
// validatePackageState
// ---------------------------------------------------------------------------

describe('validatePackageState', () => {
  it('accepts a minimal valid state', () => {
    expect(validatePackageState(baseContent(), baseManifest())).toEqual({ ok: true, issues: [] });
  });

  it('detects a content/manifest id mismatch', () => {
    const manifest = { ...baseManifest(), id: 'a-different-id' } as ManifestJson;
    const result = validatePackageState(baseContent(), manifest);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'ID_MISMATCH')).toBe(true);
  });

  it('detects a non-kebab content id', () => {
    const content = { ...baseContent(), id: 'Bad_ID' } as ContentJson;
    const result = validatePackageState(content, undefined);
    expect(result.ok).toBe(false);
    expect(result.issues.every((i) => i.code === 'SCHEMA_VALIDATION')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mutateAndValidate
// ---------------------------------------------------------------------------

describe('mutateAndValidate', () => {
  it('persists when validation passes', async () => {
    const dir = makeTempDir();
    try {
      writeBundle(dir, baseContent(), baseManifest());

      const result = await mutateAndValidate(dir, ({ content }) => {
        appendBlock(content, markdown());
      });
      expect(result.validation.ok).toBe(true);

      const reread = readPackage(dir);
      expect(reread.content.blocks).toHaveLength(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not persist when validation fails', async () => {
    const dir = makeTempDir();
    try {
      writeBundle(dir, baseContent(), baseManifest());

      // Mutator deliberately breaks the package id to a non-kebab string. The
      // validator should reject; the on-disk state should not change.
      const result = await mutateAndValidate(dir, ({ content }) => {
        content.id = 'BROKEN_ID';
      });
      expect(result.validation.ok).toBe(false);

      const reread = readPackage(dir);
      expect(reread.content.id).toBe('unit-test-guide');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// newPackageState
// ---------------------------------------------------------------------------

describe('newPackageState', () => {
  it('produces a Zod-valid initial state', () => {
    const state = newPackageState({ id: 'my-guide-x7q2k1', title: 'My guide', type: 'guide' });
    expect(state.content.id).toBe('my-guide-x7q2k1');
    expect(state.content.blocks).toEqual([]);
    expect(state.manifest?.id).toBe('my-guide-x7q2k1');
    expect(state.manifest?.type).toBe('guide');

    const validation = validatePackageState(state.content, state.manifest);
    expect(validation.ok).toBe(true);
  });

  it('rejects a non-kebab id', () => {
    expect(() => newPackageState({ id: 'Bad_ID', title: 't', type: 'guide' })).toThrow();
  });
});
