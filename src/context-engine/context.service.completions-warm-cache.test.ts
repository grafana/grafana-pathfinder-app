/**
 * Pins D7: the /my load is not aborted at the 500 ms budget, so a slow first load warms the
 * cache for the next recommend request. Uses the real read client; only the backend transport is mocked.
 */

import { Observable } from 'rxjs';

import { getBackendSrv } from '@grafana/runtime';

import { ContextService } from './context.service';
import type { ContextData } from '../types/context.types';
import { __resetMyCompletionsCacheForTests } from '../completion-records/completion-read-client';

jest.mock('../bundled-interactives/index.json', () => ({ interactives: [] }));

jest.mock('../utils/dev-mode', () => ({
  isDevModeEnabled: jest.fn(() => false),
  isDevModeEnabledGlobal: jest.fn(() => false),
}));

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: jest.fn(),
  config: {
    bootData: {
      settings: { buildInfo: { versionString: 'Grafana v10.0.0', version: '10.0.0' } },
      user: { analytics: { identifier: 'test-user' }, email: 'test@example.com', orgRole: 'Admin', language: 'en-US' },
    },
    theme2: { isDark: true },
  },
  locationService: {
    push: jest.fn(),
    getLocation: jest.fn(() => ({ pathname: '/dashboards', search: '', hash: '' })),
    getSearchObject: jest.fn(() => ({})),
  },
  getEchoSrv: jest.fn(() => ({ addBackend: jest.fn(), addEvent: jest.fn() })),
  EchoEventType: { Interaction: 'interaction', Pageview: 'pageview', MetaAnalytics: 'meta-analytics' },
}));

jest.mock('../lib/hash.util', () => ({
  hashUserData: jest.fn().mockResolvedValue({ hashedUserId: 'hashed-user', hashedEmail: 'hashed-email' }),
}));

jest.mock('../lib/user-storage', () => ({
  interactiveCompletionStorage: { get: jest.fn().mockResolvedValue(0), set: jest.fn() },
}));

jest.mock('../lib/learning-journey-content-bridge', () => ({
  fetchContent: jest.fn().mockResolvedValue({ content: { metadata: {} } }),
  getJourneyCompletionPercentageAsync: jest.fn().mockResolvedValue(0),
  resolvePackageMilestones: jest.fn().mockResolvedValue([]),
  resolvePackageNavLinks: jest.fn().mockResolvedValue([]),
  derivePathSlug: jest.fn((id: string) => id),
}));

jest.mock('../lib/telemetry', () => ({
  ...jest.requireActual('../lib/telemetry'),
  recordRecommenderRequest: jest.fn(),
  recordRecommenderFallback: jest.fn(),
  recordRecommendCompletions: jest.fn(),
}));

jest.mock('../utils/openfeature', () => ({
  getFeatureFlagValue: jest.fn(() => true),
  getHighlightedGuideConfig: jest.fn(() => ({ enabled: false })),
}));

const mockRecommenderFetch = jest.fn();
global.fetch = mockRecommenderFetch;

const PLUGIN_CONFIG = {
  recommenderServiceUrl: 'https://recommender.grafana.com',
  acceptedTermsAndConditions: true,
};

function makeContextData(): ContextData {
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
  };
}

function sentBody(callIndex: number): Record<string, unknown> {
  const init = mockRecommenderFetch.mock.calls[callIndex]?.[1] as { body: string };
  return JSON.parse(init.body);
}

describe('completions warm the cache after the budget expires', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockRecommenderFetch.mockReset();
    mockRecommenderFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ recommendations: [] }) });
    __resetMyCompletionsCacheForTests();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('serves the late /my result to the next request without a second fetch', async () => {
    let deliver: (value: unknown) => void = () => {};
    const backendFetch = jest.fn(
      () =>
        new Observable((subscriber) => {
          deliver = (value) => {
            subscriber.next({ data: value });
            subscriber.complete();
          };
        })
    );
    (getBackendSrv as jest.Mock).mockReturnValue({ fetch: backendFetch, get: jest.fn(), post: jest.fn() });

    const first = ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);
    await jest.advanceTimersByTimeAsync(600);
    await first;
    expect(sentBody(0)).not.toHaveProperty('completions');

    deliver({ capability: { available: true }, completions: [], inProgress: [], asOf: '2026-10-13T12:00:00Z' });
    await jest.advanceTimersByTimeAsync(0);

    await ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);

    expect(sentBody(1).completions).toEqual({ v: 1, as_of: '2026-10-13T12:00:00Z', truncated: false, items: [] });
    expect(backendFetch).toHaveBeenCalledTimes(1);
  });
});
