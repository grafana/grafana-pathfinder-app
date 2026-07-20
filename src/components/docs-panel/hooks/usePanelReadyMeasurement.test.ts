import { renderHook } from '@testing-library/react';
import { usePanelReadyMeasurement } from './usePanelReadyMeasurement';
import { recordPanelReady } from '../../../lib/telemetry';

jest.mock('../../../lib/telemetry', () => ({
  recordPanelReady: jest.fn(),
}));

const mockRecordPanelReady = recordPanelReady as jest.Mock;

describe('usePanelReadyMeasurement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('anchors the clock at first render so the duration spans mount → content, not content → effect', () => {
    // Controlled clock shared by every performance.now caller (React included).
    let now = 100;
    const nowSpy = jest.spyOn(performance, 'now').mockImplementation(() => now);

    const { rerender } = renderHook(
      ({ hasContent }) =>
        usePanelReadyMeasurement({
          hasContent,
          isRecommendationsTab: false,
          recommendationsReady: false,
          surface: 'sidebar',
        }),
      { initialProps: { hasContent: false } }
    );

    now = 160;
    rerender({ hasContent: true });

    expect(mockRecordPanelReady).toHaveBeenCalledTimes(1);
    expect(mockRecordPanelReady).toHaveBeenCalledWith(60, 'sidebar');
    nowSpy.mockRestore();
  });

  it('records a measurement for content that is already ready at mount', () => {
    renderHook(() =>
      usePanelReadyMeasurement({
        hasContent: true,
        isRecommendationsTab: false,
        recommendationsReady: false,
        surface: 'sidebar',
      })
    );

    expect(mockRecordPanelReady).toHaveBeenCalledTimes(1);
    expect(mockRecordPanelReady).toHaveBeenCalledWith(expect.any(Number), 'sidebar');
  });

  it('waits for content before recording, then records exactly once', () => {
    const { rerender } = renderHook(
      ({ hasContent }) =>
        usePanelReadyMeasurement({
          hasContent,
          isRecommendationsTab: false,
          recommendationsReady: false,
          surface: 'floating',
        }),
      { initialProps: { hasContent: false } }
    );

    expect(mockRecordPanelReady).not.toHaveBeenCalled();

    rerender({ hasContent: true });
    expect(mockRecordPanelReady).toHaveBeenCalledTimes(1);

    rerender({ hasContent: false });
    rerender({ hasContent: true });
    expect(mockRecordPanelReady).toHaveBeenCalledTimes(1);
  });

  it('records for the recommendations tab once recommendations become ready', () => {
    const { rerender } = renderHook(
      ({ recommendationsReady }) =>
        usePanelReadyMeasurement({
          hasContent: false,
          isRecommendationsTab: true,
          recommendationsReady,
          surface: 'sidebar',
        }),
      { initialProps: { recommendationsReady: false } }
    );

    expect(mockRecordPanelReady).not.toHaveBeenCalled();

    rerender({ recommendationsReady: true });

    expect(mockRecordPanelReady).toHaveBeenCalledTimes(1);
    expect(mockRecordPanelReady).toHaveBeenCalledWith(expect.any(Number), 'sidebar');
  });

  it('records when recommendations are already ready at mount (synchronous cache hit, the previously-racy path)', () => {
    renderHook(() =>
      usePanelReadyMeasurement({
        hasContent: false,
        isRecommendationsTab: true,
        recommendationsReady: true,
        surface: 'sidebar',
      })
    );

    expect(mockRecordPanelReady).toHaveBeenCalledTimes(1);
    expect(mockRecordPanelReady).toHaveBeenCalledWith(expect.any(Number), 'sidebar');
  });

  it('ignores recommendations readiness when the recommendations tab is not active', () => {
    renderHook(() =>
      usePanelReadyMeasurement({
        hasContent: false,
        isRecommendationsTab: false,
        recommendationsReady: true,
        surface: 'sidebar',
      })
    );

    expect(mockRecordPanelReady).not.toHaveBeenCalled();
  });
});
