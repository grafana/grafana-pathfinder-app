import { renderHook } from '@testing-library/react';
import { useTabRestoration } from './useTabRestoration';
import type { PanelMode } from '../../../global-state/panel-mode';

function makeModel() {
  return {
    state: { tabs: [], activeTabId: '' } as any,
    restoreTabsAsync: jest.fn().mockResolvedValue(undefined),
  } as any;
}

const tab = (id: string) =>
  ({
    id,
    title: id,
    baseUrl: '',
    currentUrl: '',
    content: null,
    isLoading: false,
    error: null,
    type: 'docs',
  }) as any;

describe('useTabRestoration', () => {
  it('calls restoreTabsAsync on initial mount when only permanent tabs exist', () => {
    const model = makeModel();
    renderHook(() => useTabRestoration({ model, panelMode: 'sidebar', tabs: [tab('recommendations')] }));
    expect(model.restoreTabsAsync).toHaveBeenCalledTimes(1);
  });

  it('treats devtools and editor as permanent (still restores)', () => {
    const model = makeModel();
    renderHook(() =>
      useTabRestoration({
        model,
        panelMode: 'sidebar',
        tabs: [tab('recommendations'), tab('devtools'), tab('editor')],
      })
    );
    expect(model.restoreTabsAsync).toHaveBeenCalledTimes(1);
  });

  it('does NOT restore when a user-opened guide tab is present', () => {
    const model = makeModel();
    renderHook(() =>
      useTabRestoration({
        model,
        panelMode: 'sidebar',
        tabs: [tab('recommendations'), tab('user-guide-1')],
      })
    );
    expect(model.restoreTabsAsync).not.toHaveBeenCalled();
  });

  it('skips restoration when panelMode is "fullscreen"', () => {
    const model = makeModel();
    renderHook(() => useTabRestoration({ model, panelMode: 'fullscreen', tabs: [tab('recommendations')] }));
    expect(model.restoreTabsAsync).not.toHaveBeenCalled();
  });

  it('re-fires when panelMode transitions away from fullscreen', () => {
    const model = makeModel();
    const { rerender } = renderHook(
      (props: { panelMode: PanelMode; tabs: any[] }) =>
        useTabRestoration({ model, panelMode: props.panelMode, tabs: props.tabs }),
      { initialProps: { panelMode: 'fullscreen' as PanelMode, tabs: [tab('recommendations')] } }
    );
    expect(model.restoreTabsAsync).not.toHaveBeenCalled();

    rerender({ panelMode: 'sidebar', tabs: [tab('recommendations')] });
    expect(model.restoreTabsAsync).toHaveBeenCalledTimes(1);
  });

  it('does NOT re-fire on tab or model changes when panelMode is unchanged (preserves [panelMode]-only dep array)', () => {
    const model = makeModel();
    const { rerender } = renderHook(
      (props: { panelMode: PanelMode; tabs: any[] }) =>
        useTabRestoration({ model, panelMode: props.panelMode, tabs: props.tabs }),
      { initialProps: { panelMode: 'sidebar' as PanelMode, tabs: [tab('recommendations')] } }
    );
    expect(model.restoreTabsAsync).toHaveBeenCalledTimes(1);

    rerender({ panelMode: 'sidebar', tabs: [tab('recommendations'), tab('opened-guide')] });
    rerender({ panelMode: 'sidebar', tabs: [tab('recommendations')] });
    expect(model.restoreTabsAsync).toHaveBeenCalledTimes(1);
  });
});
