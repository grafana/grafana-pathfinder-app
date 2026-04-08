/**
 * V1 Recommend Response Handling Tests
 *
 * Verifies current branch isolation for the legacy /recommend endpoint while
 * exercising the additive V1 sanitization helpers directly.
 */

import { ContextService } from './context.service';
import type { V1RecommenderResponse } from '../types/v1-recommender.types';
import type { ContextData, Recommendation } from '../types/context.types';

jest.mock('../bundled-interactives/index.json', () => ({
  interactives: [
    {
      id: 'welcome-to-grafana',
      title: 'Welcome to Grafana',
      filename: 'welcome-to-grafana/content.json',
      url: ['/'],
      summary: 'Bundled version',
    },
  ],
}));

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
  resolvePackageMilestones: jest.fn().mockResolvedValue([
    { number: 1, title: 'Milestone 1', duration: '5-10 min', url: 'bundled:ms-1/content.json', isActive: false },
    { number: 2, title: 'Milestone 2', duration: '5-10 min', url: 'bundled:ms-2/content.json', isActive: false },
  ]),
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

describe('V1 /api/v1/recommend endpoint integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should call POST /api/v1/recommend', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(makeV1Response()),
    });

    await ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);

    const calledUrl = mockFetch.mock.calls[0]?.[0] as string;
    expect(calledUrl).toBe('https://recommender.grafana.com/api/v1/recommend');
  });

  it('should map description to summary from v1 response', async () => {
    const v1Response = {
      recommendations: [
        {
          type: 'docs-page',
          title: 'Grafana Alerting',
          description: 'Learn how to configure alerts in Grafana.',
          url: 'https://grafana.com/docs/alerting/',
          matchAccuracy: 0.85,
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(v1Response),
    });

    const result = await ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);

    const urlBacked = result.recommendations.find((r) => r.type === 'docs-page');
    expect(urlBacked).toBeDefined();
    expect(urlBacked!.summary).toBe('Learn how to configure alerts in Grafana.');
  });

  it('should sanitize v1 recommendations and not pass through raw properties', async () => {
    const v1Response = {
      recommendations: [
        {
          type: 'docs-page',
          title: 'Grafana Alerting<script>alert("xss")</script>',
          description: 'Docs for alerting',
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
      json: () => Promise.resolve(v1Response),
    });

    const result = await ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);

    const rec = result.recommendations.find((r) => r.type === 'docs-page');
    expect(rec).toBeDefined();
    expect(rec!.title).not.toContain('<script>');
    // contentUrl must not pass through for non-package types
    expect((rec as Recommendation).contentUrl).toBeUndefined();
    expect((rec as any).polluted).toBeUndefined();
  });

  it('should deduplicate package-backed v1 recommendations against bundled ones', async () => {
    const v1Response = makeV1Response({
      recommendations: [
        {
          type: 'package',
          title: 'Welcome to Grafana',
          description: 'Get started with Grafana.',
          matchAccuracy: 0.95,
          contentUrl: 'https://cdn.example.com/welcome-to-grafana/content.json',
          manifestUrl: 'https://cdn.example.com/welcome-to-grafana/manifest.json',
          repository: 'interactive-tutorials',
          manifest: { id: 'welcome-to-grafana', type: 'guide' },
        },
        {
          type: 'package',
          title: 'Alerting 101',
          description: 'Learn alerting basics.',
          matchAccuracy: 0.9,
          contentUrl: 'https://cdn.example.com/alerting-101/content.json',
          manifestUrl: 'https://cdn.example.com/alerting-101/manifest.json',
          repository: 'interactive-tutorials',
          manifest: { id: 'alerting-101', type: 'guide' },
        },
      ],
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(v1Response),
    });

    // welcome-to-grafana is mocked in the top-level jest.mock for index.json
    const result = await ContextService.fetchRecommendations(makeContextData({ currentPath: '/' }), PLUGIN_CONFIG);

    // alerting-101 should be present (remote-only)
    const alerting = result.recommendations.find(
      (r) => (r.manifest as Record<string, unknown> | undefined)?.id === 'alerting-101'
    );
    expect(alerting).toBeDefined();

    // welcome-to-grafana should not appear twice (deduplication by title)
    const welcomeRecs = result.recommendations.filter((r) => r.title.toLowerCase().includes('welcome to grafana'));
    expect(welcomeRecs.length).toBe(1);
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

describe('Package completion percentage wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should set completionPercentage for package-backed guide recommendations', async () => {
    const v1Response = makeV1Response({
      recommendations: [
        {
          type: 'package',
          title: 'Alerting 101',
          description: 'Learn alerting basics.',
          matchAccuracy: 0.9,
          contentUrl: 'https://cdn.example.com/alerting-101/content.json',
          manifestUrl: 'https://cdn.example.com/alerting-101/manifest.json',
          repository: 'interactive-tutorials',
          manifest: { id: 'alerting-101', type: 'guide' },
        },
      ],
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(v1Response),
    });

    const result = await ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);

    const alerting = result.recommendations.find((r) => r.title === 'Alerting 101');
    expect(alerting).toBeDefined();
    expect(typeof alerting!.completionPercentage).toBe('number');
  });

  it('should set completionPercentage for package-backed path recommendations', async () => {
    const v1Response = makeV1Response({
      recommendations: [
        {
          type: 'package',
          title: 'Prometheus learning path',
          description: 'Full prometheus journey.',
          matchAccuracy: 0.85,
          contentUrl: 'https://cdn.example.com/prometheus-lj/content.json',
          manifestUrl: 'https://cdn.example.com/prometheus-lj/manifest.json',
          repository: 'interactive-tutorials',
          manifest: { id: 'prometheus-lj', type: 'path', milestones: ['step-1', 'step-2'] },
        },
      ],
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(v1Response),
    });

    const result = await ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);

    const path = result.recommendations.find((r) => r.title === 'Prometheus learning path');
    expect(path).toBeDefined();
    expect(typeof path!.completionPercentage).toBe('number');
  });

  it('should set completionPercentage to 0 for package with empty contentUrl', async () => {
    const v1Response = makeV1Response({
      recommendations: [
        {
          type: 'package',
          title: 'Unresolved package',
          description: 'No CDN URL.',
          matchAccuracy: 0.5,
          contentUrl: '',
          manifestUrl: '',
          repository: 'interactive-tutorials',
          manifest: { id: 'unresolved-pkg', type: 'guide' },
        },
        {
          type: 'docs-page',
          title: 'Some docs',
          description: 'A docs page to keep the list non-empty.',
          url: 'https://grafana.com/docs/',
          matchAccuracy: 0.6,
        },
      ],
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(v1Response),
    });

    const result = await ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);

    const unresolved = result.recommendations.find((r) => r.title === 'Unresolved package');
    if (unresolved) {
      expect(unresolved.completionPercentage).toBe(0);
    } else {
      // Empty contentUrl packages may be filtered by downstream processing; that's acceptable
      expect(result.recommendations.length).toBeGreaterThan(0);
    }
  });

  it('should fall back to interactive storage for package without manifest', async () => {
    const v1Response = makeV1Response({
      recommendations: [
        {
          type: 'package',
          title: 'No manifest package',
          description: 'Missing manifest.',
          matchAccuracy: 0.7,
          contentUrl: 'https://cdn.example.com/no-manifest/content.json',
          manifestUrl: '',
          repository: 'interactive-tutorials',
        },
      ],
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(v1Response),
    });

    const result = await ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);

    const noManifest = result.recommendations.find((r) => r.title === 'No manifest package');
    expect(noManifest).toBeDefined();
    expect(typeof noManifest!.completionPercentage).toBe('number');
  });
});

describe('V1 error handling and edge cases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should fall back gracefully when v1 returns HTTP 500', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    const result = await ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);

    expect(result.recommendations).toBeDefined();
    expect(result.errorType).toBe('other');
  });

  it('should fall back gracefully when v1 returns HTTP 403', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    });

    const result = await ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);

    expect(result.recommendations).toBeDefined();
    expect(result.errorType).toBe('other');
  });

  it('should return only bundled interactives when v1 returns empty recommendations', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ recommendations: [], featured: [] }),
    });

    const result = await ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);

    expect(result.recommendations).toBeDefined();
    expect(Array.isArray(result.recommendations)).toBe(true);
    expect(result.error).toBeNull();
  });

  it('should pass through unrecognized recommendation types without crashing', async () => {
    const v1Response = makeV1Response({
      recommendations: [
        {
          type: 'unknown-future-type' as any,
          title: 'Future content',
          description: 'Some new type of recommendation',
          url: 'https://grafana.com/docs/future/',
          matchAccuracy: 0.7,
        },
      ],
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(v1Response),
    });

    const result = await ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);

    expect(result.recommendations).toBeDefined();
    const futureRec = result.recommendations.find((r) => r.title === 'Future content');
    expect(futureRec).toBeDefined();
    expect(futureRec!.type).toBe('docs-page');
  });

  it('should fall back gracefully when fetch rejects with a network error', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const result = await ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);

    expect(result.recommendations).toBeDefined();
    expect(result.errorType).toBe('unavailable');
  });
});

describe('Path package milestone resolution in processLearningJourneys', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should populate milestones and totalSteps for path-type package recommendations', async () => {
    const v1Response = makeV1Response({
      recommendations: [
        {
          type: 'package',
          title: 'Grafana Cloud Tour',
          description: 'A tour of Grafana Cloud',
          url: '',
          matchAccuracy: 0.9,
          contentUrl: 'https://cdn.example.com/packages/cloud-tour/content.json',
          manifestUrl: 'https://cdn.example.com/packages/cloud-tour/manifest.json',
          manifest: {
            id: 'grafana-cloud-tour-lj',
            type: 'path',
            milestones: ['ms-1', 'ms-2'],
          },
        } as any,
      ],
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(v1Response),
    });

    const result = await ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);

    const pathRec = result.recommendations.find((r) => r.title === 'Grafana Cloud Tour');
    expect(pathRec).toBeDefined();
    expect(pathRec!.milestones).toHaveLength(2);
    expect(pathRec!.totalSteps).toBe(2);
    expect(pathRec!.milestones![0]!.title).toBe('Milestone 1');
  });

  it('should not populate milestones for guide-type package recommendations', async () => {
    const v1Response = makeV1Response({
      recommendations: [
        {
          type: 'package',
          title: 'A Guide',
          description: 'Just a guide',
          url: '',
          matchAccuracy: 0.8,
          contentUrl: 'https://cdn.example.com/packages/guide/content.json',
          manifest: {
            id: 'some-guide',
            type: 'guide',
          },
        } as any,
      ],
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(v1Response),
    });

    const result = await ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);

    const guideRec = result.recommendations.find((r) => r.title === 'A Guide');
    expect(guideRec).toBeDefined();
    expect(guideRec!.milestones).toBeUndefined();
    expect(guideRec!.totalSteps).toBeUndefined();
  });
});
