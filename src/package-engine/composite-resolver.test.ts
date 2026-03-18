/**
 * CompositePackageResolver Tests (Layer 2)
 *
 * Tests first-wins ordering, all-fail fallback, and the
 * createCompositeResolver factory with plugin config.
 */

import type { PackageResolution, PackageResolver, ResolveOptions } from '../types/package.types';
import { CompositePackageResolver, createCompositeResolver } from './composite-resolver';

// ============ HELPERS ============

function makeSuccessResolver(id: string, repository = 'test-repo'): PackageResolver {
  return {
    resolve: jest.fn().mockResolvedValue({
      ok: true,
      id,
      contentUrl: `https://cdn.example.com/${id}/content.json`,
      manifestUrl: `https://cdn.example.com/${id}/manifest.json`,
      repository,
    } as PackageResolution),
  };
}

function makeNotFoundResolver(): PackageResolver {
  return {
    resolve: jest.fn().mockResolvedValue({
      ok: false,
      id: 'unknown',
      error: { code: 'not-found', message: 'Not found' },
    } as PackageResolution),
  };
}

function makeNetworkErrorResolver(): PackageResolver {
  return {
    resolve: jest.fn().mockResolvedValue({
      ok: false,
      id: 'unknown',
      error: { code: 'network-error', message: 'Network failure' },
    } as PackageResolution),
  };
}

// ============ TESTS ============

describe('CompositePackageResolver', () => {
  // ============ construction ============

  describe('constructor', () => {
    it('should throw when no resolvers are provided', () => {
      expect(() => new CompositePackageResolver([])).toThrow();
    });

    it('should accept a single resolver', () => {
      expect(() => new CompositePackageResolver([makeSuccessResolver('pkg')])).not.toThrow();
    });
  });

  // ============ first-wins ordering ============

  describe('resolve — first-wins ordering', () => {
    it('should return the first resolver result when it succeeds', async () => {
      const first = makeSuccessResolver('pkg', 'bundled');
      const second = makeSuccessResolver('pkg', 'recommender');
      const composite = new CompositePackageResolver([first, second]);

      const result = await composite.resolve('pkg');

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.repository).toBe('bundled');
      expect(second.resolve).not.toHaveBeenCalled();
    });

    it('should fall through to second resolver when first returns not-found', async () => {
      const first = makeNotFoundResolver();
      const second = makeSuccessResolver('pkg', 'recommender');
      const composite = new CompositePackageResolver([first, second]);

      const result = await composite.resolve('pkg');

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.repository).toBe('recommender');
      expect(first.resolve).toHaveBeenCalled();
      expect(second.resolve).toHaveBeenCalled();
    });

    it('should pass options through to each resolver', async () => {
      const first = makeNotFoundResolver();
      const second = makeSuccessResolver('pkg');
      const composite = new CompositePackageResolver([first, second]);
      const options: ResolveOptions = { loadContent: true };

      await composite.resolve('pkg', options);

      expect(first.resolve).toHaveBeenCalledWith('pkg', options);
      expect(second.resolve).toHaveBeenCalledWith('pkg', options);
    });

    it('should try resolvers in order when multiple fail', async () => {
      const callOrder: number[] = [];
      const r1: PackageResolver = {
        resolve: jest.fn().mockImplementation(async () => {
          callOrder.push(1);
          return { ok: false, id: 'pkg', error: { code: 'not-found', message: 'No' } };
        }),
      };
      const r2: PackageResolver = {
        resolve: jest.fn().mockImplementation(async () => {
          callOrder.push(2);
          return { ok: false, id: 'pkg', error: { code: 'not-found', message: 'No' } };
        }),
      };
      const r3: PackageResolver = {
        resolve: jest.fn().mockImplementation(async () => {
          callOrder.push(3);
          return { ok: true, id: 'pkg', contentUrl: 'x', manifestUrl: 'y', repository: 'r3' };
        }),
      };
      const composite = new CompositePackageResolver([r1, r2, r3]);

      await composite.resolve('pkg');

      expect(callOrder).toEqual([1, 2, 3]);
    });
  });

  // ============ all-fail fallback ============

  describe('resolve — all-fail fallback', () => {
    it('should return the last failure when all resolvers fail', async () => {
      const first = makeNotFoundResolver();
      const last = makeNetworkErrorResolver();
      const composite = new CompositePackageResolver([first, last]);

      const result = await composite.resolve('unknown');

      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      // Should be the last resolver's error
      expect(result.error.code).toBe('network-error');
    });

    it('should work with a single failing resolver', async () => {
      const resolver = makeNotFoundResolver();
      const composite = new CompositePackageResolver([resolver]);

      const result = await composite.resolve('missing');

      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.error.code).toBe('not-found');
    });
  });
});

// ============ createCompositeResolver factory ============

jest.mock('./resolver', () => ({
  createBundledResolver: jest.fn(() => ({
    resolve: jest.fn().mockResolvedValue({
      ok: false,
      id: 'unknown',
      error: { code: 'not-found', message: 'Not in bundled repo' },
    }),
  })),
  BundledPackageResolver: jest.fn(),
}));

jest.mock('./recommender-resolver', () => ({
  RecommenderPackageResolver: jest.fn().mockImplementation(() => ({
    resolve: jest.fn().mockResolvedValue({
      ok: true,
      id: 'remote-pkg',
      contentUrl: 'https://cdn.example.com/remote-pkg/content.json',
      manifestUrl: 'https://cdn.example.com/remote-pkg/manifest.json',
      repository: 'interactive-tutorials',
    }),
  })),
}));

jest.mock('../constants', () => ({
  isRecommenderEnabled: jest.fn(),
  getConfigWithDefaults: jest.fn().mockReturnValue({
    recommenderServiceUrl: 'https://recommender.example.com',
  }),
}));

import { isRecommenderEnabled } from '../constants';

const mockIsRecommenderEnabled = isRecommenderEnabled as jest.MockedFunction<typeof isRecommenderEnabled>;

describe('createCompositeResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create a CompositePackageResolver', () => {
    mockIsRecommenderEnabled.mockReturnValue(false);
    const composite = createCompositeResolver({});
    expect(composite).toBeInstanceOf(CompositePackageResolver);
  });

  it('should include only bundled resolver when recommender is disabled', async () => {
    mockIsRecommenderEnabled.mockReturnValue(false);
    const composite = createCompositeResolver({});

    // With recommender disabled, the RecommenderPackageResolver constructor should not be called
    const { RecommenderPackageResolver } = require('./recommender-resolver');
    expect(RecommenderPackageResolver).not.toHaveBeenCalled();

    // Resolving a package should only try bundled
    const result = await composite.resolve('some-pkg');
    expect(result.ok).toBe(false); // bundled returns not-found in mock
  });

  it('should include recommender resolver when recommender is enabled', async () => {
    mockIsRecommenderEnabled.mockReturnValue(true);
    const composite = createCompositeResolver({ acceptedTermsAndConditions: true });

    // Falls through bundled (not-found) to recommender (success)
    const result = await composite.resolve('remote-pkg');
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.repository).toBe('interactive-tutorials');
  });
});
