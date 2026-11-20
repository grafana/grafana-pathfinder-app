import * as fs from 'fs';

import { validatePackage } from '../validate-package';
import { createTmpDir, sidecarJson, writePackage } from '../../test-utils/sidecar-package-fixture';

describe('validatePackage — sidecar seam', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reports nothing for a package with no i18n directory', () => {
    const result = validatePackage(writePackage(tmpDir, 'plain'), { strict: true });
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.messages.filter((m) => m.path?.[0]?.startsWith('i18n'))).toEqual([]);
  });

  it('reports nothing for a package whose sidecars are clean', () => {
    const dir = writePackage(tmpDir, 'clean', {
      ja: sidecarJson('ja', { manifest: { description: 'd', category: 'c' } }),
    });
    const result = validatePackage(dir, { strict: true });
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects a forbidden key in a sidecar manifest block, naming the file and the key', () => {
    const dir = writePackage(tmpDir, 'bad-manifest', {
      ja: sidecarJson('ja', { manifest: { description: 'd', milestones: ['a'], tagline: 'x' } }),
    });
    const result = validatePackage(dir);
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: 'sidecar_manifest_block_field',
        path: ['i18n/ja.json', 'manifest', 'milestones'],
      }),
      expect.objectContaining({
        code: 'sidecar_manifest_block_field',
        path: ['i18n/ja.json', 'manifest', 'tagline'],
      }),
    ]);
  });

  it('reports a sidecar that is not valid JSON with its file path, and still checks the others', () => {
    const dir = writePackage(tmpDir, 'broken', {
      es: sidecarJson('es', { manifest: { id: 'x' } }),
      ja: '{ not json',
    });
    const result = validatePackage(dir);
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'sidecar_unreadable', path: ['i18n/ja.json'] }),
      expect.objectContaining({ code: 'sidecar_manifest_block_field', path: ['i18n/es.json', 'manifest', 'id'] }),
    ]);
  });

  it('reports a sidecar that fails the schema, and does not stop the content checks', () => {
    const dir = writePackage(tmpDir, 'bad-schema', { ja: JSON.stringify({ language: 'ja' }) });
    const result = validatePackage(dir);
    expect(result.isValid).toBe(false);
    expect(result.errors.map((e) => e.code)).toEqual(['sidecar_unreadable']);
    expect(result.errors[0]?.path[0]).toBe('i18n/ja.json');
    expect(result.contentResult).not.toBeNull();
  });

  it('does not run when content.json does not parse', () => {
    const dir = writePackage(tmpDir, 'no-content', { ja: sidecarJson('ja', { manifest: { id: 'x' } }) });
    fs.rmSync(`${dir}/content.json`);
    const result = validatePackage(dir);
    expect(result.errors.map((e) => e.code)).toEqual(['missing_content']);
  });
});
