import type { LearningJourneyTab } from '../../../types/content-panel.types';
import { closeTabState, type TabStateSnapshot } from './tab-state-transitions';

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
