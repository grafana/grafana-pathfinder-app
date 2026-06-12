/**
 * Tests for repository-index loading helpers used by the E2E command's
 * dependency-aware planning. Covers the contract the command relies on to
 * decide between hard-failing (explicit `--repository`) and degrading
 * gracefully (default bundled index).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { bundledRepositoryPath, loadRepositoryIndex } from './file-loader';

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pathfinder-file-loader-'));
}

describe('bundledRepositoryPath', () => {
  it('points at the bundled repository.json', () => {
    expect(bundledRepositoryPath().endsWith('src/bundled-interactives/repository.json')).toBe(true);
  });
});

describe('loadRepositoryIndex', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function write(filename: string, contents: string): string {
    const filePath = path.join(tmpDir, filename);
    fs.writeFileSync(filePath, contents, 'utf-8');
    return filePath;
  }

  it('loads a valid repository index', () => {
    const filePath = write(
      'repository.json',
      JSON.stringify({ 'guide-a': { path: 'guide-a/', type: 'guide', depends: ['guide-b'] } })
    );

    const { repository, error } = loadRepositoryIndex(filePath);

    expect(error).toBeUndefined();
    expect(repository).toEqual({ 'guide-a': { path: 'guide-a/', type: 'guide', depends: ['guide-b'] } });
  });

  it('returns an error when the file does not exist', () => {
    const { repository, error } = loadRepositoryIndex(path.join(tmpDir, 'missing.json'));

    expect(repository).toBeNull();
    expect(error).toMatch(/not found/i);
  });

  it('returns an error for malformed JSON', () => {
    const filePath = write('repository.json', '{ not valid json');

    const { repository, error } = loadRepositoryIndex(filePath);

    expect(repository).toBeNull();
    expect(error).toBeDefined();
  });

  it('returns a schema-validation error for a structurally invalid index', () => {
    const filePath = write('repository.json', JSON.stringify({ 'guide-a': 'not-an-entry-object' }));

    const { repository, error } = loadRepositoryIndex(filePath);

    expect(repository).toBeNull();
    expect(error).toContain('validation failed');
  });
});
