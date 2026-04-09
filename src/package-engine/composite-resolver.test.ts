/**
 * Composite Package Resolver Tests (Layer 2)
 *
 * Tests resolution ordering, fallback behavior, and recommender gating.
 */

import type { PackageResolution, PackageResolver, ResolveOptions } from '../types/package.types';

import { CompositePackageResolver, createCompositeResolver } from './composite-resolver';

jest.mock('./resolver', () => ({
  createBundledResolver: jest.fn(() => mockBundledResolver),
}));

jest.mock('./recommender-resolver', () => ({
  RecommenderPackageResolver: jest.fn().mockImplementation(() => mockRecommenderResolver),
}));

const mockBundledResolver: PackageResolver = {
  resolve: jest.fn(),
};

const mockRecommenderResolver: PackageResolver = {
  resolve: jest.fn(),
};

const SUCCESS_BUNDLED: PackageResolution = {
  ok: true,
  id: 'test-guide',
  contentUrl: 'bundled:test-guide/content.json',
  manifestUrl: 'bundled:test-guide/manifest.json',
  repository: 'bundled',
};

const SUCCESS_RECOMMENDER: PackageResolution = {
  ok: true,
  id: 'remote-guide',
  contentUrl: 'https://cdn.example.com/remote-guide/content.json',
  manifestUrl: 'https://cdn.example.com/remote-guide/manifest.json',
  repository: 'interactive-tutorials',
};

const NOT_FOUND: PackageResolution = {
  ok: false,
  id: 'missing',
  error: { code: 'not-found', message: 'not found' },
};

describe('CompositePackageResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('resolution ordering', () => {
    it('should return the first successful result (bundled wins)', async () => {
      (mockBundledResolver.resolve as jest.Mock).mockResolvedValueOnce(SUCCESS_BUNDLED);

      const composite = new CompositePackageResolver([mockBundledResolver, mockRecommenderResolver]);
      const result = await composite.resolve('test-guide');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.repository).toBe('bundled');
      }
      expect(mockRecommenderResolver.resolve).not.toHaveBeenCalled();
    });

    it('should fall through to recommender when bundled misses', async () => {
      (mockBundledResolver.resolve as jest.Mock).mockResolvedValueOnce(NOT_FOUND);
      (mockRecommenderResolver.resolve as jest.Mock).mockResolvedValueOnce(SUCCESS_RECOMMENDER);

      const composite = new CompositePackageResolver([mockBundledResolver, mockRecommenderResolver]);
      const result = await composite.resolve('remote-guide');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.repository).toBe('interactive-tutorials');
      }
      expect(mockBundledResolver.resolve).toHaveBeenCalledTimes(1);
      expect(mockRecommenderResolver.resolve).toHaveBeenCalledTimes(1);
    });

    it('should return the last failure when all resolvers miss', async () => {
      const recommenderFailure: PackageResolution = {
        ok: false,
        id: 'missing',
        error: { code: 'network-error', message: 'timeout' },
      };
      (mockBundledResolver.resolve as jest.Mock).mockResolvedValueOnce(NOT_FOUND);
      (mockRecommenderResolver.resolve as jest.Mock).mockResolvedValueOnce(recommenderFailure);

      const composite = new CompositePackageResolver([mockBundledResolver, mockRecommenderResolver]);
      const result = await composite.resolve('missing');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('network-error');
      }
    });

    it('should pass resolve options through to all resolvers', async () => {
      (mockBundledResolver.resolve as jest.Mock).mockResolvedValueOnce(NOT_FOUND);
      (mockRecommenderResolver.resolve as jest.Mock).mockResolvedValueOnce(SUCCESS_RECOMMENDER);

      const options: ResolveOptions = { loadContent: true };
      const composite = new CompositePackageResolver([mockBundledResolver, mockRecommenderResolver]);
      await composite.resolve('remote-guide', options);

      expect(mockBundledResolver.resolve).toHaveBeenCalledWith('remote-guide', options);
      expect(mockRecommenderResolver.resolve).toHaveBeenCalledWith('remote-guide', options);
    });
  });

  describe('empty resolver list', () => {
    it('should return a not-found failure with no resolvers', async () => {
      const composite = new CompositePackageResolver([]);
      const result = await composite.resolve('anything');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('not-found');
        expect(result.error.message).toContain('No resolvers configured');
      }
    });
  });

  describe('single resolver', () => {
    it('should work with only the bundled resolver', async () => {
      (mockBundledResolver.resolve as jest.Mock).mockResolvedValueOnce(SUCCESS_BUNDLED);

      const composite = new CompositePackageResolver([mockBundledResolver]);
      const result = await composite.resolve('test-guide');

      expect(result.ok).toBe(true);
    });
  });

  describe('resolution caching', () => {
    it('should return cached result for the same packageId and options', async () => {
      (mockBundledResolver.resolve as jest.Mock).mockResolvedValue(SUCCESS_BUNDLED);

      const composite = new CompositePackageResolver([mockBundledResolver]);
      const first = await composite.resolve('test-guide');
      const second = await composite.resolve('test-guide');

      expect(first).toBe(second);
      expect(mockBundledResolver.resolve).toHaveBeenCalledTimes(1);
    });

    it('should cache separately for loadContent true vs false', async () => {
      (mockBundledResolver.resolve as jest.Mock).mockResolvedValue(SUCCESS_BUNDLED);

      const composite = new CompositePackageResolver([mockBundledResolver]);
      await composite.resolve('test-guide', { loadContent: false });
      await composite.resolve('test-guide', { loadContent: true });

      expect(mockBundledResolver.resolve).toHaveBeenCalledTimes(2);
    });

    it('should cache separately for different package IDs', async () => {
      (mockBundledResolver.resolve as jest.Mock).mockResolvedValue(SUCCESS_BUNDLED);

      const composite = new CompositePackageResolver([mockBundledResolver]);
      await composite.resolve('guide-a');
      await composite.resolve('guide-b');

      expect(mockBundledResolver.resolve).toHaveBeenCalledTimes(2);
    });

    it('should cache failures too (prevents repeated failed lookups)', async () => {
      (mockBundledResolver.resolve as jest.Mock).mockResolvedValue(NOT_FOUND);

      const composite = new CompositePackageResolver([mockBundledResolver]);
      const first = await composite.resolve('missing');
      const second = await composite.resolve('missing');

      expect(first).toBe(second);
      expect(first.ok).toBe(false);
      expect(mockBundledResolver.resolve).toHaveBeenCalledTimes(1);
    });
  });
});

describe('createCompositeResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create a resolver with only bundled when recommender is disabled', () => {
    const resolver = createCompositeResolver({ acceptedTermsAndConditions: false });
    expect(resolver).toBeInstanceOf(CompositePackageResolver);

    const { RecommenderPackageResolver } = require('./recommender-resolver');
    expect(RecommenderPackageResolver).not.toHaveBeenCalled();
  });

  it('should create a resolver with bundled + recommender when enabled', () => {
    const resolver = createCompositeResolver({ acceptedTermsAndConditions: true });
    expect(resolver).toBeInstanceOf(CompositePackageResolver);

    const { RecommenderPackageResolver } = require('./recommender-resolver');
    expect(RecommenderPackageResolver).toHaveBeenCalledWith('https://recommender.grafana.com');
  });

  it('should use custom recommender URL from config', () => {
    const resolver = createCompositeResolver({
      acceptedTermsAndConditions: true,
      recommenderServiceUrl: 'https://custom-recommender.example.com',
    });
    expect(resolver).toBeInstanceOf(CompositePackageResolver);

    const { RecommenderPackageResolver } = require('./recommender-resolver');
    expect(RecommenderPackageResolver).toHaveBeenCalledWith('https://custom-recommender.example.com');
  });
});
