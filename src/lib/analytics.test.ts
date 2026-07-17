import {
  reportAppInteraction,
  UserInteraction,
  bindExperimentsProvider,
  setupScrollTracking,
  clearScrollTrackingCache,
  buildProgressProperties,
  getContentTypeForAnalytics,
  getJourneyNavigationProperties,
  journeyProgressProperties,
  AnalyticsContentType,
} from './analytics';
import { reportInteraction } from '@grafana/runtime';
import { isInteractiveLearningUrl } from '../security/url-validator';
import { pushFaroUserAction } from './telemetry/bridge';

jest.mock('@grafana/runtime', () => ({
  reportInteraction: jest.fn(),
}));

jest.mock('../../package.json', () => ({
  version: '1.0.0-test',
}));

jest.mock('../security/url-validator', () => ({
  isInteractiveLearningUrl: jest.fn(() => false),
}));

jest.mock('./telemetry/bridge', () => ({
  pushFaroUserAction: jest.fn(),
  pushFaroLog: jest.fn(),
  pushFaroError: jest.fn(),
}));

const mockReportInteraction = reportInteraction as jest.Mock;
const mockPushFaroUserAction = pushFaroUserAction as jest.Mock;

describe('reportAppInteraction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete (window as any).__pathfinderKioskSessionId;
  });

  it('includes kiosk_session_id when window global is set', () => {
    (window as any).__pathfinderKioskSessionId = 'test-session-abc';

    reportAppInteraction(UserInteraction.DocsPanelInteraction, { action: 'open' });

    expect(mockReportInteraction).toHaveBeenCalledWith(
      'pathfinder_docs_panel_interaction',
      expect.objectContaining({
        kiosk_session_id: 'test-session-abc',
        action: 'open',
        plugin_version: '1.0.0-test',
      })
    );
  });

  it('omits kiosk_session_id when window global is not set', () => {
    reportAppInteraction(UserInteraction.DocsPanelInteraction, { action: 'open' });

    expect(mockReportInteraction).toHaveBeenCalledTimes(1);
    const properties = mockReportInteraction.mock.calls[0][1];
    expect(properties).not.toHaveProperty('kiosk_session_id');
  });

  it('omits kiosk_session_id when window global is empty string', () => {
    (window as any).__pathfinderKioskSessionId = '';

    reportAppInteraction(UserInteraction.DocsPanelInteraction, {});

    const properties = mockReportInteraction.mock.calls[0][1];
    expect(properties).not.toHaveProperty('kiosk_session_id');
  });

  it('includes kiosk_session_id alongside other enriched properties', () => {
    (window as any).__pathfinderKioskSessionId = 'kiosk-123';

    reportAppInteraction(UserInteraction.ShowMeButtonClick, {
      step_id: 'step-1',
      content_type: 'interactive-guide',
    });

    const properties = mockReportInteraction.mock.calls[0][1];
    expect(properties.kiosk_session_id).toBe('kiosk-123');
    expect(properties.step_id).toBe('step-1');
    expect(properties.content_type).toBe('interactive-guide');
    expect(properties.plugin_version).toBe('1.0.0-test');
  });
});

describe('reportAppInteraction Faro mirroring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('mirrors the same interaction name and enriched properties to Faro', () => {
    reportAppInteraction(UserInteraction.ShowMeButtonClick, { step_id: 'step-1' });

    expect(mockReportInteraction).toHaveBeenCalledTimes(1);
    expect(mockPushFaroUserAction).toHaveBeenCalledTimes(1);

    const [reportedName, reportedProperties] = mockReportInteraction.mock.calls[0];
    const [mirroredName, mirroredProperties] = mockPushFaroUserAction.mock.calls[0];
    expect(mirroredName).toBe(reportedName);
    expect(mirroredProperties).toEqual(reportedProperties);
    // A defensive copy, not the shared reference — neither pipeline can
    // mutate the other's payload.
    expect(mirroredProperties).not.toBe(reportedProperties);
  });

  it('still reports to Rudderstack even if the Faro mirror throws', () => {
    mockPushFaroUserAction.mockImplementationOnce(() => {
      throw new Error('faro is down');
    });

    // reportInteraction is called before the mirror, and the outer try/catch
    // means a later mirror failure can't unwind or suppress that earlier call.
    expect(() => reportAppInteraction(UserInteraction.ShowMeButtonClick, {})).not.toThrow();
    expect(mockReportInteraction).toHaveBeenCalledTimes(1);
  });

  it('still mirrors to Faro when reportInteraction itself throws', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    mockReportInteraction.mockImplementationOnce(() => {
      throw new Error('rudderstack down');
    });

    expect(() => reportAppInteraction(UserInteraction.ShowMeButtonClick, { step_id: 'step-1' })).not.toThrow();
    expect(mockPushFaroUserAction).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('normalizes *_url properties in the Faro mirror but leaves the RudderStack payload raw', () => {
    const rawUrl = 'https://grafana.com/docs/foo/?token=secret#frag';
    reportAppInteraction(UserInteraction.OpenResourceClick, { content_url: rawUrl });

    const reportedProps = mockReportInteraction.mock.calls[0][1];
    const mirroredProps = mockPushFaroUserAction.mock.calls[0][1];

    expect(reportedProps.content_url).toBe(rawUrl);
    expect(mirroredProps.content_url).toBe('grafana.com/docs/foo/');
  });

  it('does not touch string properties whose key does not end in url', () => {
    reportAppInteraction(UserInteraction.OpenResourceClick, { content_title: 'https://grafana.com/looks-like-a-url' });

    const mirroredProps = mockPushFaroUserAction.mock.calls[0][1];
    expect(mirroredProps.content_title).toBe('https://grafana.com/looks-like-a-url');
  });
});

describe('reportAppInteraction experiment enrichment', () => {
  const HIGHLIGHTED = 'pathfinder.highlighted-guide-experiment';

  beforeEach(() => {
    jest.clearAllMocks();
    delete (window as any).__pathfinderKioskSessionId;
  });

  // Runs first, while the module-level provider is still unbound (nothing has
  // called bindExperimentsProvider yet), so it exercises the graceful no-op path.
  it('reports without variant/experiments when no provider is bound', () => {
    reportAppInteraction(UserInteraction.SummaryClick, { content_url: 'u' });

    const props = mockReportInteraction.mock.calls[0][1];
    expect(props).not.toHaveProperty('experiments');
    expect(props).not.toHaveProperty('variant');
    expect(props.plugin_version).toBe('1.0.0-test');
  });

  it('passes the enrolled experiment through and rolls variant up to treatment', () => {
    bindExperimentsProvider(() => [
      { flag: HIGHLIGHTED, variant: 'treatment', pages: [], guideId: 'g', docType: 'learning-journey' },
    ]);

    reportAppInteraction(UserInteraction.SummaryClick, {});

    const props = mockReportInteraction.mock.calls[0][1];
    expect(props.variant).toBe('treatment');
    expect(props.experiments).toEqual([
      expect.objectContaining({ flag: HIGHLIGHTED, variant: 'treatment', guideId: 'g', docType: 'learning-journey' }),
    ]);
  });

  it('rolls variant up to control when no enrolled experiment is treatment', () => {
    bindExperimentsProvider(() => [{ flag: HIGHLIGHTED, variant: 'control', pages: [], guideId: 'g' }]);

    reportAppInteraction(UserInteraction.SummaryClick, {});

    expect(mockReportInteraction.mock.calls[0][1].variant).toBe('control');
  });

  it('omits variant/experiments when the user is enrolled in nothing', () => {
    bindExperimentsProvider(() => []);

    reportAppInteraction(UserInteraction.SummaryClick, {});

    const props = mockReportInteraction.mock.calls[0][1];
    expect(props).not.toHaveProperty('experiments');
    expect(props).not.toHaveProperty('variant');
  });

  it('strips experiments from the Faro mirror but keeps it in the RudderStack payload', () => {
    bindExperimentsProvider(() => [
      { flag: HIGHLIGHTED, variant: 'treatment', pages: [], guideId: 'g', docType: 'learning-journey' },
    ]);

    reportAppInteraction(UserInteraction.SummaryClick, {});

    const reportedProps = mockReportInteraction.mock.calls[0][1];
    const mirroredProps = mockPushFaroUserAction.mock.calls[0][1];
    expect(reportedProps).toHaveProperty('experiments');
    expect(mirroredProps).not.toHaveProperty('experiments');
    // Everything else still mirrors, including the small `variant` rollup.
    expect(mirroredProps.variant).toBe(reportedProps.variant);
  });

  it('does not enrich FeatureFlagEvaluated events (recursion guard)', () => {
    bindExperimentsProvider(() => [{ flag: HIGHLIGHTED, variant: 'treatment', pages: [], guideId: 'g' }]);

    reportAppInteraction(UserInteraction.FeatureFlagEvaluated, { flag_key: HIGHLIGHTED });

    const props = mockReportInteraction.mock.calls[0][1];
    expect(props).not.toHaveProperty('experiments');
    expect(props).not.toHaveProperty('variant');
    expect(props.flag_key).toBe(HIGHLIGHTED);
  });

  it('still mirrors flag exposures to Faro (beforeSend gates delivery, not the mirror)', () => {
    reportAppInteraction(UserInteraction.FeatureFlagEvaluated, { flag_key: HIGHLIGHTED });
    expect(mockPushFaroUserAction).toHaveBeenCalledTimes(1);
  });
});

describe('setupScrollTracking PanelScroll content_type', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    clearScrollTrackingCache();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function fireScroll(el: HTMLElement): void {
    el.dispatchEvent(new Event('scroll'));
    jest.advanceTimersByTime(150);
  }

  it('keeps content_type in sync with page_type when the tab has no type (both fall back to learning-journey)', () => {
    const el = document.createElement('div');
    const activeTab = { content: { url: 'https://example.com/journey' } };

    const cleanup = setupScrollTracking(el, activeTab, false);
    fireScroll(el);

    const props = mockReportInteraction.mock.calls[0][1];
    expect(props.page_type).toBe('learning-journey');
    expect(props.content_type).toBe('learning-journey');
    cleanup();
  });

  it('maps an interactive tab to the canonical interactive-guide content_type', () => {
    const el = document.createElement('div');
    const activeTab = { type: 'interactive' as const, content: { url: 'https://example.com/guide' } };

    const cleanup = setupScrollTracking(el, activeTab, false);
    fireScroll(el);

    const props = mockReportInteraction.mock.calls[0][1];
    expect(props.page_type).toBe('interactive');
    expect(props.content_type).toBe('interactive-guide');
    cleanup();
  });

  it('reports an empty content_type for the recommendations tab', () => {
    const el = document.createElement('div');

    const cleanup = setupScrollTracking(el, null, true);
    fireScroll(el);

    const props = mockReportInteraction.mock.calls[0][1];
    expect(props.page_type).toBe('recommendations');
    expect(props.content_type).toBe('');
    cleanup();
  });

  it('adds journey position and the supplier-provided step-driven completion for learning-journey tabs', () => {
    const el = document.createElement('div');
    const activeTab = {
      type: 'learning-journey' as const,
      content: {
        url: 'https://example.com/journey/m2',
        metadata: { learningJourney: { currentMilestone: 2, totalMilestones: 4 } },
      },
    };

    const cleanup = setupScrollTracking(el, activeTab, false, () => 40);
    fireScroll(el);

    const props = mockReportInteraction.mock.calls[0][1];
    expect(props.progress_step).toBe(2);
    expect(props.progress_total).toBe(4);
    expect(props.completion_percentage).toBe(40);
    cleanup();
  });

  it('omits completion_percentage when no journey completion supplier is provided', () => {
    const el = document.createElement('div');
    const activeTab = {
      type: 'learning-journey' as const,
      content: {
        url: 'https://example.com/journey/m3',
        metadata: { learningJourney: { currentMilestone: 3, totalMilestones: 4 } },
      },
    };

    const cleanup = setupScrollTracking(el, activeTab, false);
    fireScroll(el);

    const props = mockReportInteraction.mock.calls[0][1];
    expect(props.progress_step).toBe(3);
    expect(props).not.toHaveProperty('completion_percentage');
    cleanup();
  });
});

describe('getContentTypeForAnalytics', () => {
  const mockIsInteractiveLearningUrl = isInteractiveLearningUrl as jest.Mock;

  afterEach(() => {
    mockIsInteractiveLearningUrl.mockReturnValue(false);
  });

  it('upgrades the default Docs fallback to interactive-guide for CDN URLs', () => {
    mockIsInteractiveLearningUrl.mockReturnValue(true);
    expect(getContentTypeForAnalytics('https://interactive-learning.grafana.net/packages/x/content.json')).toBe(
      AnalyticsContentType.InteractiveGuide
    );
  });

  it('never overrides an explicit learning-journey fallback, even for CDN URLs', () => {
    mockIsInteractiveLearningUrl.mockReturnValue(true);
    expect(
      getContentTypeForAnalytics(
        'https://interactive-learning.grafana.net/packages/x-lj/content.json',
        AnalyticsContentType.LearningJourney
      )
    ).toBe(AnalyticsContentType.LearningJourney);
  });

  it('returns the fallback for non-CDN URLs', () => {
    expect(getContentTypeForAnalytics('https://grafana.com/docs/x', AnalyticsContentType.LearningJourney)).toBe(
      AnalyticsContentType.LearningJourney
    );
    expect(getContentTypeForAnalytics('https://grafana.com/docs/x')).toBe(AnalyticsContentType.Docs);
  });
});

describe('progress property helpers', () => {
  it('buildProgressProperties returns the trio, omitting completion_percentage when not supplied', () => {
    expect(buildProgressProperties(3, 7, 43)).toEqual({
      progress_step: 3,
      progress_total: 7,
      completion_percentage: 43,
    });
    expect(buildProgressProperties(3, 7)).toEqual({ progress_step: 3, progress_total: 7 });
    expect(buildProgressProperties(undefined, 7)).toEqual({});
    expect(buildProgressProperties(3, undefined)).toEqual({});
  });

  it('journeyProgressProperties derives a position-based percentage', () => {
    expect(journeyProgressProperties(3, 6)).toEqual({
      progress_step: 3,
      progress_total: 6,
      completion_percentage: 50,
    });
    expect(journeyProgressProperties(0, 0)).toEqual({ progress_step: 0, progress_total: 0, completion_percentage: 0 });
  });

  it('getJourneyNavigationProperties reports the destination milestone with caller-supplied completion', () => {
    expect(getJourneyNavigationProperties({ currentMilestone: 5, totalMilestones: 6 }, 'forward', 33)).toEqual({
      direction: 'forward',
      progress_step: 6,
      progress_total: 6,
      completion_percentage: 33,
    });
    expect(getJourneyNavigationProperties({ currentMilestone: 6, totalMilestones: 6 }, 'forward')).toEqual({
      direction: 'forward',
      progress_step: 6,
      progress_total: 6,
    });
    expect(getJourneyNavigationProperties({ currentMilestone: 1, totalMilestones: 6 }, 'backward', 17)).toEqual({
      direction: 'backward',
      progress_step: 0,
      progress_total: 6,
      completion_percentage: 17,
    });
    expect(getJourneyNavigationProperties(undefined, 'forward')).toEqual({
      direction: 'forward',
      progress_step: 0,
      progress_total: 0,
    });
  });
});
