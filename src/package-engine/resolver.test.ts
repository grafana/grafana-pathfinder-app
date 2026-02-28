/**
 * Bundled Package Resolver Tests (Layer 2)
 *
 * Tests the BundledPackageResolver against fixture data and
 * verifies content loading via mocked loader functions.
 */

import type { ContentJson, ManifestJson, RepositoryJson } from '../types/package.types';

import { BundledPackageResolver, createBundledResolver } from './resolver';

jest.mock('./loader', () => ({
  loadBundledContent: jest.fn(),
  loadBundledManifest: jest.fn(),
}));

import { loadBundledContent, loadBundledManifest } from './loader';

const mockLoadContent = loadBundledContent as jest.MockedFunction<typeof loadBundledContent>;
const mockLoadManifest = loadBundledManifest as jest.MockedFunction<typeof loadBundledManifest>;

const FIXTURE_CONTENT: ContentJson = {
  id: 'test-guide',
  title: 'Test guide',
  blocks: [{ type: 'markdown', content: '# Hello' }],
};

const FIXTURE_MANIFEST: ManifestJson = {
  id: 'test-guide',
  type: 'guide',
  description: 'A test guide',
};

const FIXTURE_REPO: RepositoryJson = {
  'test-guide': {
    path: 'test-guide/',
    type: 'guide',
    title: 'Test guide',
    description: 'A test guide',
    provides: ['test-capability'],
  },
  'another-guide': {
    path: 'another-guide/',
    type: 'guide',
    title: 'Another guide',
  },
};

describe('BundledPackageResolver', () => {
  let resolver: BundledPackageResolver;

  beforeEach(() => {
    resolver = new BundledPackageResolver(FIXTURE_REPO);
    jest.clearAllMocks();
  });

  // ============ resolve() without content loading ============

  describe('resolve (metadata only)', () => {
    it('should resolve an existing package to success with URLs', async () => {
      const result = await resolver.resolve('test-guide');

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.id).toBe('test-guide');
      expect(result.contentUrl).toBe('bundled:test-guide/content.json');
      expect(result.manifestUrl).toBe('bundled:test-guide/manifest.json');
      expect(result.repository).toBe('bundled');
      expect(result.content).toBeUndefined();
      expect(result.manifest).toBeUndefined();
    });

    it('should return not-found for nonexistent package', async () => {
      const result = await resolver.resolve('nonexistent');

      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.id).toBe('nonexistent');
      expect(result.error.code).toBe('not-found');
      expect(result.error.message).toContain('nonexistent');
    });

    it('should not call loader when loadContent is not set', async () => {
      await resolver.resolve('test-guide');

      expect(mockLoadContent).not.toHaveBeenCalled();
      expect(mockLoadManifest).not.toHaveBeenCalled();
    });

    it('should not call loader when loadContent is false', async () => {
      await resolver.resolve('test-guide', { loadContent: false });

      expect(mockLoadContent).not.toHaveBeenCalled();
      expect(mockLoadManifest).not.toHaveBeenCalled();
    });
  });

  // ============ resolve() with content loading ============

  describe('resolve (with content loading)', () => {
    it('should populate content and manifest when loadContent is true', async () => {
      mockLoadContent.mockReturnValue({ ok: true, data: FIXTURE_CONTENT });
      mockLoadManifest.mockReturnValue({ ok: true, data: FIXTURE_MANIFEST });

      const result = await resolver.resolve('test-guide', { loadContent: true });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.content).toEqual(FIXTURE_CONTENT);
      expect(result.manifest).toEqual(FIXTURE_MANIFEST);
    });

    it('should call loader with the correct package path', async () => {
      mockLoadContent.mockReturnValue({ ok: true, data: FIXTURE_CONTENT });
      mockLoadManifest.mockReturnValue({ ok: true, data: FIXTURE_MANIFEST });

      await resolver.resolve('test-guide', { loadContent: true });

      expect(mockLoadContent).toHaveBeenCalledWith('test-guide/');
      expect(mockLoadManifest).toHaveBeenCalledWith('test-guide/');
    });

    it('should return failure when content loading fails', async () => {
      mockLoadContent.mockReturnValue({
        ok: false,
        error: { code: 'not-found', message: 'Content not found' },
      });

      const result = await resolver.resolve('test-guide', { loadContent: true });

      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.error.code).toBe('not-found');
    });

    it('should succeed with undefined manifest when manifest loading fails', async () => {
      mockLoadContent.mockReturnValue({ ok: true, data: FIXTURE_CONTENT });
      mockLoadManifest.mockReturnValue({
        ok: false,
        error: { code: 'not-found', message: 'Manifest not found' },
      });

      const result = await resolver.resolve('test-guide', { loadContent: true });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.content).toEqual(FIXTURE_CONTENT);
      expect(result.manifest).toBeUndefined();
    });

    it('should not load content for nonexistent packages', async () => {
      await resolver.resolve('nonexistent', { loadContent: true });

      expect(mockLoadContent).not.toHaveBeenCalled();
      expect(mockLoadManifest).not.toHaveBeenCalled();
    });
  });

  // ============ has() ============

  describe('has', () => {
    it('should return true for existing packages', () => {
      expect(resolver.has('test-guide')).toBe(true);
      expect(resolver.has('another-guide')).toBe(true);
    });

    it('should return false for nonexistent packages', () => {
      expect(resolver.has('nonexistent')).toBe(false);
    });
  });

  // ============ listPackageIds() ============

  describe('listPackageIds', () => {
    it('should return all package IDs', () => {
      const ids = resolver.listPackageIds();
      expect(ids).toContain('test-guide');
      expect(ids).toContain('another-guide');
      expect(ids).toHaveLength(2);
    });
  });

  // ============ getRepository() ============

  describe('getRepository', () => {
    it('should return the underlying repository data', () => {
      expect(resolver.getRepository()).toBe(FIXTURE_REPO);
    });
  });
});

// ============ createBundledResolver ============

describe('createBundledResolver', () => {
  it('should create a resolver with bundled repository.json', () => {
    const resolver = createBundledResolver();

    expect(resolver).toBeInstanceOf(BundledPackageResolver);
    expect(resolver.listPackageIds().length).toBeGreaterThan(0);
  });

  it('should resolve packages from the actual bundled repository', async () => {
    const resolver = createBundledResolver();
    const result = await resolver.resolve('welcome-to-grafana');

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.id).toBe('welcome-to-grafana');
    expect(result.repository).toBe('bundled');
    expect(result.contentUrl).toContain('content.json');
    expect(result.manifestUrl).toContain('manifest.json');
  });
});
