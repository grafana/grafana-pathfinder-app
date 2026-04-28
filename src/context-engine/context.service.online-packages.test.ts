/**
 * Integration test for the recommender-disabled branch of ContextService:
 * online package recommendations are merged in alongside bundled interactives.
 */

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: jest.fn(() => ({
    get: jest.fn(),
    post: jest.fn(),
  })),
  config: {
    bootData: {
      settings: { buildInfo: { versionString: 'Grafana v10.0.0' } },
      user: { analytics: { identifier: 'u' }, email: 'e@x', orgRole: 'Admin' },
    },
  },
  locationService: { push: jest.fn() },
  getEchoSrv: jest.fn(() => ({ addEvent: jest.fn() })),
  EchoEventType: { Interaction: 'interaction' },
}));

jest.mock('../utils/dev-mode', () => ({
  isDevModeEnabled: jest.fn(() => false),
  isDevModeEnabledGlobal: jest.fn(() => false),
}));

jest.mock('../lib/hash.util', () => ({
  hashUserData: jest.fn().mockResolvedValue({
    hashedUserId: 'hashed-user',
    hashedEmail: 'hashed-email',
  }),
  hashString: jest.fn(() => Promise.resolve('a'.repeat(64))),
}));

jest.mock('../lib/user-storage', () => ({
  interactiveCompletionStorage: { get: jest.fn().mockResolvedValue(0), set: jest.fn() },
  journeyCompletionStorage: { get: jest.fn().mockResolvedValue(0), set: jest.fn() },
  tabStorage: { get: jest.fn(), set: jest.fn() },
  useUserStorage: jest.fn(),
}));

jest.mock('../docs-retrieval', () => ({
  fetchContent: jest.fn(),
  getJourneyCompletionPercentageAsync: jest.fn().mockResolvedValue(0),
  resolvePackageMilestones: jest.fn(),
  resolvePackageNavLinks: jest.fn(),
  derivePathSlug: jest.fn(),
}));

jest.mock('../lib/package-recommendations-client', () => ({
  fetchOnlinePackageRecommendations: jest.fn(),
}));

import { ContextService } from './context.service';
import { fetchOnlinePackageRecommendations } from '../lib/package-recommendations-client';

const baseContext = {
  currentPath: '/connections',
  currentUrl: 'http://localhost:3000/connections',
  pathSegments: ['connections'],
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

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ContextService: online package recommendations (recommender-disabled branch)', () => {
  it('merges online package matches into the recommendations list when T&C unaccepted', async () => {
    (fetchOnlinePackageRecommendations as jest.Mock).mockResolvedValue({
      baseUrl: 'https://interactive-learning.grafana.net/packages/',
      packages: [
        {
          id: 'prom-101',
          path: 'prom-101/v1.0.0',
          title: 'Prometheus 101',
          description: 'Intro to Prometheus',
          targeting: { match: { urlPrefix: '/connections' } },
        },
      ],
    });

    const result = await ContextService.fetchRecommendations(baseContext, {
      acceptedTermsAndConditions: false,
    });

    expect(fetchOnlinePackageRecommendations).toHaveBeenCalledTimes(1);
    const titles = result.recommendations.map((r) => r.title);
    expect(titles).toContain('Prometheus 101');

    const promPackage = result.recommendations.find((r) => r.title === 'Prometheus 101');
    expect(promPackage).toBeDefined();
    expect(promPackage!.url).toBe('package:prom-101');
    expect(promPackage!.type).toBe('package');
    expect(promPackage!.contentUrl).toBe(
      'https://interactive-learning.grafana.net/packages/prom-101/v1.0.0/content.json'
    );
    expect(promPackage!.manifestUrl).toBe(
      'https://interactive-learning.grafana.net/packages/prom-101/v1.0.0/manifest.json'
    );
    // Manifest is the routing hint for processLearningJourneys to render this
    // as guide-style (interactive) rather than learning-journey style.
    expect(promPackage!.manifest).toMatchObject({ id: 'prom-101', type: 'guide' });
  });

  it('normalizes the inlined manifest from the backend into the recommendation', async () => {
    (fetchOnlinePackageRecommendations as jest.Mock).mockResolvedValue({
      baseUrl: 'https://interactive-learning.grafana.net/packages/',
      packages: [
        {
          id: 'prom-lj',
          path: 'prom-lj/v1',
          title: 'Prometheus learning path',
          type: 'path',
          targeting: { match: { urlPrefix: '/connections' } },
          manifest: {
            id: 'prom-lj',
            type: 'path',
            description: 'Connect Prometheus end-to-end.',
            startingLocation: '/connections/datasources',
            milestones: ['intro', 'install', 'verify'],
            recommends: ['related-1'],
            suggests: ['related-2'],
            // Untrusted field that should be stripped by the allowlist.
            __proto__: { polluted: true },
          },
        },
      ],
    });

    const result = await ContextService.fetchRecommendations(baseContext, {
      acceptedTermsAndConditions: false,
    });

    const rec = result.recommendations.find((r) => r.title === 'Prometheus learning path');
    expect(rec).toBeDefined();
    expect(rec!.manifest).toEqual({
      id: 'prom-lj',
      type: 'path',
      description: 'Connect Prometheus end-to-end.',
      startingLocation: '/connections/datasources',
      milestones: ['intro', 'install', 'verify'],
      recommends: ['related-1'],
      suggests: ['related-2'],
    });
    // processLearningJourneys uses manifest.milestones to populate totalSteps
    // and pendingMilestoneIds, which gates the rich learning-journey rendering.
    expect(rec!.totalSteps).toBe(3);
    expect(rec!.pendingMilestoneIds).toEqual(['intro', 'install', 'verify']);
    expect(rec!.pendingRecommendIds).toEqual(['related-1']);
    expect(rec!.pendingSuggestIds).toEqual(['related-2']);
  });

  it('builds clean content/manifest URLs even when entry.path already has a trailing slash', async () => {
    (fetchOnlinePackageRecommendations as jest.Mock).mockResolvedValue({
      baseUrl: 'https://interactive-learning.grafana.net/packages/',
      packages: [
        {
          id: 'assistant-self-hosted',
          path: 'assistant-self-hosted/',
          title: 'Assistant self-hosted',
          targeting: { match: { urlPrefix: '/connections' } },
        },
      ],
    });

    const result = await ContextService.fetchRecommendations(baseContext, {
      acceptedTermsAndConditions: false,
    });

    const rec = result.recommendations.find((r) => r.title === 'Assistant self-hosted');
    expect(rec).toBeDefined();
    expect(rec!.contentUrl).toBe(
      'https://interactive-learning.grafana.net/packages/assistant-self-hosted/content.json'
    );
    expect(rec!.manifestUrl).toBe(
      'https://interactive-learning.grafana.net/packages/assistant-self-hosted/manifest.json'
    );
    expect(rec!.contentUrl).not.toContain('//content.json');
  });

  it('preserves entry.type=path so the recommendation routes through learning-journey rendering', async () => {
    (fetchOnlinePackageRecommendations as jest.Mock).mockResolvedValue({
      baseUrl: 'https://interactive-learning.grafana.net/packages/',
      packages: [
        {
          id: 'prom-lj',
          path: 'prom-lj/v1',
          title: 'Connect Prometheus (journey)',
          type: 'path',
          targeting: { match: { urlPrefix: '/connections' } },
        },
      ],
    });

    const result = await ContextService.fetchRecommendations(baseContext, {
      acceptedTermsAndConditions: false,
    });

    const journeyPackage = result.recommendations.find((r) => r.title === 'Connect Prometheus (journey)');
    expect(journeyPackage).toBeDefined();
    expect(journeyPackage!.type).toBe('package');
    expect(journeyPackage!.manifest).toMatchObject({ id: 'prom-lj', type: 'path' });
  });

  it('drops online entries whose targeting does not match the current path', async () => {
    (fetchOnlinePackageRecommendations as jest.Mock).mockResolvedValue({
      baseUrl: 'https://interactive-learning.grafana.net/packages/',
      packages: [
        {
          id: 'explore-only',
          path: 'explore/v1',
          title: 'Explore guide',
          targeting: { match: { urlPrefix: '/explore' } },
        },
      ],
    });

    const result = await ContextService.fetchRecommendations(baseContext, {
      acceptedTermsAndConditions: false,
    });

    const titles = result.recommendations.map((r) => r.title);
    expect(titles).not.toContain('Explore guide');
  });

  it('drops online entries whose targetPlatform does not match', async () => {
    (fetchOnlinePackageRecommendations as jest.Mock).mockResolvedValue({
      baseUrl: 'https://interactive-learning.grafana.net/packages/',
      packages: [
        {
          id: 'cloud-only',
          path: 'cloud-only/v1',
          title: 'Cloud-only guide',
          targeting: {
            match: { and: [{ urlPrefix: '/connections' }, { targetPlatform: 'cloud' }] },
          },
        },
      ],
    });

    const result = await ContextService.fetchRecommendations(baseContext, {
      acceptedTermsAndConditions: false,
    });

    const titles = result.recommendations.map((r) => r.title);
    expect(titles).not.toContain('Cloud-only guide');
  });

  it('does not call the online package client when the recommender is enabled', async () => {
    (fetchOnlinePackageRecommendations as jest.Mock).mockResolvedValue({
      baseUrl: '',
      packages: [],
    });

    // Shape the V1 response so getExternalRecommendations resolves cleanly.
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ recommendations: [] }),
    }) as any;

    await ContextService.fetchRecommendations(baseContext, {
      acceptedTermsAndConditions: true,
      recommenderServiceUrl: 'https://recommender.grafana.com',
    });

    expect(fetchOnlinePackageRecommendations).not.toHaveBeenCalled();
  });

  it('returns bundled recommendations only when the online client returns none', async () => {
    (fetchOnlinePackageRecommendations as jest.Mock).mockResolvedValue({
      baseUrl: '',
      packages: [],
    });

    const result = await ContextService.fetchRecommendations(baseContext, {
      acceptedTermsAndConditions: false,
    });

    expect(fetchOnlinePackageRecommendations).toHaveBeenCalledTimes(1);
    expect(Array.isArray(result.recommendations)).toBe(true);
  });
});
