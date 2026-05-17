import { renderHook } from '@testing-library/react';
import { usePermanentTabs } from './usePermanentTabs';
import type { LearningJourneyTab } from '../../../types/content-panel.types';

function makeModel(tabs: any[], activeTabId = 'recommendations') {
  const state: any = { tabs, activeTabId };
  const setState = jest.fn((patch: any) => {
    Object.assign(state, patch);
  });
  const saveTabsToStorage = jest.fn().mockResolvedValue(undefined);
  return {
    model: { state, setState, saveTabsToStorage } as any,
    state,
    setState,
    saveTabsToStorage,
  };
}

const baseTab = (id: string, type: any = 'docs'): LearningJourneyTab =>
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

describe('usePermanentTabs', () => {
  it('adds devtools when isDevMode is true and missing', () => {
    const { model, setState } = makeModel([baseTab('recommendations')]);
    renderHook(() => usePermanentTabs({ model, isDevMode: true, isEditorUser: false, tabs: model.state.tabs }));
    expect(setState).toHaveBeenCalledTimes(1);
    const patch = setState.mock.calls[0]![0];
    expect(patch.tabs.some((t: any) => t.id === 'devtools' && t.type === 'devtools')).toBe(true);
  });

  it('adds editor when isEditorUser is true and missing', () => {
    const { model, setState } = makeModel([baseTab('recommendations')]);
    renderHook(() => usePermanentTabs({ model, isDevMode: false, isEditorUser: true, tabs: model.state.tabs }));
    const patch = setState.mock.calls[0]![0];
    expect(patch.tabs.some((t: any) => t.id === 'editor' && t.type === 'editor')).toBe(true);
  });

  it('adds both devtools AND editor in a single setState call when both are missing', () => {
    const { model, setState } = makeModel([baseTab('recommendations')]);
    renderHook(() => usePermanentTabs({ model, isDevMode: true, isEditorUser: true, tabs: model.state.tabs }));
    expect(setState).toHaveBeenCalledTimes(1);
    const patch = setState.mock.calls[0]![0];
    expect(patch.tabs.some((t: any) => t.id === 'devtools')).toBe(true);
    expect(patch.tabs.some((t: any) => t.id === 'editor')).toBe(true);
  });

  it('does not setState when both permanent tabs already exist', () => {
    const tabs = [baseTab('recommendations'), baseTab('devtools', 'devtools'), baseTab('editor', 'editor')];
    const { model, setState } = makeModel(tabs);
    renderHook(() => usePermanentTabs({ model, isDevMode: true, isEditorUser: true, tabs: model.state.tabs }));
    expect(setState).not.toHaveBeenCalled();
  });

  it('removes stale editor tab on role downgrade and saves to storage', () => {
    const tabs = [baseTab('recommendations'), baseTab('editor', 'editor')];
    const { model, setState, saveTabsToStorage } = makeModel(tabs);
    renderHook(() => usePermanentTabs({ model, isDevMode: false, isEditorUser: false, tabs: model.state.tabs }));
    expect(setState).toHaveBeenCalledTimes(1);
    const patch = setState.mock.calls[0]![0];
    expect(patch.tabs.some((t: any) => t.id === 'editor')).toBe(false);
    expect(saveTabsToStorage).toHaveBeenCalledTimes(1);
  });

  it('redirects to recommendations when removing the active editor tab', () => {
    const tabs = [baseTab('recommendations'), baseTab('editor', 'editor')];
    const { model, setState } = makeModel(tabs, 'editor');
    renderHook(() => usePermanentTabs({ model, isDevMode: false, isEditorUser: false, tabs: model.state.tabs }));
    const patch = setState.mock.calls[0]![0];
    expect(patch.activeTabId).toBe('recommendations');
  });

  it('does NOT touch storage when only adding tabs (not on every mount)', () => {
    const { model, saveTabsToStorage } = makeModel([baseTab('recommendations')]);
    renderHook(() => usePermanentTabs({ model, isDevMode: true, isEditorUser: true, tabs: model.state.tabs }));
    expect(saveTabsToStorage).not.toHaveBeenCalled();
  });

  it('keeps the active tab unchanged when removing editor but not active there', () => {
    const tabs = [baseTab('recommendations'), baseTab('editor', 'editor'), baseTab('tab-a')];
    const { model, setState } = makeModel(tabs, 'tab-a');
    renderHook(() => usePermanentTabs({ model, isDevMode: false, isEditorUser: false, tabs: model.state.tabs }));
    const patch = setState.mock.calls[0]![0];
    expect(patch.activeTabId).toBeUndefined(); // not in the patch — left alone
  });
});
