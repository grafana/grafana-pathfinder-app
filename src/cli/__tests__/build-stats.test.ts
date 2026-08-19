/**
 * Behavioural tests for `pathfinder-cli build-stats`.
 *
 * The counting rule itself is covered in `src/lib/guide-stats`; these tests
 * cover what the command adds on top: manifest IO, determinism, idempotency,
 * and measuring milestones before their parents.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { buildStats } from '../commands/build-stats';

// Prettier resolves its own plugins through a dynamic import, which jest cannot
// service without --experimental-vm-modules. The identity mock keeps the real
// write path (and its async plumbing) under test; the formatter's own output is
// prettier's business, not this command's.
jest.mock('prettier', () => ({
  resolveConfig: async () => ({}),
  format: async (source: string) => source,
}));

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pathfinder-build-stats-'));
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function readManifest(dir: string, id: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(dir, id, 'manifest.json'), 'utf-8'));
}

interface GuideOptions {
  type?: 'guide' | 'path' | 'journey';
  milestones?: string[];
  blocks?: unknown[];
  manifestExtras?: Record<string, unknown>;
}

function writeGuide(root: string, id: string, options: GuideOptions = {}): void {
  writeJson(path.join(root, id, 'content.json'), {
    id,
    title: id,
    blocks: options.blocks ?? [{ type: 'markdown', content: 'hello' }],
  });
  writeJson(path.join(root, id, 'manifest.json'), {
    id,
    type: options.type ?? 'guide',
    ...(options.milestones ? { milestones: options.milestones } : {}),
    ...options.manifestExtras,
  });
}

const section = (blocks: unknown[]) => ({ type: 'section', title: 'Setup', blocks });
const markdown = { type: 'markdown', content: 'prose' };
const interactive = { type: 'interactive', action: 'button', reftarget: 'Save', content: 'Save it' };

describe('buildStats', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('warns and writes nothing when the tree holds no packages', async () => {
    const result = await buildStats(tmpDir);

    expect(result.written).toEqual([]);
    expect(result.warnings[0]).toContain('No package directories');
  });

  it('writes the computed stats into the manifest', async () => {
    writeGuide(tmpDir, 'guide-a', { blocks: [section([markdown, interactive]), markdown] });

    const result = await buildStats(tmpDir);

    expect(result.errors).toEqual([]);
    expect(result.written).toEqual(['guide-a']);
    expect(readManifest(tmpDir, 'guide-a').stats).toEqual({
      version: 1,
      blockCount: 3,
      sectionCount: 1,
      interactiveBlockCount: 1,
      finalInteractivePosition: 2,
    });
  });

  it('preserves the authored manifest fields and their key order', async () => {
    writeGuide(tmpDir, 'guide-a', {
      manifestExtras: { description: 'A guide', category: 'learn', startingLocation: '/d' },
    });

    await buildStats(tmpDir);

    expect(Object.keys(readManifest(tmpDir, 'guide-a'))).toEqual([
      'id',
      'type',
      'description',
      'category',
      'startingLocation',
      'stats',
    ]);
  });

  it('is a byte-for-byte no-op on a second run', async () => {
    writeGuide(tmpDir, 'guide-a', { blocks: [section([markdown, interactive])] });
    await buildStats(tmpDir);

    const manifestPath = path.join(tmpDir, 'guide-a', 'manifest.json');
    const afterFirst = fs.readFileSync(manifestPath, 'utf-8');
    const second = await buildStats(tmpDir);

    expect(second.written).toEqual([]);
    expect(second.unchanged).toEqual(['guide-a']);
    expect(fs.readFileSync(manifestPath, 'utf-8')).toBe(afterFirst);
  });

  it('replaces stale stats in place rather than appending a second copy', async () => {
    writeGuide(tmpDir, 'guide-a', {
      manifestExtras: { stats: { version: 1, blockCount: 99 }, description: 'A guide' },
    });

    const result = await buildStats(tmpDir);

    expect(result.written).toEqual(['guide-a']);
    expect(Object.keys(readManifest(tmpDir, 'guide-a'))).toEqual(['id', 'type', 'stats', 'description']);
    expect(readManifest(tmpDir, 'guide-a').stats).toMatchObject({ blockCount: 1 });
  });

  it('rewrites a manifest when its content changed under it', async () => {
    writeGuide(tmpDir, 'guide-a', { blocks: [markdown] });
    await buildStats(tmpDir);

    writeJson(path.join(tmpDir, 'guide-a', 'content.json'), {
      id: 'guide-a',
      title: 'guide-a',
      blocks: [markdown, markdown, interactive],
    });
    const result = await buildStats(tmpDir);

    expect(result.written).toEqual(['guide-a']);
    expect(readManifest(tmpDir, 'guide-a').stats).toMatchObject({ blockCount: 3, finalInteractivePosition: 3 });
  });

  it('rolls a path up from its milestones, measuring them first', async () => {
    writeGuide(tmpDir, 'milestone-one', { blocks: [markdown, interactive] });
    writeGuide(tmpDir, 'milestone-two', { blocks: [section([markdown, markdown, interactive])] });
    writeGuide(tmpDir, 'the-path', {
      type: 'path',
      milestones: ['milestone-one', 'milestone-two'],
      blocks: [],
    });

    const result = await buildStats(tmpDir);

    expect(result.errors).toEqual([]);
    expect(readManifest(tmpDir, 'milestone-one').stats).toMatchObject({ blockCount: 2 });
    expect(readManifest(tmpDir, 'milestone-two').stats).toMatchObject({ blockCount: 3 });
    expect(readManifest(tmpDir, 'the-path').stats).toEqual({
      version: 1,
      blockCount: 5,
      sectionCount: 1,
      interactiveBlockCount: 2,
      finalInteractivePosition: 5,
    });
  });

  it('rolls up regardless of whether a parent is discovered before its milestones', async () => {
    writeGuide(tmpDir, 'aaa-path', { type: 'path', milestones: ['zzz-milestone'], blocks: [] });
    writeGuide(tmpDir, 'zzz-milestone', { blocks: [markdown, interactive, markdown] });

    await buildStats(tmpDir);

    expect(readManifest(tmpDir, 'aaa-path').stats).toMatchObject({
      blockCount: 3,
      finalInteractivePosition: 2,
    });
  });

  it('rolls a journey up through its paths', async () => {
    writeGuide(tmpDir, 'guide-one', { blocks: [markdown, interactive] });
    writeGuide(tmpDir, 'guide-two', { blocks: [interactive] });
    writeGuide(tmpDir, 'path-one', { type: 'path', milestones: ['guide-one'], blocks: [] });
    writeGuide(tmpDir, 'path-two', { type: 'path', milestones: ['guide-two'], blocks: [] });
    writeGuide(tmpDir, 'journey', { type: 'journey', milestones: ['path-one', 'path-two'], blocks: [] });

    const result = await buildStats(tmpDir);

    expect(result.errors).toEqual([]);
    expect(readManifest(tmpDir, 'journey').stats).toMatchObject({ blockCount: 3, interactiveBlockCount: 2 });
  });

  it('counts a metapackage own body ahead of its milestones', async () => {
    writeGuide(tmpDir, 'the-milestone', { blocks: [interactive] });
    writeGuide(tmpDir, 'the-path', {
      type: 'path',
      milestones: ['the-milestone'],
      blocks: [markdown, markdown],
    });

    await buildStats(tmpDir);

    expect(readManifest(tmpDir, 'the-path').stats).toMatchObject({
      blockCount: 3,
      finalInteractivePosition: 3,
    });
  });

  it('errors when a milestone is not in the tree, writing nothing for the parent', async () => {
    writeGuide(tmpDir, 'the-path', { type: 'path', milestones: ['nowhere'], blocks: [] });

    const result = await buildStats(tmpDir);

    expect(result.errors).toEqual(['the-path: milestone "nowhere" not found in the package tree']);
    expect(readManifest(tmpDir, 'the-path').stats).toBeUndefined();
  });

  it('errors on a milestone cycle instead of recursing forever', async () => {
    writeGuide(tmpDir, 'path-a', { type: 'path', milestones: ['path-b'], blocks: [] });
    writeGuide(tmpDir, 'path-b', { type: 'path', milestones: ['path-a'], blocks: [] });

    const result = await buildStats(tmpDir);

    expect(result.errors.some((error) => error.includes('milestone cycle'))).toBe(true);
  });

  it('errors on an ID mismatch between content and manifest', async () => {
    writeGuide(tmpDir, 'guide-a');
    writeJson(path.join(tmpDir, 'guide-a', 'manifest.json'), { id: 'other-id', type: 'guide' });

    const result = await buildStats(tmpDir);

    expect(result.errors[0]).toContain('ID mismatch');
    expect(result.written).toEqual([]);
  });

  it('errors on a duplicate package ID and writes nothing', async () => {
    writeGuide(tmpDir, 'dir-one');
    writeGuide(tmpDir, 'dir-two');
    writeJson(path.join(tmpDir, 'dir-two', 'content.json'), { id: 'dir-one', title: 'x', blocks: [] });
    writeJson(path.join(tmpDir, 'dir-two', 'manifest.json'), { id: 'dir-one', type: 'guide' });

    const result = await buildStats(tmpDir);

    expect(result.errors.some((error) => error.includes('duplicate package ID'))).toBe(true);
    expect(readManifest(tmpDir, 'dir-one').stats).toBeUndefined();
  });

  it('skips excluded subtrees', async () => {
    writeGuide(tmpDir, 'kept');
    writeGuide(tmpDir, 'skipped');

    const result = await buildStats(tmpDir, { exclude: ['skipped'] });

    expect(result.written).toEqual(['kept']);
    expect(readManifest(tmpDir, 'skipped').stats).toBeUndefined();
  });

  it('reports drift without touching disk under --check', async () => {
    writeGuide(tmpDir, 'guide-a');
    const manifestPath = path.join(tmpDir, 'guide-a', 'manifest.json');
    const before = fs.readFileSync(manifestPath, 'utf-8');

    const stale = await buildStats(tmpDir, { check: true });

    expect(stale.written).toEqual(['guide-a']);
    expect(fs.readFileSync(manifestPath, 'utf-8')).toBe(before);

    await buildStats(tmpDir);
    const fresh = await buildStats(tmpDir, { check: true });

    expect(fresh.written).toEqual([]);
    expect(fresh.unchanged).toEqual(['guide-a']);
  });
});
