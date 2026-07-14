import {
  recordContentFetch,
  recordContentFetchFallback,
  recordPanelReady,
  recordRecommenderFallback,
  recordRecommenderRequest,
  recordRequirementsExhausted,
  recordSequenceActionError,
  withGuideOpenAction,
} from './facade';
import { pushFaroEvent, pushFaroMeasurement, withFaroUserAction } from './faro-adapter';

jest.mock('./faro-adapter', () => ({
  pushFaroEvent: jest.fn(),
  pushFaroMeasurement: jest.fn(),
  withFaroUserAction: jest.fn((_name: string, _attrs: unknown, work: () => unknown) => work()),
}));

const mockPushFaroEvent = pushFaroEvent as jest.Mock;
const mockPushFaroMeasurement = pushFaroMeasurement as jest.Mock;
const mockWithFaroUserAction = withFaroUserAction as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('withGuideOpenAction', () => {
  it('wraps the load in a critical pathfinder_guide_open action with a normalized URL', async () => {
    await withGuideOpenAction('https://grafana.com/docs/page/?token=secret#frag', async () => 'completed');

    expect(mockWithFaroUserAction).toHaveBeenCalledWith(
      'pathfinder_guide_open',
      { content_url: 'grafana.com/docs/page/' },
      expect.any(Function),
      undefined,
      expect.objectContaining({ critical: true })
    );
  });

  it('maps resolved loader outcomes so failed opens are never stamped ok', async () => {
    await withGuideOpenAction('bundled:welcome', async () => 'error');

    const options = mockWithFaroUserAction.mock.calls[0][4];
    expect(options.outcomeFrom('completed')).toBe('ok');
    expect(options.outcomeFrom('error')).toBe('error');
  });
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
    expect(mockPushFaroEvent).toHaveBeenCalledWith('recommender_fallback', {
      fallback_tier: 'bundled+static',
      error_type: 'unavailable',
    });
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
      { tier: 'content-json', outcome: 'ok', content_url: 'grafana.com/docs/x/' }
    );
    expect(mockPushFaroEvent).toHaveBeenCalledWith('content_fetch_fallback', {
      content_url: 'grafana.com/docs/x/',
      tier_used: 'unstyled-html',
      error_type: 'content-json-null',
    });
  });

  it('recordRequirementsExhausted and recordSequenceActionError emit distinct event names', () => {
    recordRequirementsExhausted('has-role:admin', 3);
    recordSequenceActionError('has-role:admin', 3, 'click failed');

    expect(mockPushFaroEvent).toHaveBeenCalledWith('requirements_exhausted', {
      requirement: 'has-role:admin',
      retry_count: 3,
    });
    expect(mockPushFaroEvent).toHaveBeenCalledWith('sequence_action_error', {
      requirement: 'has-role:admin',
      retry_count: 3,
      error_message: 'click failed',
    });
  });

  it('recordPanelReady emits the panel measurement with the surface context', () => {
    recordPanelReady(88, 'sidebar');
    expect(mockPushFaroMeasurement).toHaveBeenCalledWith(
      'pathfinder_panel',
      { panel_lcp_ms: 88 },
      { surface: 'sidebar' }
    );
  });
});
