import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CLI_ENTRY = path.resolve(__dirname, '../index.ts');

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(value), 'utf-8');
}

function runCli(args: string[]) {
  return spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', CLI_ENTRY, ...args], {
    cwd: path.resolve(__dirname, '../../..'),
    encoding: 'utf-8',
  });
}

describe('validate --snippets-catalog', () => {
  let tmpDir: string;
  let catalogPath: string;
  let guidePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pathfinder-validate-snippets-'));
    catalogPath = path.join(tmpDir, 'index.json');
    guidePath = path.join(tmpDir, 'content.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('accepts a referenced catalog key', () => {
    writeJson(catalogPath, {
      known: { id: 'known', title: 'Known', description: 'A known snippet' },
    });

    writeJson(guidePath, {
      id: 'guide',
      title: 'Guide',
      blocks: [{ type: 'snippet-ref', snippetId: 'known' }],
    });

    const result = runCli(['validate', '--strict', '--snippets-catalog', catalogPath, guidePath]);

    expect(result.status).toBe(0);
  });

  it('rejects a missing nested snippet ID', () => {
    writeJson(catalogPath, {});

    writeJson(guidePath, {
      id: 'guide',
      title: 'Guide',
      blocks: [
        {
          type: 'conditional',
          conditions: ['is-admin'],
          whenTrue: [{ type: 'snippet-ref', snippetId: 'missing' }],
          whenFalse: [],
        },
      ],
    });

    const result = runCli(['validate', '--strict', '--snippets-catalog', catalogPath, guidePath]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('blocks[0].whenTrue[0].snippetId');
    expect(result.stdout).toContain('missing');
  });

  it('preserves snippet-blind validation when the optional flag is absent', () => {
    writeJson(guidePath, {
      id: 'guide',
      title: 'Guide',
      blocks: [{ type: 'snippet-ref', snippetId: 'not-checked-without-the-flag' }],
    });

    const result = runCli(['validate', '--strict', guidePath]);

    expect(result.status).toBe(0);
  });

  it('fails clearly when the supplied catalog is invalid', () => {
    writeJson(catalogPath, { broken: true });

    writeJson(guidePath, {
      id: 'guide',
      title: 'Guide',
      blocks: [{ type: 'markdown', content: 'Hello' }],
    });

    const result = runCli(['validate', '--snippets-catalog', catalogPath, guidePath]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Cannot use snippets catalog');
  });

  it('checks a package directory with the same catalog', () => {
    writeJson(catalogPath, {});

    writeJson(path.join(tmpDir, 'content.json'), {
      id: 'package-guide',
      title: 'Package guide',
      blocks: [{ type: 'snippet-ref', snippetId: 'missing-package-snippet' }],
    });

    const result = runCli(['validate', '--package', tmpDir, '--snippets-catalog', catalogPath]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('missing-package-snippet');
  });
});
