/**
 * V1 Recommend Response Handling Tests
 *
 * Verifies current branch isolation for the legacy /recommend endpoint while
 * exercising the additive V1 sanitization helpers directly.
 */

import { ContextService } from './context.service';
import type { V1RecommenderResponse } from '../types/v1-recommender.types';
import type { ContextData, Recommendation } from '../types/context.types';

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

describe('Legacy recommend branch isolation', () => {
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

  it('should preserve summary from the legacy /recommend response', async () => {
    const legacyResponse = {
      recommendations: [
        {
          type: 'docs-page',
          title: 'Grafana Alerting',
          summary: 'Legacy summary text',
          url: 'https://grafana.com/docs/alerting/',
          matchAccuracy: 0.85,
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(legacyResponse),
    });

    const result = await ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);

    const urlBacked = result.recommendations.find((r) => r.type === 'docs-page');
    expect(urlBacked).toBeDefined();
    expect(urlBacked!.summary).toBe('Legacy summary text');
  });

  it('should sanitize legacy recommendations without spreading raw properties', async () => {
    const legacyResponse = {
      recommendations: [
        {
          type: 'docs-page',
          title: 'Grafana Alerting<script>alert("xss")</script>',
          summary: 'Docs for alerting',
          url: 'https://grafana.com/docs/alerting/',
          matchAccuracy: 0.9,
          __proto__: { polluted: true },
          constructor: { polluted: true },
          contentUrl: 'https://should-not-pass-through.example.com',
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(legacyResponse),
    });

    const result = await ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);

    const rec = result.recommendations.find((r) => r.type === 'docs-page');
    expect(rec).toBeDefined();
    expect(rec!.title).not.toContain('<script>');
    expect((rec as Recommendation).contentUrl).toBeUndefined();
    expect((rec as any).polluted).toBeUndefined();
  });
});

describe('Additive V1 recommendation helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should sanitize package-backed recommendations and carry manifest', () => {
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

    const sanitizeV1Recommendation = (ContextService as any).sanitizeV1Recommendation.bind(ContextService);
    const pkg = sanitizeV1Recommendation(v1Response.recommendations[0]);

    expect(pkg.type).toBe('package');
    expect(pkg.contentUrl).toBe('https://cdn.example.com/pkg/content.json');
    expect(pkg.manifestUrl).toBe('https://cdn.example.com/pkg/manifest.json');
    expect(pkg.repository).toBe('test');
    expect(pkg.manifest).toEqual({ id: 'pkg', type: 'guide' });
  });

  it('should sanitize manifest fields (XSS in description)', () => {
    const sanitizeV1Recommendation = (ContextService as any).sanitizeV1Recommendation.bind(ContextService);
    const pkg = sanitizeV1Recommendation({
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
    });

    const manifest = pkg.manifest as Record<string, unknown>;
    expect(manifest.description).not.toContain('onerror');
  });

  it('should filter non-string items from manifest arrays', () => {
    const sanitizeV1Recommendation = (ContextService as any).sanitizeV1Recommendation.bind(ContextService);
    const pkg = sanitizeV1Recommendation({
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
    });

    const manifest = pkg.manifest as Record<string, unknown>;
    expect(manifest.recommends).toEqual(['valid-id', 'another-valid']);
    expect(manifest.depends).toEqual(['real-dep']);
  });

  it('should handle empty contentUrl/manifestUrl gracefully', () => {
    const sanitizeV1Recommendation = (ContextService as any).sanitizeV1Recommendation.bind(ContextService);
    const pkg = sanitizeV1Recommendation({
      type: 'package',
      title: 'Unresolved package',
      matchAccuracy: 0.9,
      contentUrl: '',
      manifestUrl: '',
      repository: 'test',
      manifest: { id: 'unresolved', type: 'guide' },
    });

    expect(pkg.contentUrl).toBe('');
    expect(pkg.manifestUrl).toBe('');
  });

  it('should prevent prototype pollution (no spread of raw response)', () => {
    const sanitizeV1Recommendation = (ContextService as any).sanitizeV1Recommendation.bind(ContextService);
    const rec = sanitizeV1Recommendation({
      type: 'docs-page',
      title: 'Malicious',
      url: 'https://grafana.com/docs/',
      matchAccuracy: 0.9,
      __proto__: { polluted: true },
      constructor: { polluted: true },
    } as any);

    expect((rec as any).__proto__).toBe(Object.prototype);
    expect((rec as any).constructor).toBe(Object);
    expect((rec as any).polluted).toBeUndefined();
  });

  it('should deduplicate by matching title (case-insensitive)', () => {
    const deduplicateRecommendations = (ContextService as any).deduplicateRecommendations.bind(ContextService);
    const externalRecs: Recommendation[] = [
      {
        title: 'Welcome to Grafana',
        url: '',
        type: 'package',
        manifest: { id: 'welcome-to-grafana', type: 'guide' },
      },
    ];
    const bundledRecs: Recommendation[] = [
      {
        title: 'Welcome to Grafana',
        url: 'bundled:welcome-to-grafana',
        type: 'interactive',
      },
    ];

    const deduplicated = deduplicateRecommendations(externalRecs, bundledRecs);
    expect(deduplicated).toEqual([]);
  });
});
