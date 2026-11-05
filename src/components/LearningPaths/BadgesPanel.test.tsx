import React from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { BadgesPanel } from './BadgesPanel';

jest.mock('@grafana/scenes', () => ({ SceneObjectBase: class {} }));
jest.mock('../../learning-paths', () => ({
  BADGES: [],
  useLearningPaths: () => ({
    badgesWithStatus: [],
    progress: { completedGuides: [], streakDays: 0 },
    paths: [],
    isLoading: false,
  }),
}));
jest.mock('./sections/BadgesSection', () => ({ BadgesSection: () => null }));
jest.mock('./BadgeDetailCard', () => ({ BadgeDetailCard: () => null }));
jest.mock('../SkeletonLoader', () => ({ SkeletonLoader: () => null }));

it('preserves badge-page scroll when opening the sidebar moves scrolling onto main', () => {
  let resize!: ResizeObserverCallback;
  const originalObserver = global.ResizeObserver;
  global.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) {
      resize = callback;
    }
    observe() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  const host = document.createElement('main');
  Object.defineProperties(host, {
    scrollHeight: { value: 2000 },
    clientHeight: { value: 600 },
  });
  host.style.overflowY = 'visible';
  document.body.appendChild(host);
  const Page = BadgesPanel.Component;
  const { unmount } = render(<Page />, { container: host });
  try {
    document.documentElement.scrollTop = 514;
    fireEvent.scroll(document);
    host.style.overflowY = 'auto';
    document.documentElement.scrollTop = 0;
    act(() => resize([], {} as ResizeObserver));
    expect(host.scrollTop).toBe(514);
  } finally {
    unmount();
    host.remove();
    document.documentElement.scrollTop = 0;
    global.ResizeObserver = originalObserver;
  }
});
