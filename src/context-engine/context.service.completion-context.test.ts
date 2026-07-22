/**
 * Verifies that ContextService.fetchRecommendations attaches the user's
 * completion context to the recommend request when the read proxy is healthy,
 * and leaves the request byte-for-byte unchanged when it is not — the graceful
 * degradation guarantee for the Completion Records epic (PR 7).
 */

import { ContextService } from './context.service';
import type { CompletionContext, ContextData } from '../types/context.types';

jest.mock('../bundled-interactives/index.json', () => ({ interactives: [] }));

jest.mock('../utils/dev-mode', () => ({
  isDevModeEnabled: jest.fn(() => false),
  isDevModeEnabledGlobal: jest.fn(() => false),
}));

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: jest.fn(() => ({ get: jest.fn(), post: jest.fn() })),
  config: {
    bootData: {
      settings: { buildInfo: { versionString: 'Grafana v10.0.0', version: '10.0.0' } },
      user: { analytics: { identifier: 'test-user' }, email: 'test@example.com', orgRole: 'Admin', language: 'en-US' },
    },
    theme2: { isDark: true },
  },
  locationService: {
    push: jest.fn(),
    getLocation: jest.fn(() => ({ pathname: '/alerting', search: '', hash: '' })),
    getSearchObject: jest.fn(() => ({})),
  },
  getEchoSrv: jest.fn(() => ({ addBackend: jest.fn(), addEvent: jest.fn() })),
  EchoEventType: { Interaction: 'interaction', Pageview: 'pageview', MetaAnalytics: 'meta-analytics' },
}));

jest.mock('../lib/hash.util', () => ({
  hashUserData: jest.fn().mockResolvedValue({ hashedUserId: 'hashed-user', hashedEmail: 'hashed-email' }),
}));

jest.mock('../docs-retrieval', () => ({
  fetchContent: jest.fn().mockResolvedValue({ content: {} }),
  getJourneyCompletionPercentageAsync: jest.fn().mockResolvedValue(0),
  resolvePackageMilestones: jest.fn().mockResolvedValue([]),
  resolvePackageNavLinks: jest.fn().mockResolvedValue([]),
  derivePathSlug: jest.fn().mockImplementation((id: string) => id),
}));

jest.mock('../lib/user-storage', () => ({
  interactiveCompletionStorage: { get: jest.fn().mockResolvedValue(0), set: jest.fn() },
}));

const mockFetchCompletionContext = jest.fn();
jest.mock('../lib/completion-records-client', () => ({
  fetchCompletionContextForRecommend: () => mockFetchCompletionContext(),
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
    timestamp: '2026-07-22T00:00:00Z',
    searchParams: {},
    platform: 'oss',
    ...overrides,
  };
}

function recommendRequestBody(): Record<string, unknown> {
  const call = mockFetch.mock.calls.find((c) => String(c[0]).endsWith('/api/v1/recommend'));
  expect(call).toBeDefined();
  return JSON.parse((call![1] as RequestInit).body as string);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ recommendations: [], featured: [] }) });
});

describe('recommend request completion context', () => {
  it('attaches completion context when the read proxy is healthy', async () => {
    const context: CompletionContext = {
      as_of: '2026-07-22T10:00:00Z',
      items: [
        {
          guide_source: 'grafana-cloud',
          guide_id: 'alerting-101',
          guide_category: 'alerting',
          count: 2,
          latest_completed_at: '2026-07-20T09:30:00Z',
          max_completion_percent: 100,
        },
      ],
    };
    mockFetchCompletionContext.mockResolvedValueOnce(context);

    await ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);

    expect(recommendRequestBody().completions).toEqual(context);
  });

  it('omits the completions field entirely when the proxy is unavailable', async () => {
    mockFetchCompletionContext.mockResolvedValueOnce(null);

    await ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);

    const body = recommendRequestBody();
    expect('completions' in body).toBe(false);
    // The rest of the payload is unchanged.
    expect(body.path).toBe('/alerting');
    expect(body.user_id).toBe('hashed-user');
  });

  it('still recommends when the completion fetch resolves null (no throw)', async () => {
    mockFetchCompletionContext.mockResolvedValueOnce(null);

    const result = await ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);

    expect(result.recommendations).toBeDefined();
    expect(result.error).toBeNull();
  });
});
