import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { buildRepository } from './build-repository';

describe('buildRepository prerequisites', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pathfinder-repository-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('serializes prerequisite declarations in repository entries in source order', () => {
    const packageDir = path.join(root, 'guide');
    fs.mkdirSync(packageDir);
    fs.writeFileSync(
      path.join(packageDir, 'content.json'),
      JSON.stringify({ id: 'guide', title: 'Guide', blocks: [] })
    );
    const prerequisites = [
      { id: 'first', label: 'Literal **text**' },
      { id: 'second', label: '<strong>text</strong>', format: 'markdown' },
    ];
    fs.writeFileSync(
      path.join(packageDir, 'manifest.json'),
      JSON.stringify({ id: 'guide', type: 'guide', prerequisites })
    );

    const result = buildRepository(root);

    expect(result.errors).toEqual([]);
    expect(result.repository.guide?.prerequisites).toEqual(prerequisites);
    expect(JSON.parse(JSON.stringify(result.repository)).guide.prerequisites).toEqual(prerequisites);
  });

  it.each([undefined, []])('omits missing or empty prerequisites from the catalog: %s', (prerequisites) => {
    const packageDir = path.join(root, 'guide');
    fs.mkdirSync(packageDir);
    fs.writeFileSync(
      path.join(packageDir, 'content.json'),
      JSON.stringify({ id: 'guide', title: 'Guide', blocks: [] })
    );
    fs.writeFileSync(
      path.join(packageDir, 'manifest.json'),
      JSON.stringify({ id: 'guide', type: 'guide', prerequisites })
    );

    const result = buildRepository(root);

    expect(result.errors).toEqual([]);
    expect(result.repository.guide?.prerequisites).toBeUndefined();
    expect(JSON.parse(JSON.stringify(result.repository)).guide).not.toHaveProperty('prerequisites');
  });
});

describe('buildRepository author inheritance', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pathfinder-repository-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function writePackage(dir: string, manifest: Record<string, unknown>): void {
    const packageDir = path.join(root, dir);
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(
      path.join(packageDir, 'content.json'),
      JSON.stringify({ id: manifest.id, title: String(manifest.id), blocks: [] })
    );
    fs.writeFileSync(path.join(packageDir, 'manifest.json'), JSON.stringify(manifest));
  }

  it('gives a nested step without author.name the name of its learning path', () => {
    writePackage('learn', {
      id: 'learn',
      type: 'path',
      milestones: ['learn-step'],
      author: { name: 'path-author', team: 'Path team' },
    });
    writePackage('learn/step', { id: 'learn-step', type: 'guide', author: { team: 'Step team' } });
    writePackage('learn/intro', { id: 'learn-intro', type: 'guide' });

    const result = buildRepository(root);

    expect(result.errors).toEqual([]);
    expect(result.repository['learn-step']?.author).toEqual({ name: 'path-author', team: 'Step team' });
    expect(result.repository['learn-intro']?.author).toEqual({ name: 'path-author', team: 'Path team' });
  });

  it('keeps a step author and leaves packages outside a path unchanged', () => {
    writePackage('learn', { id: 'learn', type: 'path', milestones: [], author: { name: 'path-author' } });
    writePackage('learn/step', { id: 'learn-step', type: 'guide', author: { name: 'step-author' } });
    writePackage('standalone', { id: 'standalone', type: 'guide' });

    const result = buildRepository(root);

    expect(result.repository['learn-step']?.author).toEqual({ name: 'step-author' });
    expect(result.repository.standalone?.author).toBeUndefined();
  });
});
