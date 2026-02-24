/**
 * Package Validation Tests (Layer 1)
 *
 * Integration tests for validatePackage and validatePackageTree
 * with sample package trees (valid and invalid, with and without manifest.json).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { validatePackage, validatePackageTree } from './validate-package';

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pathfinder-validate-pkg-'));
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

describe('validatePackage', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should validate a content-only package', () => {
    const pkgDir = path.join(tmpDir, 'my-guide');
    writeJson(path.join(pkgDir, 'content.json'), {
      id: 'my-guide',
      title: 'My guide',
      blocks: [{ type: 'markdown', content: '# Hello' }],
    });

    const result = validatePackage(pkgDir);
    expect(result.isValid).toBe(true);
    expect(result.packageId).toBe('my-guide');
    expect(result.errors).toHaveLength(0);
    expect(result.messages.some((m) => m.message.includes('standalone guide'))).toBe(true);
  });

  it('should validate a package with matching manifest', () => {
    const pkgDir = path.join(tmpDir, 'test-guide');
    writeJson(path.join(pkgDir, 'content.json'), {
      id: 'test-guide',
      title: 'Test guide',
      blocks: [],
    });
    writeJson(path.join(pkgDir, 'manifest.json'), {
      id: 'test-guide',
      type: 'guide',
      description: 'A test guide',
      category: 'testing',
      startingLocation: '/test',
    });

    const result = validatePackage(pkgDir);
    expect(result.isValid).toBe(true);
    expect(result.packageId).toBe('test-guide');
    expect(result.errors).toHaveLength(0);
  });

  it('should error when content.json is missing', () => {
    const pkgDir = path.join(tmpDir, 'no-content');
    fs.mkdirSync(pkgDir, { recursive: true });

    const result = validatePackage(pkgDir);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('content.json not found'))).toBe(true);
  });

  it('should error on invalid JSON in content.json', () => {
    const pkgDir = path.join(tmpDir, 'bad-json');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'content.json'), '{bad json}', 'utf-8');

    const result = validatePackage(pkgDir);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('not valid JSON'))).toBe(true);
  });

  it('should error on ID mismatch between content and manifest', () => {
    const pkgDir = path.join(tmpDir, 'mismatch');
    writeJson(path.join(pkgDir, 'content.json'), {
      id: 'content-id',
      title: 'Test',
      blocks: [],
    });
    writeJson(path.join(pkgDir, 'manifest.json'), {
      id: 'manifest-id',
      type: 'guide',
    });

    const result = validatePackage(pkgDir);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.code === 'id_mismatch')).toBe(true);
  });

  it('should error on invalid manifest schema', () => {
    const pkgDir = path.join(tmpDir, 'bad-manifest');
    writeJson(path.join(pkgDir, 'content.json'), {
      id: 'test',
      title: 'Test',
      blocks: [],
    });
    writeJson(path.join(pkgDir, 'manifest.json'), {
      type: 'invalid-type',
    });

    const result = validatePackage(pkgDir);
    expect(result.isValid).toBe(false);
  });

  it('should emit severity-based messages for missing manifest fields', () => {
    const pkgDir = path.join(tmpDir, 'minimal-manifest');
    writeJson(path.join(pkgDir, 'content.json'), {
      id: 'test',
      title: 'Test',
      blocks: [],
    });
    writeJson(path.join(pkgDir, 'manifest.json'), {
      id: 'test',
      type: 'guide',
    });

    const result = validatePackage(pkgDir);
    expect(result.isValid).toBe(true);

    const infoMessages = result.messages.filter((m) => m.severity === 'info');
    const warnMessages = result.messages.filter((m) => m.severity === 'warn');

    expect(infoMessages.some((m) => m.message.includes('repository'))).toBe(true);
    expect(infoMessages.some((m) => m.message.includes('language'))).toBe(true);
    expect(warnMessages.some((m) => m.message.includes('description'))).toBe(true);
    expect(warnMessages.some((m) => m.message.includes('category'))).toBe(true);
  });

  it('should warn on asset references to missing files', () => {
    const pkgDir = path.join(tmpDir, 'missing-asset');
    writeJson(path.join(pkgDir, 'content.json'), {
      id: 'test',
      title: 'Test',
      blocks: [{ type: 'markdown', content: 'See image: ![diagram](./assets/diagram.png)' }],
    });

    const result = validatePackage(pkgDir);
    expect(result.isValid).toBe(true);
    expect(result.warnings.some((w) => w.type === 'missing-asset')).toBe(true);
  });

  it('should not warn on asset references when files exist', () => {
    const pkgDir = path.join(tmpDir, 'has-assets');
    writeJson(path.join(pkgDir, 'content.json'), {
      id: 'test',
      title: 'Test',
      blocks: [{ type: 'markdown', content: 'See: ![](./assets/diagram.png)' }],
    });
    fs.mkdirSync(path.join(pkgDir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'assets', 'diagram.png'), 'fake-image', 'utf-8');

    const result = validatePackage(pkgDir);
    expect(result.warnings.filter((w) => w.type === 'missing-asset')).toHaveLength(0);
  });

  it('should validate testEnvironment with recognized tiers', () => {
    const pkgDir = path.join(tmpDir, 'test-env');
    writeJson(path.join(pkgDir, 'content.json'), {
      id: 'test',
      title: 'Test',
      blocks: [],
    });
    writeJson(path.join(pkgDir, 'manifest.json'), {
      id: 'test',
      type: 'guide',
      testEnvironment: { tier: 'managed', minVersion: '11.0.0' },
    });

    const result = validatePackage(pkgDir);
    expect(result.isValid).toBe(true);
    expect(result.messages.filter((m) => m.message.includes('not a recognized tier'))).toHaveLength(0);
  });

  it('should warn on unrecognized testEnvironment tier', () => {
    const pkgDir = path.join(tmpDir, 'bad-tier');
    writeJson(path.join(pkgDir, 'content.json'), {
      id: 'test',
      title: 'Test',
      blocks: [],
    });
    writeJson(path.join(pkgDir, 'manifest.json'), {
      id: 'test',
      type: 'guide',
      testEnvironment: { tier: 'unknown-tier' },
    });

    const result = validatePackage(pkgDir);
    expect(result.messages.some((m) => m.message.includes('not a recognized tier'))).toBe(true);
  });

  it('should warn on invalid semver in minVersion', () => {
    const pkgDir = path.join(tmpDir, 'bad-version');
    writeJson(path.join(pkgDir, 'content.json'), {
      id: 'test',
      title: 'Test',
      blocks: [],
    });
    writeJson(path.join(pkgDir, 'manifest.json'), {
      id: 'test',
      type: 'guide',
      testEnvironment: { minVersion: 'not-semver' },
    });

    const result = validatePackage(pkgDir);
    expect(result.messages.some((m) => m.message.includes('not valid semver'))).toBe(true);
  });

  it('should handle strict mode (warnings become errors)', () => {
    const pkgDir = path.join(tmpDir, 'strict-test');
    writeJson(path.join(pkgDir, 'content.json'), {
      id: 'test',
      title: 'Test',
      blocks: [],
    });

    const normalResult = validatePackage(pkgDir);
    expect(normalResult.isValid).toBe(true);

    const strictResult = validatePackage(pkgDir, { strict: true });
    if (normalResult.warnings.length > 0) {
      expect(strictResult.isValid).toBe(false);
    }
  });
});

describe('validatePackageTree', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should validate multiple packages in a tree', () => {
    writeJson(path.join(tmpDir, 'guide-a', 'content.json'), {
      id: 'guide-a',
      title: 'Guide A',
      blocks: [],
    });
    writeJson(path.join(tmpDir, 'guide-b', 'content.json'), {
      id: 'guide-b',
      title: 'Guide B',
      blocks: [{ type: 'markdown', content: '# Hello' }],
    });
    writeJson(path.join(tmpDir, 'guide-b', 'manifest.json'), {
      id: 'guide-b',
      type: 'guide',
      depends: ['guide-a'],
    });

    const results = validatePackageTree(tmpDir);
    expect(results.size).toBe(2);

    const guideA = results.get('guide-a');
    expect(guideA?.isValid).toBe(true);

    const guideB = results.get('guide-b');
    expect(guideB?.isValid).toBe(true);
  });

  it('should return empty map for empty directory', () => {
    const results = validatePackageTree(tmpDir);
    expect(results.size).toBe(0);
  });

  it('should return empty map for non-existent directory', () => {
    const results = validatePackageTree('/nonexistent/path');
    expect(results.size).toBe(0);
  });

  it('should skip directories without content.json', () => {
    fs.mkdirSync(path.join(tmpDir, 'empty-dir'));
    writeJson(path.join(tmpDir, 'valid-guide', 'content.json'), {
      id: 'valid-guide',
      title: 'Valid',
      blocks: [],
    });

    const results = validatePackageTree(tmpDir);
    expect(results.size).toBe(1);
    expect(results.has('valid-guide')).toBe(true);
  });

  it('should include invalid packages in results', () => {
    writeJson(path.join(tmpDir, 'bad-guide', 'content.json'), {
      title: 'Missing ID',
      blocks: [],
    });

    const results = validatePackageTree(tmpDir);
    expect(results.size).toBe(1);

    const bad = results.get('bad-guide');
    expect(bad?.isValid).toBe(false);
  });
});
