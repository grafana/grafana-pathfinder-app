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
  const saveTabsToStorage = jest.fn().mockResolvedValue(undefined);
  return {
    model: {
      get state() {
        return state;
      },
      saveTabsToStorage,
    } as any,
    saveTabsToStorage,
    setActive(id: string) {
      state.activeTabId = id;
    },
  };
}

async function dispatchFullScreen() {
  await act(async () => {
    document.dispatchEvent(new CustomEvent('pathfinder-request-full-screen'));
  });
}

describe('useFullScreenHandoff', () => {
  let setModePersistedSpy: jest.SpyInstance;
  let setPendingGuideSpy: jest.SpyInstance;
  let capturePriorPathSpy: jest.SpyInstance;
  let publishMock: jest.Mock;

  beforeEach(() => {
    setModePersistedSpy = jest.spyOn(panelModeManager, 'setModePersisted').mockImplementation(() => {});
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

  it('refuses when a live session is active and surfaces an alert', async () => {
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
    await dispatchFullScreen();

    expect(publishMock).toHaveBeenCalledWith({
      type: 'alert-info',
      payload: ['Leave the live session before switching to full screen.'],
    });
    expect(setModePersistedSpy).not.toHaveBeenCalled();
    expect(locationService.push).not.toHaveBeenCalled();
  });

  it('editor branch: pushes the bare full-screen route with no doc query', async () => {
    const { model, saveTabsToStorage } = makeModel({
      tabs: [{ id: 'editor', type: 'editor', title: 'Block editor', baseUrl: 'bundled:editor' }],
      activeTabId: 'editor',
    });
    renderHook(() => useFullScreenHandoff(model, false));
    await dispatchFullScreen();

    expect(setPendingGuideSpy).toHaveBeenCalledWith({ title: 'Block editor', type: 'editor' });
    expect(saveTabsToStorage).toHaveBeenCalledTimes(1);
    expect(capturePriorPathSpy).toHaveBeenCalledTimes(1);
    expect(setModePersistedSpy).toHaveBeenCalledWith('fullscreen');
    expect(locationService.push).toHaveBeenCalledWith(expect.stringContaining('/fullscreen'));
    expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.FullScreenEnter, {
      guide_url: '',
      guide_title: 'Block editor',
      content_type: 'editor',
    });
  });

  it.each([
    ['recommendations', 'Recs'],
    ['devtools', 'Dev Tools'],
  ])('refuses the unsupported %s tab without touching storage', async (type, title) => {
    const { model, saveTabsToStorage } = makeModel({
      tabs: [{ id: type, type, title, baseUrl: '' }],
      activeTabId: type,
    });
    renderHook(() => useFullScreenHandoff(model, false));
    await dispatchFullScreen();

    expect(publishMock).toHaveBeenCalledWith({
      type: 'alert-info',
      payload: ['Open a guide before switching to full screen.'],
    });
    expect(saveTabsToStorage).not.toHaveBeenCalled();
    expect(setModePersistedSpy).not.toHaveBeenCalled();
  });

  it('hands off the active learning-journey using currentUrl with doc + guideType in the URL', async () => {
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
    await dispatchFullScreen();

    expect(setPendingGuideSpy).toHaveBeenCalledWith({
      url: 'https://example.com/a/milestone-2',
      title: 'Journey A',
      // Identity travels with the handoff: the full-screen page restores this
      // same tab from storage and focuses it rather than opening a second copy.
      tabId: 'tab-a',
      type: 'learning-journey',
      packageInfo: { packageId: 'pkg-y' },
    });
    expect(capturePriorPathSpy).toHaveBeenCalledTimes(1);
    expect(setModePersistedSpy).toHaveBeenCalledWith('fullscreen');
    const pushedUrl = (locationService.push as jest.Mock).mock.calls[0][0];
    expect(pushedUrl).toContain('doc=');
    expect(pushedUrl).toContain('type=learning-journey');
  });

  it('treats docs-type tabs as type "docs" in payload and URL', async () => {
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
    await dispatchFullScreen();

    expect(setPendingGuideSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'docs' }));
    const pushedUrl = (locationService.push as jest.Mock).mock.calls[0][0];
    expect(pushedUrl).toContain('type=docs');
  });

  it('H1 — re-reads model.state inside the handler (tab switched after mount)', async () => {
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
    await dispatchFullScreen();

    expect(setPendingGuideSpy).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://example.com/b', title: 'Journey B' })
    );
  });

  it('awaits saveTabsToStorage before flipping the mode, so full screen restores the current tabs', async () => {
    const { model } = makeModel({
      tabs: [
        {
          id: 'tab-a',
          type: 'learning-journey',
          title: 'Journey A',
          baseUrl: 'https://example.com/a',
          currentUrl: 'https://example.com/a/milestone-3',
        },
      ],
      activeTabId: 'tab-a',
    });
    let resolveSave!: () => void;
    (model.saveTabsToStorage as jest.Mock).mockReturnValue(
      new Promise<void>((resolve) => {
        resolveSave = resolve;
      })
    );

    renderHook(() => useFullScreenHandoff(model, false));
    await dispatchFullScreen();

    expect(setModePersistedSpy).not.toHaveBeenCalled();
    expect(locationService.push).not.toHaveBeenCalled();

    await act(async () => {
      resolveSave();
    });

    expect(setModePersistedSpy).toHaveBeenCalledWith('fullscreen');
    expect(locationService.push).toHaveBeenCalledTimes(1);
  });

  it('removes the listener on unmount', async () => {
    const { model } = makeModel({ tabs: [], activeTabId: 'x' });
    const removeSpy = jest.spyOn(document, 'removeEventListener');
    const { unmount } = renderHook(() => useFullScreenHandoff(model, false));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('pathfinder-request-full-screen', expect.any(Function));
    removeSpy.mockRestore();
  });
});
