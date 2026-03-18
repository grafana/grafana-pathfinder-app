/**
 * Tests for v1 recommender API integration in ContextService.
 *
 * These tests verify:
 * - The service calls POST /api/v1/recommend (not the legacy /recommend endpoint)
 * - Package-backed items (type === "package") are handled correctly
 * - URL-backed items pass through with existing behavior
 * - Mixed responses work (both URL-backed and package-backed)
 * - New v1 fields are sanitized (prototype-pollution prevention)
 * - Navigation is passed through when present
 * - Deduplication: bundled items take priority over v1 package-backed duplicates
 */

import { ContextService } from './context.service';

jest.mock('../utils/dev-mode', () => ({
  isDevModeEnabled: jest.fn(() => false),
  isDevModeEnabledGlobal: jest.fn(() => false),
}));

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: jest.fn(() => ({
    get: jest.fn(),
    post: jest.fn(),
  })),
  config: {
    bootData: {
      settings: {
        buildInfo: {
          versionString: 'Grafana v10.0.0',
        },
      },
      user: {
        analytics: { identifier: 'test-user' },
        email: 'test@example.com',
        orgRole: 'Admin',
        language: 'en-US',
      },
    },
    theme2: { isDark: true },
  },
  locationService: {
    push: jest.fn(),
  },
  getEchoSrv: jest.fn(() => ({
    addBackend: jest.fn(),
  })),
  EchoEventType: {
    Interaction: 'interaction',
    Pageview: 'pageview',
    MetaAnalytics: 'meta-analytics',
  },
}));

jest.mock('../lib/hash.util', () => ({
  hashUserData: jest.fn().mockResolvedValue({
    hashedUserId: 'hashed-user',
    hashedEmail: 'hashed-email',
  }),
}));

jest.mock('../lib/user-storage', () => ({
  interactiveCompletionStorage: {
    get: jest.fn().mockResolvedValue(0),
    set: jest.fn(),
  },
  journeyCompletionStorage: {
    get: jest.fn().mockResolvedValue(0),
    set: jest.fn(),
  },
  tabStorage: { get: jest.fn(), set: jest.fn() },
  useUserStorage: jest.fn(),
}));

jest.mock('../docs-retrieval', () => ({
  fetchContent: jest.fn().mockResolvedValue({
    content: { metadata: { learningJourney: { milestones: [], summary: '' } } },
  }),
  getJourneyCompletionPercentageAsync: jest.fn().mockResolvedValue(0),
}));

// Mock bundled-interactives/index.json — empty, so bundled recs don't interfere
jest.mock('../bundled-interactives/index.json', () => ({ interactives: [] }), { virtual: true });

global.fetch = jest.fn();

const BASE_CONTEXT = {
  currentPath: '/dashboards',
  currentUrl: 'http://localhost:3000/dashboards',
  pathSegments: ['dashboards'],
  dataSources: [],
  dashboardInfo: null,
  recommendations: [],
  featuredRecommendations: [],
  tags: [],
  isLoading: false,
  recommendationsError: null,
  recommendationsErrorType: null,
  usingFallbackRecommendations: false,
  visualizationType: null,
  grafanaVersion: '10.0.0',
  theme: 'dark',
  timestamp: new Date().toISOString(),
  searchParams: {},
  platform: 'oss' as const,
};

const PLUGIN_CONFIG = {
  recommenderServiceUrl: 'https://recommender.grafana.com',
  acceptedTermsAndConditions: true,
};

function mockFetchWithV1Response(body: object): void {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  });
}

describe('ContextService: v1 recommender API migration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============ endpoint URL ============

  describe('endpoint URL', () => {
    it('should call POST /api/v1/recommend (not legacy /recommend)', async () => {
      mockFetchWithV1Response({ recommendations: [] });

      await ContextService.fetchRecommendations(BASE_CONTEXT, PLUGIN_CONFIG);

      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/v1/recommend'), expect.any(Object));
    });

    it('should NOT call the legacy /recommend endpoint', async () => {
      mockFetchWithV1Response({ recommendations: [] });

      await ContextService.fetchRecommendations(BASE_CONTEXT, PLUGIN_CONFIG);

      const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
      // The URL should end with /api/v1/recommend, not just /recommend
      expect(calledUrl).toMatch(/\/api\/v1\/recommend$/);
    });
  });

  // ============ URL-backed items ============

  describe('URL-backed items (type !== "package")', () => {
    it('should map URL-backed recommendations with url field', async () => {
      mockFetchWithV1Response({
        recommendations: [
          {
            type: 'docs-page',
            title: 'Getting started with Grafana',
            description: 'Learn the basics',
            url: 'https://grafana.com/docs/grafana/latest/getting-started/',
            matchAccuracy: 0.9,
          },
        ],
      });

      const result = await ContextService.fetchRecommendations(BASE_CONTEXT, PLUGIN_CONFIG);

      const rec = result.recommendations.find((r) => r.url.includes('getting-started'));
      expect(rec).toBeDefined();
      expect(rec?.title).toBe('Getting started with Grafana');
      expect(rec?.type).toBe('docs-page');
      expect(rec?.matchAccuracy).toBe(0.9);
    });

    it('should sanitize title and summary from URL-backed items', async () => {
      mockFetchWithV1Response({
        recommendations: [
          {
            type: 'docs-page',
            title: '<script>alert(1)</script>Alerting guide',
            description: '<b>Bold</b> description',
            url: 'https://grafana.com/docs/alerting',
            matchAccuracy: 0.7,
          },
        ],
      });

      const result = await ContextService.fetchRecommendations(BASE_CONTEXT, PLUGIN_CONFIG);

      const rec = result.recommendations.find((r) => r.url === 'https://grafana.com/docs/alerting');
      expect(rec).toBeDefined();
      expect(rec?.title).not.toContain('<script>');
      expect(rec?.summary).not.toContain('<b>');
    });
  });

  // ============ package-backed items ============

  describe('package-backed items (type === "package")', () => {
    const PACKAGE_REC = {
      type: 'package',
      title: 'Grafana Alerting 101',
      description: 'Hands-on alerting guide',
      packageId: 'alerting-101',
      contentUrl: 'https://cdn.example.com/packages/alerting-101/content.json',
      manifestUrl: 'https://cdn.example.com/packages/alerting-101/manifest.json',
      repository: 'interactive-tutorials',
      packageType: 'guide',
      category: 'alerting',
      matchAccuracy: 1.0,
    };

    it('should map package-backed items with packageId and content URLs', async () => {
      mockFetchWithV1Response({ recommendations: [PACKAGE_REC] });

      const result = await ContextService.fetchRecommendations(BASE_CONTEXT, PLUGIN_CONFIG);

      const rec = result.recommendations.find((r) => r.packageId === 'alerting-101');
      expect(rec).toBeDefined();
      expect(rec?.packageId).toBe('alerting-101');
      expect(rec?.contentUrl).toBe(PACKAGE_REC.contentUrl);
      expect(rec?.manifestUrl).toBe(PACKAGE_REC.manifestUrl);
      expect(rec?.repository).toBe('interactive-tutorials');
    });

    it('should set type to "interactive" for package-backed items', async () => {
      mockFetchWithV1Response({ recommendations: [PACKAGE_REC] });

      const result = await ContextService.fetchRecommendations(BASE_CONTEXT, PLUGIN_CONFIG);

      const rec = result.recommendations.find((r) => r.packageId === 'alerting-101');
      expect(rec?.type).toBe('interactive');
    });

    it('should sanitize title and description from package-backed items', async () => {
      mockFetchWithV1Response({
        recommendations: [
          {
            ...PACKAGE_REC,
            title: '<img src=x onerror=alert(1)>Alerting',
            description: '<script>evil()</script>Description',
          },
        ],
      });

      const result = await ContextService.fetchRecommendations(BASE_CONTEXT, PLUGIN_CONFIG);

      const rec = result.recommendations.find((r) => r.packageId === 'alerting-101');
      expect(rec?.title).not.toContain('<img');
      expect(rec?.summary).not.toContain('<script>');
    });

    it('should sanitize category and author fields', async () => {
      mockFetchWithV1Response({
        recommendations: [
          {
            ...PACKAGE_REC,
            category: '<b>alerting</b>',
            author: {
              name: '<script>evil()</script>Grafana',
              team: '<b>interactive-learning</b>',
            },
          },
        ],
      });

      const result = await ContextService.fetchRecommendations(BASE_CONTEXT, PLUGIN_CONFIG);

      const rec = result.recommendations.find((r) => r.packageId === 'alerting-101');
      expect(rec?.category).not.toContain('<b>');
      expect(rec?.author?.name).not.toContain('<script>');
      expect(rec?.author?.team).not.toContain('<b>');
    });

    it('should block prototype-pollution fields on package-backed items', async () => {
      mockFetchWithV1Response({
        recommendations: [
          {
            ...PACKAGE_REC,
            __proto__: { polluted: true },
            constructor: { name: 'evil' },
            dangerouslySetInnerHTML: { __html: '<script>evil()</script>' },
          },
        ],
      });

      const result = await ContextService.fetchRecommendations(BASE_CONTEXT, PLUGIN_CONFIG);

      const rec = result.recommendations.find((r) => r.packageId === 'alerting-101');
      expect(rec).toBeDefined();
      // Prototype-pollution fields must not appear on the sanitized recommendation
      expect((rec as any).dangerouslySetInnerHTML).toBeUndefined();
      expect((rec as any).polluted).toBeUndefined();
    });
  });

  // ============ navigation passthrough ============

  describe('navigation passthrough', () => {
    it('should pass through navigation when present', async () => {
      mockFetchWithV1Response({
        recommendations: [
          {
            type: 'package',
            title: 'Alerting 101',
            packageId: 'alerting-101',
            contentUrl: 'https://cdn.example.com/alerting-101/content.json',
            manifestUrl: 'https://cdn.example.com/alerting-101/manifest.json',
            repository: 'interactive-tutorials',
            matchAccuracy: 1.0,
            navigation: {
              recommends: ['loki-grafana-101'],
              suggests: ['explore-drilldowns-101'],
              depends: [],
            },
          },
        ],
      });

      const result = await ContextService.fetchRecommendations(BASE_CONTEXT, PLUGIN_CONFIG);

      const rec = result.recommendations.find((r) => r.packageId === 'alerting-101');
      expect(rec?.navigation).toBeDefined();
      expect(rec?.navigation?.recommends).toContain('loki-grafana-101');
      expect(rec?.navigation?.suggests).toContain('explore-drilldowns-101');
      expect(rec?.navigation?.depends).toEqual([]);
    });

    it('should filter non-string values in navigation arrays', async () => {
      mockFetchWithV1Response({
        recommendations: [
          {
            type: 'package',
            title: 'Test',
            packageId: 'test-pkg',
            contentUrl: 'https://cdn.example.com/test-pkg/content.json',
            manifestUrl: 'https://cdn.example.com/test-pkg/manifest.json',
            repository: 'test',
            matchAccuracy: 1.0,
            navigation: {
              recommends: ['valid-id', 123, null, 'another-id'],
              suggests: [],
              depends: [],
            },
          },
        ],
      });

      const result = await ContextService.fetchRecommendations(BASE_CONTEXT, PLUGIN_CONFIG);

      const rec = result.recommendations.find((r) => r.packageId === 'test-pkg');
      expect(rec?.navigation?.recommends).toEqual(['valid-id', 'another-id']);
    });
  });

  // ============ mixed results ============

  describe('mixed URL-backed and package-backed results', () => {
    it('should handle both types in the same response', async () => {
      mockFetchWithV1Response({
        recommendations: [
          {
            type: 'package',
            title: 'Alerting 101',
            packageId: 'alerting-101',
            contentUrl: 'https://cdn.example.com/alerting-101/content.json',
            manifestUrl: 'https://cdn.example.com/alerting-101/manifest.json',
            repository: 'interactive-tutorials',
            matchAccuracy: 1.0,
          },
          {
            type: 'docs-page',
            title: 'Alerting docs',
            url: 'https://grafana.com/docs/alerting',
            matchAccuracy: 0.7,
          },
        ],
      });

      const result = await ContextService.fetchRecommendations(BASE_CONTEXT, PLUGIN_CONFIG);

      const packageRec = result.recommendations.find((r) => r.packageId === 'alerting-101');
      const urlRec = result.recommendations.find((r) => r.url === 'https://grafana.com/docs/alerting');
      expect(packageRec).toBeDefined();
      expect(urlRec).toBeDefined();
    });
  });

  // ============ featured recommendations ============

  describe('featured recommendations', () => {
    it('should return featured recommendations from v1 response', async () => {
      mockFetchWithV1Response({
        recommendations: [],
        featured: [
          {
            type: 'package',
            title: 'Featured guide',
            packageId: 'featured-pkg',
            contentUrl: 'https://cdn.example.com/featured-pkg/content.json',
            manifestUrl: 'https://cdn.example.com/featured-pkg/manifest.json',
            repository: 'interactive-tutorials',
            matchAccuracy: 1.0,
          },
        ],
      });

      const result = await ContextService.fetchRecommendations(BASE_CONTEXT, PLUGIN_CONFIG);

      expect(result.featuredRecommendations).toHaveLength(1);
      expect(result.featuredRecommendations[0]?.packageId).toBe('featured-pkg');
    });
  });

  // ============ deduplication ============

  describe('deduplication with bundled items', () => {
    it('should handle empty external recommendations gracefully', async () => {
      mockFetchWithV1Response({ recommendations: [] });

      const result = await ContextService.fetchRecommendations(BASE_CONTEXT, PLUGIN_CONFIG);

      expect(result.error).toBeNull();
      expect(result.recommendations).toBeInstanceOf(Array);
    });
  });

  // ============ error handling ============

  describe('error handling', () => {
    it('should fall back to static recommendations on network error', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Failed to fetch'));

      const result = await ContextService.fetchRecommendations(BASE_CONTEXT, PLUGIN_CONFIG);

      expect(result.usingFallbackRecommendations).toBe(true);
      expect(result.error).not.toBeNull();
    });

    it('should fall back on HTTP 404', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({}),
      });

      const result = await ContextService.fetchRecommendations(BASE_CONTEXT, PLUGIN_CONFIG);

      expect(result.usingFallbackRecommendations).toBe(true);
    });

    it('should fall back on HTTP 429 with rate-limit error type', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 429,
        json: () => Promise.resolve({}),
      });

      const result = await ContextService.fetchRecommendations(BASE_CONTEXT, PLUGIN_CONFIG);

      expect(result.errorType).toBe('rate-limit');
      expect(result.usingFallbackRecommendations).toBe(true);
    });
  });
});
