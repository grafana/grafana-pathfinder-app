import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { TranslationSidecar } from '../../types/translation-sidecar.schema';
import type { ContentJson } from '../../types/package.types';
import {
  findSidecarEntries,
  PackageIOError,
  readPackageSidecars,
  writePackage,
  writePackageSidecar,
} from '../utils/package-io';

const SIDECAR: TranslationSidecar = {
  schemaVersion: '1.0.0',
  language: 'ja',
  blocks: { intro: { content: '本文', reviewed: true } },
};

let packageDir: string;

beforeEach(() => {
  packageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecars-'));
});

afterEach(() => {
  fs.rmSync(packageDir, { recursive: true, force: true });
});

function writeRaw(relativePath: string, text: string): void {
  const filePath = path.join(packageDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

describe('readPackageSidecars', () => {
  it('returns an empty list for a package with no i18n directory', () => {
    expect(readPackageSidecars(packageDir)).toEqual([]);
  });

  it('returns an empty list when i18n is a file', () => {
    writeRaw('i18n', 'not a directory');
    expect(readPackageSidecars(packageDir)).toEqual([]);
  });

  it('returns an empty list for a package directory that does not exist', () => {
    expect(readPackageSidecars(path.join(packageDir, 'missing'))).toEqual([]);
  });

  it('parses every sidecar, sorted by tag, and ignores other files', () => {
    writeRaw('i18n/ja.json', JSON.stringify(SIDECAR));
    writeRaw('i18n/es.json', JSON.stringify({ ...SIDECAR, language: 'es' }));
    writeRaw('i18n/README.md', '# notes');
    fs.mkdirSync(path.join(packageDir, 'i18n', 'drafts.json'));

    const results = readPackageSidecars(packageDir);

    expect(results.map((result) => result.tag)).toEqual(['es', 'ja']);
    expect(results[1]).toEqual({
      ok: true,
      tag: 'ja',
      filePath: path.join(packageDir, 'i18n', 'ja.json'),
      sidecar: SIDECAR,
    });
  });

  it('reports each bad file with a typed error and keeps reading the rest', () => {
    writeRaw('i18n/ja.json', JSON.stringify(SIDECAR));
    writeRaw('i18n/es.json', '{ not json');
    writeRaw('i18n/fr.json', JSON.stringify({ ...SIDECAR, title: 'stray root key' }));

    const results = readPackageSidecars(packageDir);

    expect(results.map((result) => [result.tag, result.ok ? 'ok' : result.code])).toEqual([
      ['es', 'invalid_json'],
      ['fr', 'schema_validation'],
      ['ja', 'ok'],
    ]);
    const schemaFailure = results[1];
    expect(schemaFailure?.ok === false && schemaFailure.issues?.length).toBeGreaterThan(0);
  });

  const runsAsRoot = typeof process.getuid === 'function' && process.getuid() === 0;

  (runsAsRoot ? it.skip : it)('reports an unreadable i18n directory instead of throwing', () => {
    writeRaw('i18n/ja.json', JSON.stringify(SIDECAR));
    const dir = path.join(packageDir, 'i18n');
    fs.chmodSync(dir, 0o000);
    try {
      expect(readPackageSidecars(packageDir)).toEqual([
        { ok: false, filePath: dir, code: 'read_error', message: `Cannot read: ${dir}` },
      ]);
    } finally {
      fs.chmodSync(dir, 0o755);
    }
  });
});

describe('findSidecarEntries', () => {
  const withBlocks = (language: string, blocks: TranslationSidecar['blocks']) =>
    JSON.stringify({ ...SIDECAR, language, blocks });

  it('returns the sidecars keyed by the asked-for ids, in tag and file order, with the unreadable ones', () => {
    writeRaw(
      'i18n/ja.json',
      withBlocks('ja', { outro: { content: 'o' }, other: { content: 'x' }, intro: { content: 'i' } })
    );
    writeRaw('i18n/de.json', withBlocks('de', { other: { content: 'x' } }));
    writeRaw('i18n/es.json', '{ not json');

    const results = findSidecarEntries(packageDir, new Set(['intro', 'outro']));

    expect(results).toEqual([
      expect.objectContaining({ ok: false, tag: 'es', code: 'invalid_json' }),
      expect.objectContaining({ ok: true, tag: 'ja', blockIds: ['outro', 'intro'] }),
    ]);
  });

  it('returns an empty list when no sidecar has an entry for the ids', () => {
    writeRaw('i18n/ja.json', JSON.stringify(SIDECAR));
    expect(findSidecarEntries(packageDir, new Set(['outro']))).toEqual([]);
    expect(findSidecarEntries(packageDir, new Set())).toEqual([]);
  });
});

describe('writePackageSidecar', () => {
  it('writes with the content.json serializer and creates i18n/', () => {
    const content: ContentJson = { id: 'guide', title: 'Guide', blocks: [] };
    writePackage(packageDir, { content, manifest: undefined });

    writePackageSidecar(packageDir, 'ja', SIDECAR);

    const written = fs.readFileSync(path.join(packageDir, 'i18n', 'ja.json'), 'utf-8');
    expect(written).toBe(`${JSON.stringify(SIDECAR, null, 2)}\n`);
    expect(fs.readFileSync(path.join(packageDir, 'content.json'), 'utf-8')).toBe(
      `${JSON.stringify(content, null, 2)}\n`
    );
  });

  it('keeps the key order it was given', () => {
    const reordered = { blocks: SIDECAR.blocks, language: 'ja', schemaVersion: '1.0.0' } as TranslationSidecar;
    writePackageSidecar(packageDir, 'ja', reordered);
    const written = fs.readFileSync(path.join(packageDir, 'i18n', 'ja.json'), 'utf-8');
    expect(Object.keys(JSON.parse(written))).toEqual(['blocks', 'language', 'schemaVersion']);
  });

  it('round-trips through the reader', () => {
    writePackageSidecar(packageDir, 'ja-JP', { ...SIDECAR, language: 'ja-JP' });
    expect(readPackageSidecars(packageDir)).toEqual([
      expect.objectContaining({ ok: true, tag: 'ja-JP', sidecar: { ...SIDECAR, language: 'ja-JP' } }),
    ]);
  });

  it('rewrites the golden ja.json sidecar byte for byte after a read', () => {
    const golden = path.join(
      __dirname,
      '../../lib/guide-translation/fixtures/packages/translation-golden/i18n/ja.json'
    );
    writeRaw('i18n/ja.json', fs.readFileSync(golden, 'utf-8'));
    const [result] = readPackageSidecars(packageDir);
    if (!result?.ok) {
      throw new Error('golden sidecar failed to read');
    }
    writePackageSidecar(packageDir, 'ja', result.sidecar);
    expect(fs.readFileSync(path.join(packageDir, 'i18n', 'ja.json'), 'utf-8')).toBe(fs.readFileSync(golden, 'utf-8'));
  });

  it.each(['../ja', 'ja/JP', 'ja.json', '', 'ja-'])('refuses the tag %p', (tag) => {
    expect(() => writePackageSidecar(packageDir, tag, SIDECAR)).toThrow(PackageIOError);
    expect(fs.existsSync(path.join(packageDir, 'i18n'))).toBe(false);
  });

  describe('with links in the package', () => {
    const EXTERNAL_TEXT = 'outside the package\n';
    let outsideDir: string;

    beforeEach(() => {
      outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecars-outside-'));
      fs.writeFileSync(path.join(outsideDir, 'ja.json'), EXTERNAL_TEXT);
    });

    afterEach(() => {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    });

    it('refuses a linked i18n directory and leaves the external file unchanged', () => {
      fs.symlinkSync(outsideDir, path.join(packageDir, 'i18n'), 'dir');

      expect(() => writePackageSidecar(packageDir, 'ja', SIDECAR)).toThrow(PackageIOError);
      expect(fs.readFileSync(path.join(outsideDir, 'ja.json'), 'utf-8')).toBe(EXTERNAL_TEXT);
      expect(fs.readdirSync(outsideDir)).toEqual(['ja.json']);
    });

    it('replaces a linked destination file without writing through the link', () => {
      fs.mkdirSync(path.join(packageDir, 'i18n'));
      const destination = path.join(packageDir, 'i18n', 'ja.json');
      fs.symlinkSync(path.join(outsideDir, 'ja.json'), destination);

      writePackageSidecar(packageDir, 'ja', SIDECAR);

      expect(fs.readFileSync(path.join(outsideDir, 'ja.json'), 'utf-8')).toBe(EXTERNAL_TEXT);
      expect(fs.lstatSync(destination).isSymbolicLink()).toBe(false);
      expect(fs.readFileSync(destination, 'utf-8')).toBe(`${JSON.stringify(SIDECAR, null, 2)}\n`);
      expect(fs.readdirSync(path.join(packageDir, 'i18n'))).toEqual(['ja.json']);
    });
  });

  it('refuses an i18n path that is a file', () => {
    writeRaw('i18n', 'not a directory');
    expect(() => writePackageSidecar(packageDir, 'ja', SIDECAR)).toThrow(PackageIOError);
    expect(fs.readFileSync(path.join(packageDir, 'i18n'), 'utf-8')).toBe('not a directory');
  });

  it('refuses a sidecar that does not match the schema', () => {
    const invalid = { ...SIDECAR, title: 'stray root key' } as TranslationSidecar;
    expect(() => writePackageSidecar(packageDir, 'ja', invalid)).toThrow(PackageIOError);
    expect(fs.existsSync(path.join(packageDir, 'i18n', 'ja.json'))).toBe(false);
  });
});
