import { renderHook } from '@testing-library/react';
import { useTabRestoration } from './useTabRestoration';
import type { PanelMode } from '../../../global-state/panel-mode';

function makeModel() {
  return {
    state: { tabs: [], activeTabId: '' } as any,
    restoreTabsAsync: jest.fn().mockResolvedValue(undefined),
  } as any;
}

const tab = (id: string, type: 'recommendations' | 'docs' | 'editor' = 'docs') =>
  ({
    id,
    title: id,
    baseUrl: '',
    currentUrl: '',
    content: null,
    isLoading: false,
    error: null,
    type,
  }) as any;

describe('useTabRestoration', () => {
  it('calls restoreTabsAsync on initial mount when no guide-strip tabs exist', () => {
    const model = makeModel();
    renderHook(() =>
      useTabRestoration({ model, panelMode: 'sidebar', tabs: [tab('recommendations', 'recommendations')] })
    );
    expect(model.restoreTabsAsync).toHaveBeenCalledTimes(1);
  });

  it('does NOT restore when an editor tab is already in the strip', () => {
    const model = makeModel();
    renderHook(() =>
      useTabRestoration({
        model,
        panelMode: 'sidebar',
        tabs: [tab('recommendations', 'recommendations'), tab('editor', 'editor')],
      })
    );
    expect(model.restoreTabsAsync).not.toHaveBeenCalled();
  });

  it('does NOT restore when a user-opened guide tab is present', () => {
    const model = makeModel();
    renderHook(() =>
      useTabRestoration({
        model,
        panelMode: 'sidebar',
        tabs: [tab('recommendations', 'recommendations'), tab('user-guide-1')],
      })
    );
    expect(model.restoreTabsAsync).not.toHaveBeenCalled();
  });

  it('skips restoration when panelMode is "fullscreen"', () => {
    const model = makeModel();
    renderHook(() =>
      useTabRestoration({ model, panelMode: 'fullscreen', tabs: [tab('recommendations', 'recommendations')] })
    );
    expect(model.restoreTabsAsync).not.toHaveBeenCalled();
  });

  it('force-refreshes the sidebar model when returning from fullscreen', () => {
    const model = makeModel();
    const { rerender } = renderHook(
      (props: { panelMode: PanelMode; tabs: any[] }) =>
        useTabRestoration({ model, panelMode: props.panelMode, tabs: props.tabs }),
      { initialProps: { panelMode: 'fullscreen' as PanelMode, tabs: [tab('recommendations', 'recommendations')] } }
    );
    expect(model.restoreTabsAsync).not.toHaveBeenCalled();

    rerender({ panelMode: 'sidebar', tabs: [tab('recommendations', 'recommendations')] });
    expect(model.restoreTabsAsync).toHaveBeenCalledWith({ force: true });
  });

  it('force-refreshes over a populated strip, so fullscreen tab work is not dropped', () => {
    const model = makeModel();
    const tabs = [tab('recommendations', 'recommendations'), tab('user-guide-1')];
    const { rerender } = renderHook(
      ({ panelMode }: { panelMode: PanelMode }) => useTabRestoration({ model, panelMode, tabs }),
      { initialProps: { panelMode: 'fullscreen' as PanelMode } }
    );

    rerender({ panelMode: 'sidebar' });
    expect(model.restoreTabsAsync).toHaveBeenCalledWith({ force: true });
  });

  it('force-refreshes the sidebar model when returning from floating mode', () => {
    const model = makeModel();
    const tabs = [tab('recommendations', 'recommendations'), tab('editor', 'editor')];
    const { rerender } = renderHook(
      ({ panelMode }: { panelMode: PanelMode }) => useTabRestoration({ model, panelMode, tabs }),
      { initialProps: { panelMode: 'floating' as PanelMode } }
    );
    expect(model.restoreTabsAsync).not.toHaveBeenCalled();

    rerender({ panelMode: 'sidebar' });
    expect(model.restoreTabsAsync).toHaveBeenCalledWith({ force: true });
  });

  it('does NOT re-fire on tab or model changes when panelMode is unchanged (preserves [panelMode]-only dep array)', () => {
    const model = makeModel();
    const { rerender } = renderHook(
      (props: { panelMode: PanelMode; tabs: any[] }) =>
        useTabRestoration({ model, panelMode: props.panelMode, tabs: props.tabs }),
      { initialProps: { panelMode: 'sidebar' as PanelMode, tabs: [tab('recommendations', 'recommendations')] } }
    );
    expect(model.restoreTabsAsync).toHaveBeenCalledTimes(1);

    rerender({
      panelMode: 'sidebar',
      tabs: [tab('recommendations', 'recommendations'), tab('opened-guide')],
    });
    rerender({ panelMode: 'sidebar', tabs: [tab('recommendations', 'recommendations')] });
    expect(model.restoreTabsAsync).toHaveBeenCalledTimes(1);
  });
});
