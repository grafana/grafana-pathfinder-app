import { renderHook, act } from '@testing-library/react';
import { usePopOutHandoff } from './usePopOutHandoff';
import { panelModeManager } from '../../../global-state/panel-mode';
import { reportAppInteraction, UserInteraction } from '../../../lib/analytics';
import { getAppEvents } from '@grafana/runtime';

jest.mock('../../../lib/analytics', () => {
  const actual = jest.requireActual('../../../lib/analytics');
  return {
    ...actual,
    reportAppInteraction: jest.fn(),
  };
});

jest.mock('@grafana/runtime', () => {
  const actual = jest.requireActual('@grafana/runtime');
  return {
    ...actual,
    getAppEvents: jest.fn(),
  };
});

function makeModel(initial: { tabs: any[]; activeTabId: string }) {
  // Mutable state container so we can flip activeTabId between mount and
  // event dispatch — characterizes the H1 closure-capture safety property.
  const state = { ...initial };
  const model = {
    get state() {
      return state;
    },
  };
  return {
    model: model as any,
    setActive(id: string) {
      state.activeTabId = id;
    },
  };
}

function dispatchPopOut() {
  act(() => {
    document.dispatchEvent(new CustomEvent('pathfinder-request-pop-out'));
  });
}

describe('usePopOutHandoff', () => {
  let setModeSpy: jest.SpyInstance;
  let setPendingGuideSpy: jest.SpyInstance;
  let snapshotSpy: jest.SpyInstance;
  let publishMock: jest.Mock;

  beforeEach(() => {
    setModeSpy = jest.spyOn(panelModeManager, 'setMode').mockImplementation(() => {});
    setPendingGuideSpy = jest.spyOn(panelModeManager, 'setPendingGuide').mockImplementation(() => {});
    snapshotSpy = jest.spyOn(panelModeManager, 'snapshotSidebarTabs').mockImplementation(() => {});
    publishMock = jest.fn();
    (getAppEvents as jest.Mock).mockReturnValue({ publish: publishMock });
    (reportAppInteraction as jest.Mock).mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('hands off the active learning-journey tab using currentUrl, then switches to floating', () => {
    const { model } = makeModel({
      tabs: [
        {
          id: 'tab-a',
          type: 'learning-journey',
          title: 'Journey A',
          baseUrl: 'https://example.com/a',
          currentUrl: 'https://example.com/a/milestone-3',
          packageInfo: { packageId: 'pkg-x' },
        },
      ],
      activeTabId: 'tab-a',
    });

    renderHook(() => usePopOutHandoff(model));
    dispatchPopOut();

    expect(setPendingGuideSpy).toHaveBeenCalledWith({
      url: 'https://example.com/a/milestone-3',
      title: 'Journey A',
      type: 'learning-journey',
      packageInfo: { packageId: 'pkg-x' },
    });
    expect(snapshotSpy).toHaveBeenCalledTimes(1);
    expect(setModeSpy).toHaveBeenCalledWith('floating');
    expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.FloatingPanelPopOut, {
      guide_url: 'https://example.com/a/milestone-3',
      guide_title: 'Journey A',
    });
  });

  it('treats docs tabs as type "docs" in the handoff payload', () => {
    const { model } = makeModel({
      tabs: [
        {
          id: 'tab-d',
          type: 'docs',
          title: 'Docs page',
          baseUrl: 'https://example.com/d',
          currentUrl: 'https://example.com/d',
        },
      ],
      activeTabId: 'tab-d',
    });

    renderHook(() => usePopOutHandoff(model));
    dispatchPopOut();

    expect(setPendingGuideSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'docs' }));
  });

  it('editor branch: snapshot + setMode("floating") with empty guide_url, no setPendingGuide', () => {
    const { model } = makeModel({
      tabs: [{ id: 'editor', type: 'editor', title: 'Block editor', baseUrl: 'bundled:editor' }],
      activeTabId: 'editor',
    });

    renderHook(() => usePopOutHandoff(model));
    dispatchPopOut();

    expect(setPendingGuideSpy).not.toHaveBeenCalled();
    expect(snapshotSpy).toHaveBeenCalledTimes(1);
    expect(setModeSpy).toHaveBeenCalledWith('floating');
    expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.FloatingPanelPopOut, {
      guide_url: '',
      guide_title: 'Block editor',
    });
  });

  it('refuses pop-out from the recommendations tab and emits alert-info', () => {
    const { model } = makeModel({
      tabs: [{ id: 'recommendations', type: 'docs', title: 'Recs', baseUrl: '' }],
      activeTabId: 'recommendations',
    });

    renderHook(() => usePopOutHandoff(model));
    dispatchPopOut();

    expect(publishMock).toHaveBeenCalledWith({
      type: 'alert-info',
      payload: ['Open a guide before popping out the panel.'],
    });
    expect(setPendingGuideSpy).not.toHaveBeenCalled();
    expect(setModeSpy).not.toHaveBeenCalled();
  });

  it('refuses pop-out when there is no active tab', () => {
    const { model } = makeModel({ tabs: [], activeTabId: 'missing' });

    renderHook(() => usePopOutHandoff(model));
    dispatchPopOut();

    expect(publishMock).toHaveBeenCalledWith({
      type: 'alert-info',
      payload: ['Open a guide before popping out the panel.'],
    });
    expect(setModeSpy).not.toHaveBeenCalled();
  });

  it('H1 — re-reads model.state inside the handler (tab switched after mount)', () => {
    // Mount with tab A active, then switch to tab B, then dispatch.
    // If the handler captured `state` at mount time (closure-over-snapshot
    // bug), tab A would still be the source. The handler MUST re-read.
    const { model, setActive } = makeModel({
      tabs: [
        {
          id: 'tab-a',
          type: 'learning-journey',
          title: 'Journey A',
          baseUrl: 'https://example.com/a',
          currentUrl: 'https://example.com/a',
        },
        {
          id: 'tab-b',
          type: 'learning-journey',
          title: 'Journey B',
          baseUrl: 'https://example.com/b',
          currentUrl: 'https://example.com/b',
        },
      ],
      activeTabId: 'tab-a',
    });

    renderHook(() => usePopOutHandoff(model));
    setActive('tab-b');
    dispatchPopOut();

    expect(setPendingGuideSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://example.com/b',
        title: 'Journey B',
      })
    );
  });

  it('falls back to baseUrl when currentUrl is missing', () => {
    const { model } = makeModel({
      tabs: [
        {
          id: 'tab-c',
          type: 'learning-journey',
          title: 'Journey C',
          baseUrl: 'https://example.com/c',
          // no currentUrl
        },
      ],
      activeTabId: 'tab-c',
    });

    renderHook(() => usePopOutHandoff(model));
    dispatchPopOut();

    expect(setPendingGuideSpy).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://example.com/c' }));
  });

  it('removes the listener on unmount', () => {
    const { model } = makeModel({ tabs: [], activeTabId: 'x' });
    const removeSpy = jest.spyOn(document, 'removeEventListener');
    const { unmount } = renderHook(() => usePopOutHandoff(model));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('pathfinder-request-pop-out', expect.any(Function));
    removeSpy.mockRestore();
  });
});
