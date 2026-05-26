import { renderHook, act } from '@testing-library/react';
import { useFullScreenHandoff } from './useFullScreenHandoff';
import { panelModeManager } from '../../../global-state/panel-mode';
import { reportAppInteraction, UserInteraction } from '../../../lib/analytics';
import { getAppEvents, locationService } from '@grafana/runtime';

jest.mock('../../../lib/analytics', () => {
  const actual = jest.requireActual('../../../lib/analytics');
  return { ...actual, reportAppInteraction: jest.fn() };
});

jest.mock('@grafana/runtime', () => {
  const actual = jest.requireActual('@grafana/runtime');
  return {
    ...actual,
    getAppEvents: jest.fn(),
    locationService: { push: jest.fn() },
  };
});

function makeModel(initial: { tabs: any[]; activeTabId: string }) {
  const state = { ...initial };
  return {
    model: {
      get state() {
        return state;
      },
    } as any,
    setActive(id: string) {
      state.activeTabId = id;
    },
  };
}

function dispatchFullScreen() {
  act(() => {
    document.dispatchEvent(new CustomEvent('pathfinder-request-full-screen'));
  });
}

describe('useFullScreenHandoff', () => {
  let setModeSpy: jest.SpyInstance;
  let setPendingGuideSpy: jest.SpyInstance;
  let capturePriorPathSpy: jest.SpyInstance;
  let publishMock: jest.Mock;

  beforeEach(() => {
    setModeSpy = jest.spyOn(panelModeManager, 'setMode').mockImplementation(() => {});
    setPendingGuideSpy = jest.spyOn(panelModeManager, 'setPendingGuide').mockImplementation(() => {});
    capturePriorPathSpy = jest.spyOn(panelModeManager, 'capturePriorPath').mockImplementation(() => {});
    publishMock = jest.fn();
    (getAppEvents as jest.Mock).mockReturnValue({ publish: publishMock });
    (reportAppInteraction as jest.Mock).mockClear();
    (locationService.push as jest.Mock).mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('refuses when a live session is active and surfaces an alert', () => {
    const { model } = makeModel({
      tabs: [
        {
          id: 'tab-a',
          type: 'learning-journey',
          title: 'A',
          baseUrl: 'https://example.com/a',
          currentUrl: 'https://example.com/a',
        },
      ],
      activeTabId: 'tab-a',
    });
    renderHook(() => useFullScreenHandoff(model, true));
    dispatchFullScreen();

    expect(publishMock).toHaveBeenCalledWith({
      type: 'alert-info',
      payload: ['Leave the live session before switching to full screen.'],
    });
    expect(setModeSpy).not.toHaveBeenCalled();
    expect(locationService.push).not.toHaveBeenCalled();
  });

  it('editor branch: pushes the bare full-screen route with no doc query', () => {
    const { model } = makeModel({
      tabs: [{ id: 'editor', type: 'editor', title: 'Block editor', baseUrl: 'bundled:editor' }],
      activeTabId: 'editor',
    });
    renderHook(() => useFullScreenHandoff(model, false));
    dispatchFullScreen();

    expect(setPendingGuideSpy).toHaveBeenCalledWith({ title: 'Block editor', type: 'editor' });
    expect(capturePriorPathSpy).toHaveBeenCalledTimes(1);
    expect(setModeSpy).toHaveBeenCalledWith('fullscreen');
    expect(locationService.push).toHaveBeenCalledWith(expect.stringContaining('/fullscreen'));
    expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.FullScreenEnter, {
      guide_url: '',
      guide_title: 'Block editor',
      content_type: 'editor',
    });
  });

  it('refuses recommendations tab with an alert', () => {
    const { model } = makeModel({
      tabs: [{ id: 'recommendations', type: 'docs', title: 'Recs', baseUrl: '' }],
      activeTabId: 'recommendations',
    });
    renderHook(() => useFullScreenHandoff(model, false));
    dispatchFullScreen();

    expect(publishMock).toHaveBeenCalledWith({
      type: 'alert-info',
      payload: ['Open a guide before switching to full screen.'],
    });
    expect(setModeSpy).not.toHaveBeenCalled();
  });

  it('refuses devtools tab with an alert', () => {
    const { model } = makeModel({
      tabs: [{ id: 'devtools', type: 'devtools', title: 'Devtools', baseUrl: '' }],
      activeTabId: 'devtools',
    });
    renderHook(() => useFullScreenHandoff(model, false));
    dispatchFullScreen();

    expect(publishMock).toHaveBeenCalledWith({
      type: 'alert-info',
      payload: ['Open a guide before switching to full screen.'],
    });
    expect(setModeSpy).not.toHaveBeenCalled();
  });

  it('hands off the active learning-journey using currentUrl with doc + guideType in the URL', () => {
    const { model } = makeModel({
      tabs: [
        {
          id: 'tab-a',
          type: 'learning-journey',
          title: 'Journey A',
          baseUrl: 'https://example.com/a',
          currentUrl: 'https://example.com/a/milestone-2',
          packageInfo: { packageId: 'pkg-y' },
        },
      ],
      activeTabId: 'tab-a',
    });
    renderHook(() => useFullScreenHandoff(model, false));
    dispatchFullScreen();

    expect(setPendingGuideSpy).toHaveBeenCalledWith({
      url: 'https://example.com/a/milestone-2',
      title: 'Journey A',
      type: 'learning-journey',
      packageInfo: { packageId: 'pkg-y' },
    });
    expect(capturePriorPathSpy).toHaveBeenCalledTimes(1);
    expect(setModeSpy).toHaveBeenCalledWith('fullscreen');
    const pushedUrl = (locationService.push as jest.Mock).mock.calls[0][0];
    expect(pushedUrl).toContain('doc=');
    expect(pushedUrl).toContain('type=learning-journey');
  });

  it('treats docs-type tabs as type "docs" in payload and URL', () => {
    const { model } = makeModel({
      tabs: [
        {
          id: 'tab-d',
          type: 'docs',
          title: 'Docs',
          baseUrl: 'https://example.com/d',
          currentUrl: 'https://example.com/d',
        },
      ],
      activeTabId: 'tab-d',
    });
    renderHook(() => useFullScreenHandoff(model, false));
    dispatchFullScreen();

    expect(setPendingGuideSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'docs' }));
    const pushedUrl = (locationService.push as jest.Mock).mock.calls[0][0];
    expect(pushedUrl).toContain('type=docs');
  });

  it('H1 — re-reads model.state inside the handler (tab switched after mount)', () => {
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
    renderHook(() => useFullScreenHandoff(model, false));
    setActive('tab-b');
    dispatchFullScreen();

    expect(setPendingGuideSpy).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://example.com/b', title: 'Journey B' })
    );
  });

  it('removes the listener on unmount', () => {
    const { model } = makeModel({ tabs: [], activeTabId: 'x' });
    const removeSpy = jest.spyOn(document, 'removeEventListener');
    const { unmount } = renderHook(() => useFullScreenHandoff(model, false));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('pathfinder-request-full-screen', expect.any(Function));
    removeSpy.mockRestore();
  });
});
