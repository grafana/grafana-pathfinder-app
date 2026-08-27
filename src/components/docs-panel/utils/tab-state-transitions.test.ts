import type { LearningJourneyTab } from '../../../types/content-panel.types';
import { closeTabState, pruneGatedTabState, type TabStateSnapshot } from './tab-state-transitions';

function tab(id: string, type: LearningJourneyTab['type'] = 'docs'): LearningJourneyTab {
  return {
    id,
    type,
    title: id,
    baseUrl: '',
    currentUrl: '',
    content: null,
    isLoading: false,
    error: null,
  };
}

const recommendations = tab('recommendations', 'recommendations');
const devTools = tab('devtools', 'devtools');
const editor = tab('editor', 'editor');

describe('closeTabState', () => {
  it.each([
    {
      name: 'selects the right strip neighbor',
      state: {
        tabs: [recommendations, tab('guide-1'), devTools, editor],
        activeTabId: 'guide-1',
      },
      closed: 'guide-1',
      expectedTabs: ['recommendations', 'devtools', 'editor'],
      expectedActive: 'devtools',
    },
    {
      name: 'selects the left strip neighbor when the last guide closes',
      state: {
        tabs: [recommendations, devTools, tab('guide-1')],
        activeTabId: 'guide-1',
      },
      closed: 'guide-1',
      expectedTabs: ['recommendations', 'devtools'],
      expectedActive: 'devtools',
    },
    {
      name: 'falls back to recommendations when the strip becomes empty',
      state: {
        tabs: [recommendations, tab('guide-1')],
        activeTabId: 'guide-1',
      },
      closed: 'guide-1',
      expectedTabs: ['recommendations'],
      expectedActive: 'recommendations',
    },
    {
      name: 'preserves focus when a background tab closes',
      state: {
        tabs: [recommendations, devTools, tab('guide-1')],
        activeTabId: 'devtools',
      },
      closed: 'guide-1',
      expectedTabs: ['recommendations', 'devtools'],
      expectedActive: 'devtools',
    },
    {
      name: 'selects the previous guide when the active final strip tab closes',
      state: {
        tabs: [recommendations, tab('guide-1'), tab('guide-2'), devTools],
        activeTabId: 'devtools',
      },
      closed: 'devtools',
      expectedTabs: ['recommendations', 'guide-1', 'guide-2'],
      expectedActive: 'guide-2',
    },
  ])('$name', ({ state, closed, expectedTabs, expectedActive }) => {
    const result = closeTabState(state, closed);

    expect(result.changed).toBe(true);
    expect(result.tabs.map((item) => item.id)).toEqual(expectedTabs);
    expect(result.activeTabId).toBe(expectedActive);
  });

  it.each([
    { name: 'missing tab', state: { tabs: [recommendations, tab('guide-1')], activeTabId: 'guide-1' }, id: 'missing' },
    {
      name: 'recommendations-kind tab',
      state: { tabs: [tab('custom-home', 'recommendations'), tab('guide-1')], activeTabId: 'guide-1' },
      id: 'custom-home',
    },
  ])('preserves references for a $name no-op', ({ state, id }) => {
    const result = closeTabState(state, id);

    expect(result).toEqual({ ...state, changed: false });
    expect(result.tabs).toBe(state.tabs);
  });

  it('does not mutate the input array or tab objects', () => {
    const guide = tab('guide-1');
    const state: TabStateSnapshot = { tabs: [recommendations, guide, devTools], activeTabId: 'guide-1' };
    const originalTabs = [...state.tabs];

    const result = closeTabState(state, guide.id);

    expect(state.tabs).toEqual(originalTabs);
    expect(state.tabs[1]).toBe(guide);
    expect(result.tabs[1]).toBe(devTools);
  });
});

describe('pruneGatedTabState', () => {
  it('preserves references when both gated kinds are allowed', () => {
    const state = { tabs: [recommendations, editor, devTools, tab('guide-1')], activeTabId: 'editor' };

    const result = pruneGatedTabState(state, { allowEditor: true, allowDevTools: true });

    expect(result).toEqual({ ...state, changed: false });
    expect(result.tabs).toBe(state.tabs);
  });

  it.each([
    {
      name: 'editor only',
      gates: { allowEditor: false, allowDevTools: true },
      expected: ['recommendations', 'devtools', 'guide-1'],
    },
    {
      name: 'Dev Tools only',
      gates: { allowEditor: true, allowDevTools: false },
      expected: ['recommendations', 'editor', 'guide-1'],
    },
    {
      name: 'both gated kinds',
      gates: { allowEditor: false, allowDevTools: false },
      expected: ['recommendations', 'guide-1'],
    },
  ])('removes $name while preserving other order', ({ gates, expected }) => {
    const state = {
      tabs: [recommendations, editor, devTools, tab('guide-1')],
      activeTabId: 'guide-1',
    };

    const result = pruneGatedTabState(state, gates);

    expect(result.changed).toBe(true);
    expect(result.tabs.map((item) => item.id)).toEqual(expected);
    expect(result.activeTabId).toBe('guide-1');
  });

  it.each([
    { activeTabId: 'editor', expected: 'recommendations' },
    { activeTabId: 'devtools', expected: 'recommendations' },
    { activeTabId: 'guide-1', expected: 'guide-1' },
  ])('uses $expected when pruning with active tab $activeTabId', ({ activeTabId, expected }) => {
    const state = {
      tabs: [
        recommendations,
        tab('guide-1', 'learning-journey'),
        tab('interactive-1', 'interactive'),
        editor,
        devTools,
      ],
      activeTabId,
    };

    const result = pruneGatedTabState(state, { allowEditor: false, allowDevTools: false });

    expect(result.activeTabId).toBe(expected);
    expect(result.tabs.map((item) => item.id)).toEqual(['recommendations', 'guide-1', 'interactive-1']);
  });

  it('does not mutate the input array or tabs', () => {
    const guide = tab('guide-1');
    const state = { tabs: [recommendations, editor, guide, devTools], activeTabId: guide.id };
    const originalTabs = [...state.tabs];

    const result = pruneGatedTabState(state, { allowEditor: false, allowDevTools: false });

    expect(state.tabs).toEqual(originalTabs);
    expect(state.tabs[2]).toBe(guide);
    expect(result.tabs[1]).toBe(guide);
  });
});
