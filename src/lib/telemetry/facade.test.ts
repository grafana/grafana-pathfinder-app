import {
  recordAssignmentTargetsUnresolved,
  recordGuideRequest,
  recordGuideRender,
  recordContentFetch,
  recordKioskCatalogLoaded,
  recordContentFetchFallback,
  recordCustomGuideCatalogueUnavailable,
  recordSettingsStoreResolved,
  recordStartupSettings,
  recordPanelReady,
  recordRecommendCompletions,
  recordRecommenderFallback,
  recordRecommenderRequest,
  recordRequirementsExhausted,
  recordSequenceActionError,
} from './facade';
import { pushFaroEvent, pushFaroMeasurement, pushFaroUserAction } from './faro-adapter';

jest.mock('./faro-adapter', () => ({
  pushFaroEvent: jest.fn(),
  pushFaroUserAction: jest.fn(),
  pushFaroMeasurement: jest.fn(),
}));

const mockPushFaroEvent = pushFaroEvent as jest.Mock;
const mockPushFaroMeasurement = pushFaroMeasurement as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('measurement and event domain operations', () => {
  it('recordRecommenderRequest / recordRecommenderFallback keep the wire shape', () => {
    recordRecommenderRequest(120, 'unavailable');
    recordRecommenderFallback('unavailable', 'bundled+static');

    expect(mockPushFaroMeasurement).toHaveBeenCalledWith(
      'pathfinder_recommender',
      { recommender_ms: 120 },
      { outcome: 'unavailable' }
    );
    expect(mockPushFaroEvent).toHaveBeenCalledWith('pathfinder_recommender_fallback', {
      fallback_tier: 'bundled+static',
      error_type: 'unavailable',
    });
  });

  it('recordRecommendCompletions buckets the item count and never carries guide data', () => {
    recordRecommendCompletions('ok', 0, false);
    recordRecommendCompletions('ok', 7, false);
    recordRecommendCompletions('ok', 50, false);
    recordRecommendCompletions('ok', 249, false);
    recordRecommendCompletions('ok', 250, true);
    recordRecommendCompletions('timeout');

    const calls = mockPushFaroEvent.mock.calls.filter(([name]) => name === 'pathfinder_recommend_completions');
    expect(calls.map(([, attrs]) => attrs)).toEqual([
      { outcome: 'ok', item_bucket: '0', truncated: 'false' },
      { outcome: 'ok', item_bucket: '1_10', truncated: 'false' },
      { outcome: 'ok', item_bucket: '11_50', truncated: 'false' },
      { outcome: 'ok', item_bucket: '51_249', truncated: 'false' },
      { outcome: 'ok', item_bucket: '250', truncated: 'true' },
      { outcome: 'timeout' },
    ]);
  });

  it('recordRecommendCompletions emits the wait as a namespaced measurement only when given', () => {
    recordRecommendCompletions('timeout', undefined, undefined, 500);
    recordRecommendCompletions('disabled');

    expect(mockPushFaroMeasurement).toHaveBeenCalledTimes(1);
    expect(mockPushFaroMeasurement).toHaveBeenCalledWith(
      'pathfinder_recommend_completions_wait',
      { recommend_completions_wait_ms: 500 },
      { outcome: 'timeout' }
    );
  });

  it('recordContentFetch and recordContentFetchFallback normalize the URL before it crosses the boundary', () => {
    recordContentFetch({
      url: 'https://user:pw@grafana.com/docs/x/?q=1#f',
      tier: 'content-json',
      durationMs: 42,
      outcome: 'ok',
    });
    recordContentFetchFallback({
      url: 'https://grafana.com/docs/x/?q=1',
      tierUsed: 'unstyled-html',
      errorType: 'content-json-null',
    });

    expect(mockPushFaroMeasurement).toHaveBeenCalledWith(
      'pathfinder_content_fetch',
      { content_fetch_ms: 42 },
      { tier: 'content_json', outcome: 'ok', content_url: 'grafana.com/docs/x/' }
    );
    expect(mockPushFaroEvent).toHaveBeenCalledWith('pathfinder_content_fetch_fallback', {
      content_url: 'grafana.com/docs/x/',
      tier_used: 'unstyled_html',
      error_type: 'content_json_null',
    });
  });

  it('recordRequirementsExhausted and recordSequenceActionError emit distinct event names', () => {
    recordRequirementsExhausted('has-role:admin', 3);
    recordSequenceActionError('has-role:admin', 3, { name: 'Error', category: 'timeout' });

    expect(mockPushFaroEvent).toHaveBeenCalledWith('pathfinder_requirements_exhausted', {
      requirement: 'has-role:admin',
      retry_count: 3,
    });
    expect(mockPushFaroEvent).toHaveBeenCalledWith('pathfinder_sequence_action_error', {
      requirement: 'has-role:admin',
      retry_count: 3,
      error_name: 'Error',
      error_category: 'timeout',
    });
  });

  it('recordSequenceActionError never ships a free-text error message attribute', () => {
    recordSequenceActionError('exists-reftarget', 3, { name: 'TypeError', category: 'dispatch_failed' });

    const [, attributes] = mockPushFaroEvent.mock.calls[0];
    expect(attributes).not.toHaveProperty('error_message');
    expect(Object.keys(attributes).sort()).toEqual(['error_category', 'error_name', 'requirement', 'retry_count']);
  });

  it('recordPanelReady emits the panel measurement with the surface context', () => {
    recordPanelReady(88, 'sidebar');
    expect(mockPushFaroMeasurement).toHaveBeenCalledWith(
      'pathfinder_panel',
      { panel_lcp_ms: 88 },
      { surface: 'sidebar' }
    );
  });

  it('recordCustomGuideCatalogueUnavailable emits the capability event with the reason', () => {
    recordCustomGuideCatalogueUnavailable('obo-unavailable');
    expect(mockPushFaroEvent).toHaveBeenCalledWith('pathfinder_custom_guide_catalogue_unavailable', {
      reason: 'obo_unavailable',
    });
  });

  it('recordSettingsStoreResolved emits the rung the settings read landed on', () => {
    recordSettingsStoreResolved('kind-not-served');
    expect(mockPushFaroEvent).toHaveBeenCalledWith('pathfinder_settings_store_resolved', {
      outcome: 'kind_not_served',
    });
  });

  it('recordAssignmentTargetsUnresolved emits the count of unresolvable targets', () => {
    recordAssignmentTargetsUnresolved(2);
    expect(mockPushFaroEvent).toHaveBeenCalledWith('pathfinder_assignment_target_unresolved', {
      reason: 'unresolvable_target',
      count: 2,
    });
  });
});

it('emits private guide diagnostics without private identifiers, bodies or messages', () => {
  recordGuideRequest({
    context: { loadId: 'load', source: 'app-platform', guideRef: 'opaque' },
    url: 'backend-guide:private-resource',
    role: 'content',
    durationMs: 10,
    diagnostic: { source: 'app-platform', stage: 'validate', reason: 'schema-invalid', validationCount: 2 },
  });
  const payload = mockPushFaroEvent.mock.calls[0]![1];
  expect(payload.content_url).toMatch(/^private-guide:/);
  expect(payload.validation_count).toBe('2');
  expect(JSON.stringify(payload)).not.toContain('private-resource');
  recordGuideRender({ loadId: 'load', source: 'app-platform', guideRef: 'opaque' }, 'error', 10, {
    source: 'app-platform',
    stage: 'fetch',
    reason: 'http-error',
    statusCode: 404,
  });
  expect(pushFaroUserAction).toHaveBeenLastCalledWith(
    'pathfinder_docs_panel_interaction',
    expect.objectContaining({ action: 'open_guide', phase: 'render', outcome: 'error', load_id: 'load' })
  );
  expect(mockPushFaroEvent).toHaveBeenLastCalledWith(
    'pathfinder_guide_render',
    expect.objectContaining({ http_status: '404', stage: 'fetch' })
  );
});

it('records the served kiosk tier and degradation without catalog content', () => {
  recordKioskCatalogLoaded('configured', false, 2);
  expect(mockPushFaroEvent).toHaveBeenCalledWith('pathfinder_kiosk_catalog_loaded', {
    tier: 'configured',
    degraded: false,
    rejected_rules: 2,
  });
});

it('records bounded startup settings latency and fail-open outcome without identities', () => {
  recordStartupSettings(3000, 'timeout');
  expect(pushFaroMeasurement).toHaveBeenCalledWith(
    'pathfinder_startup_settings',
    { startup_settings_ms: 3000 },
    { outcome: 'timeout' }
  );
});
