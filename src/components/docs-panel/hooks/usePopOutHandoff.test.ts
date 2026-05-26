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
  const saveTabsToStorage = jest.fn().mockResolvedValue(undefined);
  const model = {
    get state() {
      return state;
    },
    saveTabsToStorage,
  };
  return {
    model: model as any,
    saveTabsToStorage,
    setActive(id: string) {
      state.activeTabId = id;
    },
  };
}

async function dispatchPopOut() {
  await act(async () => {
    document.dispatchEvent(new CustomEvent('pathfinder-request-pop-out'));
    // Let the async handler's await chain settle.
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('usePopOutHandoff', () => {
  let setModeSpy: jest.SpyInstance;
  let publishMock: jest.Mock;

  beforeEach(() => {
    setModeSpy = jest.spyOn(panelModeManager, 'setMode').mockImplementation(() => {});
    publishMock = jest.fn();
    (getAppEvents as jest.Mock).mockReturnValue({ publish: publishMock });
    (reportAppInteraction as jest.Mock).mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('flushes tabs to storage and switches to floating for an active learning-journey tab', async () => {
    const { model, saveTabsToStorage } = makeModel({
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
    await dispatchPopOut();

    expect(saveTabsToStorage).toHaveBeenCalledTimes(1);
    expect(setModeSpy).toHaveBeenCalledWith('floating');
    expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.FloatingPanelPopOut, {
      guide_url: 'https://example.com/a/milestone-3',
      guide_title: 'Journey A',
    });
  });

  it('awaits saveTabsToStorage before flipping the mode (closes the in-task milestone race)', async () => {
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
    // Replace the resolved save with a deferred one so we can assert ordering.
    let resolveSave!: () => void;
    const savePromise = new Promise<void>((r) => {
      resolveSave = r;
    });
    (model.saveTabsToStorage as jest.Mock).mockReturnValue(savePromise);

    renderHook(() => usePopOutHandoff(model));
    act(() => {
      document.dispatchEvent(new CustomEvent('pathfinder-request-pop-out'));
    });

    // Without resolving the save, setMode must not have fired.
    await Promise.resolve();
    expect(setModeSpy).not.toHaveBeenCalled();

    await act(async () => {
      resolveSave();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(setModeSpy).toHaveBeenCalledWith('floating');
  });

  it('editor branch: flushes storage and switches to floating with empty guide_url', async () => {
    const { model, saveTabsToStorage } = makeModel({
      tabs: [{ id: 'editor', type: 'editor', title: 'Block editor', baseUrl: 'bundled:editor' }],
      activeTabId: 'editor',
    });

    renderHook(() => usePopOutHandoff(model));
    await dispatchPopOut();

    expect(saveTabsToStorage).toHaveBeenCalledTimes(1);
    expect(setModeSpy).toHaveBeenCalledWith('floating');
    expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.FloatingPanelPopOut, {
      guide_url: '',
      guide_title: 'Block editor',
    });
  });

  it('refuses pop-out from the recommendations tab and emits alert-info', async () => {
    const { model, saveTabsToStorage } = makeModel({
      tabs: [{ id: 'recommendations', type: 'docs', title: 'Recs', baseUrl: '' }],
      activeTabId: 'recommendations',
    });

    renderHook(() => usePopOutHandoff(model));
    await dispatchPopOut();

    expect(publishMock).toHaveBeenCalledWith({
      type: 'alert-info',
      payload: ['Open a guide before popping out the panel.'],
    });
    expect(saveTabsToStorage).not.toHaveBeenCalled();
    expect(setModeSpy).not.toHaveBeenCalled();
  });

  it('refuses pop-out when there is no active tab', async () => {
    const { model } = makeModel({ tabs: [], activeTabId: 'missing' });

    renderHook(() => usePopOutHandoff(model));
    await dispatchPopOut();

    expect(publishMock).toHaveBeenCalledWith({
      type: 'alert-info',
      payload: ['Open a guide before popping out the panel.'],
    });
    expect(setModeSpy).not.toHaveBeenCalled();
  });

  it('H1 — re-reads model.state inside the handler (tab switched after mount)', async () => {
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
    await dispatchPopOut();

    expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.FloatingPanelPopOut, {
      guide_url: 'https://example.com/b',
      guide_title: 'Journey B',
    });
  });

  it('falls back to baseUrl when currentUrl is missing', async () => {
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
    await dispatchPopOut();

    expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.FloatingPanelPopOut, {
      guide_url: 'https://example.com/c',
      guide_title: 'Journey C',
    });
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
