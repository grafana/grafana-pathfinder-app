/**
 * Build Snippets Integration Tests (Layer 1)
 *
 * Tests buildSnippetCatalog against sample snippet directories.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { buildSnippetCatalog } from '../cli/commands/build-snippets';

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pathfinder-build-snippets-'));
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

const validBody = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title: `Title ${id}`,
  description: `Description for ${id}`,
  blocks: [{ type: 'markdown', content: 'hello' }],
  ...overrides,
});

describe('buildSnippetCatalog', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns an error when the directory does not exist', () => {
    const { catalog, errors } = buildSnippetCatalog(path.join(tmpDir, 'nope'));
    expect(Object.keys(catalog)).toHaveLength(0);
    expect(errors.join(' ')).toMatch(/not found/);
  });

  it('warns and returns empty when no snippet bodies are present', () => {
    const { catalog, warnings, errors } = buildSnippetCatalog(tmpDir);
    expect(Object.keys(catalog)).toHaveLength(0);
    expect(errors).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('builds a catalog entry per valid body, with blocks stripped', () => {
    writeJson(path.join(tmpDir, 'time-picker.json'), validBody('time-picker'));
    writeJson(path.join(tmpDir, 'run-query-button.json'), validBody('run-query-button'));
    const { catalog, errors } = buildSnippetCatalog(tmpDir);
    expect(errors).toHaveLength(0);
    expect(Object.keys(catalog).sort()).toEqual(['run-query-button', 'time-picker']);
    expect(catalog['time-picker']).toEqual({
      id: 'time-picker',
      title: 'Title time-picker',
      description: 'Description for time-picker',
    });
  });

  it('ignores an existing index.json', () => {
    writeJson(path.join(tmpDir, 'index.json'), { stale: true });
    writeJson(path.join(tmpDir, 'datasource-picker.json'), validBody('datasource-picker'));
    const { catalog, errors } = buildSnippetCatalog(tmpDir);
    expect(errors).toHaveLength(0);
    expect(Object.keys(catalog)).toEqual(['datasource-picker']);
  });

  it('carries optional category and tags but omits an unset schemaVersion', () => {
    writeJson(path.join(tmpDir, 'tagged.json'), validBody('tagged', { category: 'nav', tags: ['ui'] }));
    const { catalog } = buildSnippetCatalog(tmpDir);
    expect(catalog['tagged']).toMatchObject({ category: 'nav', tags: ['ui'] });
    expect(catalog['tagged']).not.toHaveProperty('schemaVersion');
  });

  it('carries schemaVersion only when the body sets it explicitly', () => {
    writeJson(path.join(tmpDir, 'pinned.json'), validBody('pinned', { schemaVersion: '1.0.0' }));
    const { catalog } = buildSnippetCatalog(tmpDir);
    expect(catalog['pinned']!.schemaVersion).toBe('1.0.0');
  });

  // Each invalid body must be dropped from the catalog and reported as an error.
  it.each([
    {
      when: 'the file name does not match the id',
      file: 'wrong-name.json',
      body: validBody('actual-id'),
      id: 'actual-id',
      match: /does not match file name/,
    },
    {
      when: 'the description is missing',
      file: 'no-desc.json',
      body: validBody('no-desc', { description: undefined }),
      id: 'no-desc',
      match: /description/,
    },
    {
      when: 'a block is a nested snippet-ref',
      file: 'nested.json',
      body: validBody('nested', { blocks: [{ type: 'snippet-ref', snippetId: 'x' }] }),
      id: 'nested',
    },
  ])('drops the snippet and reports an error when $when', ({ file, body, id, match }) => {
    writeJson(path.join(tmpDir, file), body);
    const { catalog, errors } = buildSnippetCatalog(tmpDir);
    expect(catalog[id]).toBeUndefined();
    expect(errors.length).toBeGreaterThan(0);
    if (match) {
      expect(errors.join(' ')).toMatch(match);
    }
  });
});
