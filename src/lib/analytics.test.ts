import { reportAppInteraction, UserInteraction } from './analytics';
import { reportInteraction } from '@grafana/runtime';

jest.mock('@grafana/runtime', () => ({
  reportInteraction: jest.fn(),
}));

jest.mock('../../package.json', () => ({
  version: '1.0.0-test',
}));

jest.mock('../security/url-validator', () => ({
  isInteractiveLearningUrl: jest.fn(() => false),
}));

const mockReportInteraction = reportInteraction as jest.Mock;

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
