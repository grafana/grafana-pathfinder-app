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

  // Snippet bodies share every block schema with a guide, so `JsonSnippetSchema`
  // admits a guided block carrying a verb `GuidedHandler` cannot drive. Publishing
  // is an authoring gate, so it must refuse the body rather than let the bad step
  // reach readers through a `snippet-ref`.
  it.each([
    {
      when: 'a guided step carries a non-guided verb',
      blocks: [{ type: 'guided', content: 'Follow along', steps: [{ action: 'navigate', reftarget: '/explore' }] }],
      verb: 'navigate',
    },
    {
      when: 'the guided block is nested inside a section',
      blocks: [
        {
          type: 'section',
          title: 'S',
          blocks: [{ type: 'guided', content: 'Follow along', steps: [{ action: 'popout', targetvalue: 'sidebar' }] }],
        },
      ],
      verb: 'popout',
    },
  ])('drops the snippet and reports an error when $when', ({ blocks, verb }) => {
    writeJson(path.join(tmpDir, 'bad-guided.json'), validBody('bad-guided', { blocks }));

    const { catalog, errors } = buildSnippetCatalog(tmpDir);

    expect(catalog['bad-guided']).toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(verb);
  });

  it('accepts a guided block whose steps all use drivable verbs', () => {
    writeJson(
      path.join(tmpDir, 'good-guided.json'),
      validBody('good-guided', {
        blocks: [
          {
            type: 'guided',
            content: 'Follow along',
            steps: [{ action: 'button', reftarget: '#go' }, { action: 'noop' }],
          },
        ],
      })
    );

    const { catalog, errors } = buildSnippetCatalog(tmpDir);

    expect(errors).toHaveLength(0);
    expect(catalog['good-guided']).toBeDefined();
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
