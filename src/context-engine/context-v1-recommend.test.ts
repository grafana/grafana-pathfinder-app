/**
 * V1 Recommend Response Handling Tests
 *
 * Tests the context service's handling of POST /api/v1/recommend responses:
 * package-backed discrimination, URL-backed passthrough, mixed results,
 * sanitization of new fields, manifest passthrough, and deduplication.
 */

import { ContextService } from './context.service';
import type { V1RecommenderResponse } from '../types/v1-recommender.types';
import type { ContextData } from '../types/context.types';

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
          version: '10.0.0',
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
    getLocation: jest.fn(() => ({ pathname: '/dashboards', search: '', hash: '' })),
    getSearchObject: jest.fn(() => ({})),
  },
  getEchoSrv: jest.fn(() => ({
    addBackend: jest.fn(),
    addEvent: jest.fn(),
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

jest.mock('../docs-retrieval', () => ({
  fetchContent: jest.fn().mockResolvedValue({
    content: { metadata: { learningJourney: { milestones: [], summary: '' } } },
  }),
  getJourneyCompletionPercentageAsync: jest.fn().mockResolvedValue(0),
}));

jest.mock('../lib/user-storage', () => ({
  interactiveCompletionStorage: {
    get: jest.fn().mockResolvedValue(0),
    set: jest.fn(),
  },
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

const PLUGIN_CONFIG = {
  recommenderServiceUrl: 'https://recommender.grafana.com',
  acceptedTermsAndConditions: true,
};

function makeContextData(overrides: Partial<ContextData> = {}): ContextData {
  return {
    currentPath: '/alerting',
    currentUrl: 'http://localhost:3000/alerting',
    pathSegments: ['alerting'],
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
    platform: 'oss',
    ...overrides,
  };
}

function makeV1Response(overrides: Partial<V1RecommenderResponse> = {}): V1RecommenderResponse {
  return {
    recommendations: [],
    ...overrides,
  };
}

describe('V1 recommend response handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should call the legacy /recommend endpoint (v1 gated behind dev mode)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(makeV1Response()),
    });

    await ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);

    const calledUrl = mockFetch.mock.calls[0]?.[0] as string;
    expect(calledUrl).toBe('https://recommender.grafana.com/recommend');
  });

  it('should pass through URL-backed recommendations with sanitized fields', async () => {
    const v1Response = makeV1Response({
      recommendations: [
        {
          type: 'docs-page',
          title: 'Grafana Alerting<script>alert("xss")</script>',
          description: 'Docs for alerting',
          url: 'https://grafana.com/docs/alerting/',
          matchAccuracy: 0.85,
          matchedCriteria: ['urlPrefix:/alerting'],
        },
      ],
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(v1Response),
    });

    const result = await ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);

    expect(result.recommendations.length).toBeGreaterThanOrEqual(1);
    const urlBacked = result.recommendations.find((r) => r.type === 'docs-page');
    expect(urlBacked).toBeDefined();
    expect(urlBacked!.title).not.toContain('<script>');
    expect(urlBacked!.url).toBe('https://grafana.com/docs/alerting/');
  });

  it('should discriminate package-backed recommendations and carry manifest', async () => {
    const v1Response = makeV1Response({
      recommendations: [
        {
          type: 'package',
          title: 'Alerting 101',
          description: 'Hands-on alerting guide',
          source: 'package',
          matchAccuracy: 1.0,
          contentUrl: 'https://cdn.example.com/alerting-101/content.json',
          manifestUrl: 'https://cdn.example.com/alerting-101/manifest.json',
          repository: 'interactive-tutorials',
          manifest: {
            id: 'alerting-101',
            type: 'guide',
            category: 'general',
            author: { team: 'interactive-learning' },
            startingLocation: '/alerting',
            recommends: ['alerting-notifications'],
          },
        },
      ],
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(v1Response),
    });

    const result = await ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);

    const pkg = result.recommendations.find((r) => r.type === 'package');
    expect(pkg).toBeDefined();
    expect(pkg!.contentUrl).toBe('https://cdn.example.com/alerting-101/content.json');
    expect(pkg!.manifestUrl).toBe('https://cdn.example.com/alerting-101/manifest.json');
    expect(pkg!.repository).toBe('interactive-tutorials');
    expect(pkg!.manifest).toBeDefined();
    const manifest = pkg!.manifest as Record<string, unknown>;
    expect(manifest.id).toBe('alerting-101');
    expect(manifest.type).toBe('guide');
    expect(manifest.recommends).toEqual(['alerting-notifications']);
  });

  it('should handle mixed package-backed and URL-backed results', async () => {
    const v1Response = makeV1Response({
      recommendations: [
        {
          type: 'package',
          title: 'Alerting 101',
          source: 'package',
          matchAccuracy: 1.0,
          contentUrl: 'https://cdn.example.com/alerting-101/content.json',
          manifestUrl: 'https://cdn.example.com/alerting-101/manifest.json',
          repository: 'interactive-tutorials',
          manifest: { id: 'alerting-101', type: 'guide' },
        },
        {
          type: 'docs-page',
          title: 'Alerting docs',
          url: 'https://grafana.com/docs/alerting/',
          matchAccuracy: 0.85,
        },
      ],
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(v1Response),
    });

    const result = await ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);

    const packageRec = result.recommendations.find((r) => r.type === 'package');
    const urlRec = result.recommendations.find((r) => r.type === 'docs-page');
    expect(packageRec).toBeDefined();
    expect(urlRec).toBeDefined();
  });

  it('should sanitize manifest fields (XSS in description)', async () => {
    const v1Response = makeV1Response({
      recommendations: [
        {
          type: 'package',
          title: 'Guide',
          matchAccuracy: 0.9,
          contentUrl: 'https://cdn.example.com/guide/content.json',
          manifestUrl: 'https://cdn.example.com/guide/manifest.json',
          repository: 'test',
          manifest: {
            id: 'guide',
            type: 'guide',
            description: '<img onerror="alert(1)" src=x>',
          },
        },
      ],
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(v1Response),
    });

    const result = await ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);

    const pkg = result.recommendations.find((r) => r.type === 'package');
    expect(pkg).toBeDefined();
    const manifest = pkg!.manifest as Record<string, unknown>;
    expect(manifest.description).not.toContain('onerror');
  });

  it('should filter non-string items from manifest arrays', async () => {
    const v1Response = makeV1Response({
      recommendations: [
        {
          type: 'package',
          title: 'Guide',
          matchAccuracy: 0.9,
          contentUrl: 'https://cdn.example.com/guide/content.json',
          manifestUrl: 'https://cdn.example.com/guide/manifest.json',
          repository: 'test',
          manifest: {
            id: 'guide',
            type: 'guide',
            recommends: ['valid-id', 123 as any, null as any, 'another-valid'],
            depends: [{ nested: 'object' } as any, 'real-dep'],
          },
        },
      ],
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(v1Response),
    });

    const result = await ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);

    const pkg = result.recommendations.find((r) => r.type === 'package');
    const manifest = pkg!.manifest as Record<string, unknown>;
    expect(manifest.recommends).toEqual(['valid-id', 'another-valid']);
    expect(manifest.depends).toEqual(['real-dep']);
  });

  it('should handle package-backed featured recommendations', async () => {
    const v1Response = makeV1Response({
      recommendations: [],
      featured: [
        {
          type: 'package',
          title: 'Featured guide',
          matchAccuracy: 1.0,
          contentUrl: 'https://cdn.example.com/featured/content.json',
          manifestUrl: 'https://cdn.example.com/featured/manifest.json',
          repository: 'test',
          manifest: { id: 'featured-guide', type: 'guide' },
        },
      ],
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(v1Response),
    });

    const result = await ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);

    expect(result.featuredRecommendations.length).toBeGreaterThanOrEqual(1);
    const featured = result.featuredRecommendations.find((r) => r.type === 'package');
    expect(featured).toBeDefined();
    expect(featured!.manifest).toBeDefined();
  });

  it('should handle empty contentUrl/manifestUrl gracefully', async () => {
    const v1Response = makeV1Response({
      recommendations: [
        {
          type: 'package',
          title: 'Unresolved package',
          matchAccuracy: 0.9,
          contentUrl: '',
          manifestUrl: '',
          repository: 'test',
          manifest: { id: 'unresolved', type: 'guide' },
        },
      ],
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(v1Response),
    });

    const result = await ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);

    const pkg = result.recommendations.find((r) => r.type === 'package');
    expect(pkg).toBeDefined();
    expect(pkg!.contentUrl).toBe('');
  });

  it('should prevent prototype pollution (no spread of raw response)', async () => {
    const v1Response = makeV1Response({
      recommendations: [
        {
          type: 'docs-page',
          title: 'Malicious',
          url: 'https://grafana.com/docs/',
          matchAccuracy: 0.9,
          __proto__: { polluted: true },
          constructor: { polluted: true },
        } as any,
      ],
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(v1Response),
    });

    const result = await ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);

    const rec = result.recommendations.find((r) => r.title === 'Malicious');
    expect(rec).toBeDefined();
    expect((rec as any).__proto__).toBe(Object.prototype);
    expect((rec as any).constructor).toBe(Object);
    expect((rec as any).polluted).toBeUndefined();
  });

  it('should assign "package" type to package-backed recommendations', async () => {
    const v1Response = makeV1Response({
      recommendations: [
        {
          type: 'package',
          title: 'Package rec',
          matchAccuracy: 0.9,
          contentUrl: 'https://cdn.example.com/pkg/content.json',
          manifestUrl: 'https://cdn.example.com/pkg/manifest.json',
          repository: 'test',
          manifest: { id: 'pkg', type: 'guide' },
        },
      ],
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(v1Response),
    });

    const result = await ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);

    const pkg = result.recommendations.find((r) => r.contentUrl);
    expect(pkg?.type).toBe('package');
  });
});

describe('V1 recommendation deduplication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should deduplicate by matching title (case-insensitive)', async () => {
    const v1Response = makeV1Response({
      recommendations: [
        {
          type: 'package',
          title: 'Welcome to Grafana',
          matchAccuracy: 1.0,
          contentUrl: 'https://cdn.example.com/welcome/content.json',
          manifestUrl: 'https://cdn.example.com/welcome/manifest.json',
          repository: 'test',
          manifest: { id: 'welcome-to-grafana', type: 'guide' },
        },
      ],
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(v1Response),
    });

    const contextData = makeContextData({ currentPath: '/' });

    const result = await ContextService.fetchRecommendations(contextData, PLUGIN_CONFIG);

    const welcomeRecs = result.recommendations.filter((r) => r.title.toLowerCase().includes('welcome to grafana'));
    expect(welcomeRecs.length).toBeLessThanOrEqual(1);
  });
});
