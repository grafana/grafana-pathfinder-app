import type { LearningJourneyTab } from '../types/content-panel.types';
import {
  canOpenCompanionGuide,
  closeCompanionGuide,
  getCompanionGuide,
  openCompanionGuide,
  subscribeCompanionGuide,
} from './companion-guide';

const guide: LearningJourneyTab = {
  id: 'authoring-guide',
  type: 'docs',
  title: 'Create an interactive guide',
  baseUrl: 'bundled:authoring-guide',
  currentUrl: 'bundled:authoring-guide',
  isLoading: false,
  error: null,
  content: {
    content: '{"id":"authoring-guide","title":"Create a guide","blocks":[]}',
    type: 'single-doc',
    url: 'bundled:authoring-guide',
    metadata: { title: 'Create a guide' },
    lastFetched: '2026-11-24T00:00:00Z',
  },
};

beforeEach(() => {
  closeCompanionGuide();
  localStorage.clear();
});

it('opens a separate in-memory snapshot without changing surface preferences or tabs', () => {
  localStorage.setItem('existing-workspace', 'editor');
  const listener = jest.fn();
  const unsubscribe = subscribeCompanionGuide(listener);
  openCompanionGuide(guide);
  expect(getCompanionGuide()).toEqual(guide);
  expect(getCompanionGuide()).not.toBe(guide);
  expect(listener).toHaveBeenCalledTimes(1);
  closeCompanionGuide();
  expect(getCompanionGuide()).toBeNull();
  expect(listener).toHaveBeenCalledTimes(2);
  expect(localStorage.length).toBe(1);
  expect(localStorage.getItem('existing-workspace')).toBe('editor');
  unsubscribe();
  openCompanionGuide(guide);
  expect(listener).toHaveBeenCalledTimes(2);
});

it.each([
  { ...guide, type: 'editor' as const },
  { ...guide, isLoading: true },
  { ...guide, error: 'Failed to load' },
  { ...guide, content: null },
])('does not open unloaded or non-reader content', (tab) => {
  expect(canOpenCompanionGuide(tab)).toBe(false);
  openCompanionGuide(tab);
  expect(getCompanionGuide()).toBeNull();
});
