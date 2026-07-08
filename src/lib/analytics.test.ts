import { reportAppInteraction, UserInteraction, bindExperimentsProvider } from './analytics';
import { reportInteraction } from '@grafana/runtime';
import { notifyFaroEngagement, pushFaroUserAction } from './faro';

jest.mock('@grafana/runtime', () => ({
  reportInteraction: jest.fn(),
}));

jest.mock('../../package.json', () => ({
  version: '1.0.0-test',
}));

jest.mock('../security/url-validator', () => ({
  isInteractiveLearningUrl: jest.fn(() => false),
}));

jest.mock('./faro', () => ({
  pushFaroUserAction: jest.fn(),
  pushFaroLog: jest.fn(),
  pushFaroError: jest.fn(),
  notifyFaroEngagement: jest.fn(() => Promise.resolve()),
}));

const mockReportInteraction = reportInteraction as jest.Mock;
const mockPushFaroUserAction = pushFaroUserAction as jest.Mock;
const mockNotifyFaroEngagement = notifyFaroEngagement as jest.Mock;

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
      content_type: 'interactive_guide',
    });

    const properties = mockReportInteraction.mock.calls[0][1];
    expect(properties.kiosk_session_id).toBe('kiosk-123');
    expect(properties.step_id).toBe('step-1');
    expect(properties.content_type).toBe('interactive_guide');
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
    expect(mockNotifyFaroEngagement).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
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

  it('does not enrich FeatureFlagEvaluated events (recursion guard)', () => {
    bindExperimentsProvider(() => [{ flag: HIGHLIGHTED, variant: 'treatment', pages: [], guideId: 'g' }]);

    reportAppInteraction(UserInteraction.FeatureFlagEvaluated, { flag_key: HIGHLIGHTED });

    const props = mockReportInteraction.mock.calls[0][1];
    expect(props).not.toHaveProperty('experiments');
    expect(props).not.toHaveProperty('variant');
    expect(props.flag_key).toBe(HIGHLIGHTED);
  });

  it('signals Faro engagement for regular interactions', () => {
    reportAppInteraction(UserInteraction.DocsPanelInteraction, { action: 'open' });
    expect(mockNotifyFaroEngagement).toHaveBeenCalledTimes(1);
    expect(mockPushFaroUserAction).toHaveBeenCalledTimes(1);
  });

  it('does not signal Faro engagement for flag exposures, but still mirrors them', () => {
    reportAppInteraction(UserInteraction.FeatureFlagEvaluated, { flag_key: HIGHLIGHTED });
    expect(mockNotifyFaroEngagement).not.toHaveBeenCalled();
    expect(mockPushFaroUserAction).toHaveBeenCalledTimes(1);
  });
});
