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

  it('builds a catalog entry per valid body (blocks stripped)', () => {
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
    expect(catalog['time-picker']).not.toHaveProperty('blocks');
  });

  it('ignores an existing index.json', () => {
    writeJson(path.join(tmpDir, 'index.json'), { stale: true });
    writeJson(path.join(tmpDir, 'datasource-picker.json'), validBody('datasource-picker'));

    const { catalog, errors } = buildSnippetCatalog(tmpDir);

    expect(errors).toHaveLength(0);
    expect(Object.keys(catalog)).toEqual(['datasource-picker']);
  });

  it('carries optional category and tags but omits an unset schemaVersion', () => {
    writeJson(
      path.join(tmpDir, 'tab-button-pattern.json'),
      validBody('tab-button-pattern', { category: 'nav', tags: ['ui', 'tabs'] })
    );

    const { catalog } = buildSnippetCatalog(tmpDir);
    const entry = catalog['tab-button-pattern']!;

    expect(entry.category).toBe('nav');
    expect(entry.tags).toEqual(['ui', 'tabs']);
    expect(entry).not.toHaveProperty('schemaVersion');
  });

  it('carries schemaVersion only when the body sets it explicitly', () => {
    writeJson(path.join(tmpDir, 'pinned.json'), validBody('pinned', { schemaVersion: '1.0.0' }));

    const { catalog } = buildSnippetCatalog(tmpDir);

    expect(catalog['pinned']!.schemaVersion).toBe('1.0.0');
  });

  it('errors when the file name does not match the snippet id', () => {
    writeJson(path.join(tmpDir, 'wrong-name.json'), validBody('actual-id'));

    const { catalog, errors } = buildSnippetCatalog(tmpDir);

    expect(catalog['actual-id']).toBeUndefined();
    expect(errors.join(' ')).toMatch(/does not match file name/);
  });

  it('errors on a body missing the required description', () => {
    const { description, ...noDescription } = validBody('no-desc');
    writeJson(path.join(tmpDir, 'no-desc.json'), noDescription);

    const { catalog, errors } = buildSnippetCatalog(tmpDir);

    expect(catalog['no-desc']).toBeUndefined();
    expect(errors.join(' ')).toMatch(/description/);
  });

  it('errors on a body containing a nested snippet-ref', () => {
    writeJson(
      path.join(tmpDir, 'nested.json'),
      validBody('nested', { blocks: [{ type: 'snippet-ref', snippetId: 'other' }] })
    );

    const { catalog, errors } = buildSnippetCatalog(tmpDir);

    expect(catalog['nested']).toBeUndefined();
    expect(errors.length).toBeGreaterThan(0);
  });
});
