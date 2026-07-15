import * as React from 'react';
import { act, render, renderHook } from '@testing-library/react';
import { usePanelReadyMeasurement } from './usePanelReadyMeasurement';
import { recordPanelReady } from '../../../lib/telemetry';
import { RECOMMENDATIONS_READY_EVENT } from '../../../lib/event-names';

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
      ({ hasContent }) => usePanelReadyMeasurement({ hasContent, isRecommendationsTab: false, surface: 'sidebar' }),
      { initialProps: { hasContent: false } }
    );

    now = 160;
    rerender({ hasContent: true });

    expect(mockRecordPanelReady).toHaveBeenCalledTimes(1);
    expect(mockRecordPanelReady).toHaveBeenCalledWith(60, 'sidebar');
    nowSpy.mockRestore();
  });

  it('records a measurement for content that is already ready at mount', () => {
    renderHook(() => usePanelReadyMeasurement({ hasContent: true, isRecommendationsTab: false, surface: 'sidebar' }));

    expect(mockRecordPanelReady).toHaveBeenCalledTimes(1);
    expect(mockRecordPanelReady).toHaveBeenCalledWith(expect.any(Number), 'sidebar');
  });

  it('waits for content before recording, then records exactly once', () => {
    const { rerender } = renderHook(
      ({ hasContent }) => usePanelReadyMeasurement({ hasContent, isRecommendationsTab: false, surface: 'floating' }),
      { initialProps: { hasContent: false } }
    );

    expect(mockRecordPanelReady).not.toHaveBeenCalled();

    rerender({ hasContent: true });
    expect(mockRecordPanelReady).toHaveBeenCalledTimes(1);

    rerender({ hasContent: false });
    rerender({ hasContent: true });
    expect(mockRecordPanelReady).toHaveBeenCalledTimes(1);
  });

  it('records for the recommendations tab only once the recommendations-ready event fires', () => {
    renderHook(() => usePanelReadyMeasurement({ hasContent: false, isRecommendationsTab: true, surface: 'sidebar' }));

    expect(mockRecordPanelReady).not.toHaveBeenCalled();

    act(() => {
      document.dispatchEvent(new CustomEvent(RECOMMENDATIONS_READY_EVENT));
    });

    expect(mockRecordPanelReady).toHaveBeenCalledTimes(1);
    expect(mockRecordPanelReady).toHaveBeenCalledWith(expect.any(Number), 'sidebar');
  });

  it('is not missed when a descendant dispatches the ready event from its own mount effect (child-before-parent effect ordering)', async () => {
    // Mirrors context-panel.tsx's real dispatch site (microtask-deferred)
    // so this fails if that deferral regresses.
    function ReadySignalChild() {
      React.useEffect(() => {
        queueMicrotask(() => document.dispatchEvent(new CustomEvent(RECOMMENDATIONS_READY_EVENT)));
      }, []);
      return null;
    }
    function Parent() {
      usePanelReadyMeasurement({ hasContent: false, isRecommendationsTab: true, surface: 'sidebar' });
      return React.createElement(ReadySignalChild);
    }

    await act(async () => {
      render(React.createElement(Parent));
    });

    expect(mockRecordPanelReady).toHaveBeenCalledTimes(1);
  });
});
