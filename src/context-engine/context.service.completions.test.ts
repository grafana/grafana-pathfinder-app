/**
 * Completion history attached to POST /api/v1/recommend.
 */

import { ContextService } from './context.service';
import type { ContextData } from '../types/context.types';
import type { MyCompletionsResponseWire } from '../types/backend-api.schema';
import { logger } from '../lib/logging';
import { projectRecommendCompletions } from '../completion-records/recommend-completions';

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

const mockRecordRecommendCompletions = jest.fn();
const mockRecordRecommenderRequest = jest.fn();
jest.mock('../lib/telemetry', () => ({
  ...jest.requireActual('../lib/telemetry'),
  recordRecommenderRequest: (...args: unknown[]) => mockRecordRecommenderRequest(...args),
  recordRecommenderFallback: jest.fn(),
  recordRecommendCompletions: (...args: unknown[]) => mockRecordRecommendCompletions(...args),
}));

const mockLoadMyCompletions = jest.fn();
jest.mock('../completion-records/completion-read-client', () => ({
  loadMyCompletions: () => mockLoadMyCompletions(),
}));

const mockProject = jest.fn();
jest.mock('../completion-records/recommend-completions', () => {
  const actual = jest.requireActual('../completion-records/recommend-completions');
  return { ...actual, projectRecommendCompletions: (...args: unknown[]) => mockProject(...args) };
});

const mockFlag = jest.fn();
jest.mock('../utils/openfeature', () => ({
  getFeatureFlagValue: (...args: unknown[]) => mockFlag(...args),
  getHighlightedGuideConfig: jest.fn(() => ({ enabled: false })),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

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

function myResponse(overrides: Partial<MyCompletionsResponseWire> = {}): MyCompletionsResponseWire {
  return {
    capability: { available: true },
    userId: 'user:secret',
    completions: [],
    inProgress: [],
    asOf: '2026-10-13T12:00:00Z',
    ...overrides,
  };
}

const COMPLETED_ROW = {
  guideSource: 'interactive-tutorials',
  guideId: 'alerting-101',
  guideTitle: 'Alerting 101',
  guideCategory: 'interactive',
  pathId: '',
  count: 1,
  latestCompletedAt: '2026-09-01T00:00:00Z',
  latestSource: 'objectives',
  maxCompletionPercent: 100,
};

async function sentBody(): Promise<Record<string, unknown>> {
  const init = mockFetch.mock.calls[0]?.[1] as { body: string };
  return JSON.parse(init.body);
}

describe('recommend request completions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFlag.mockReturnValue(true);
    mockProject.mockImplementation(
      jest.requireActual('../completion-records/recommend-completions').projectRecommendCompletions
    );
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ recommendations: [] }) });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('makes no /my request and sends no key when the flag is off', async () => {
    mockFlag.mockReturnValue(false);

    await ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);

    expect(mockFlag).toHaveBeenCalledWith('pathfinder.recommend-completions', false);
    expect(mockLoadMyCompletions).not.toHaveBeenCalled();
    expect(await sentBody()).not.toHaveProperty('completions');
    expect(mockRecordRecommendCompletions).toHaveBeenCalledWith('disabled', undefined, undefined, undefined);
  });

  it('omits the key when the capability is unavailable', async () => {
    mockLoadMyCompletions.mockResolvedValue({ kind: 'unavailable' });

    await ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);

    expect(await sentBody()).not.toHaveProperty('completions');
    expect(mockRecordRecommendCompletions).toHaveBeenCalledWith(
      'unavailable',
      undefined,
      undefined,
      expect.any(Number)
    );
  });

  it('omits the key and still returns recommendations when /my rejects', async () => {
    mockLoadMyCompletions.mockRejectedValue(new Error('boom'));

    const result = await ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);

    expect(await sentBody()).not.toHaveProperty('completions');
    expect(result.error).toBeNull();
    expect(result.usingFallbackRecommendations).toBe(false);
  });

  it('sends without the key once the 500 ms budget expires on a never-resolving /my', async () => {
    jest.useFakeTimers();
    mockLoadMyCompletions.mockReturnValue(new Promise(() => {}));

    const pending = ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);
    await jest.advanceTimersByTimeAsync(499);
    expect(mockFetch).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(2);
    await pending;

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(await sentBody()).not.toHaveProperty('completions');
    expect(mockRecordRecommendCompletions).toHaveBeenCalledWith('timeout', undefined, undefined, expect.any(Number));
  });

  it('keeps the completions wait out of recommender_ms and measures it separately', async () => {
    jest.useFakeTimers();
    mockLoadMyCompletions.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ kind: 'ok', data: myResponse() }), 300))
    );
    mockFetch.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ ok: true, json: () => Promise.resolve({ recommendations: [] }) }), 40)
        )
    );

    const pending = ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);
    await jest.advanceTimersByTimeAsync(1000);
    await pending;

    const [recommenderMs, outcome] = mockRecordRecommenderRequest.mock.calls[0] as [number, string];
    expect(outcome).toBe('ok');
    expect(recommenderMs).toBeLessThan(150);
    const [, , , waitMs] = mockRecordRecommendCompletions.mock.calls[0] as unknown[];
    expect(waitMs).toBeGreaterThanOrEqual(290);
  });

  it('keeps the wait out of the recommender duration on the fail path too', async () => {
    jest.useFakeTimers();
    mockLoadMyCompletions.mockReturnValue(new Promise(() => {}));
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    const pending = ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);
    await jest.advanceTimersByTimeAsync(1000);
    await pending;

    const [recommenderMs, outcome] = mockRecordRecommenderRequest.mock.calls[0] as [number, string];
    expect(outcome).toBe('other');
    expect(recommenderMs).toBeLessThan(150);
  });

  it('sends an empty items list for a known user with no history', async () => {
    mockLoadMyCompletions.mockResolvedValue({ kind: 'ok', data: myResponse() });

    await ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);

    expect((await sentBody()).completions).toEqual({
      v: 1,
      as_of: '2026-10-13T12:00:00Z',
      truncated: false,
      items: [],
    });
  });

  it('sends the projection and never the backend userId', async () => {
    const data = myResponse({ completions: [COMPLETED_ROW] });
    mockLoadMyCompletions.mockResolvedValue({ kind: 'ok', data });

    await ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);

    const body = await sentBody();
    expect(body.completions).toEqual(projectRecommendCompletions(data));
    expect(JSON.stringify(body)).not.toContain('user:secret');
    expect(mockRecordRecommendCompletions).toHaveBeenCalledWith('ok', 1, false, expect.any(Number));
  });

  it('drops the key and warns with paths only when the projection is invalid', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    mockProject.mockReturnValue({
      v: 1,
      truncated: false,
      items: [{ guide_source: 'bundled', guide_id: 'SECRET-GUIDE', percent: 500, count: 1 }],
    });
    mockLoadMyCompletions.mockResolvedValue({ kind: 'ok', data: myResponse() });

    await ContextService.fetchRecommendations(makeContextData(), PLUGIN_CONFIG);

    expect(await sentBody()).not.toHaveProperty('completions');
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET-GUIDE');
    expect(mockRecordRecommendCompletions).toHaveBeenCalledWith('invalid', undefined, undefined, expect.any(Number));
    warn.mockRestore();
  });
});
