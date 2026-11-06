import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { locationService } from '@grafana/runtime';
import { testIds } from '../../constants/testIds';
import { ROUTES } from '../../constants';
import { prefixRoute } from '../../utils/utils.routing';
import type { EarnedBadge } from '../../types';
import { BadgesPanel } from './BadgesPanel';

const mockBadge: EarnedBadge = {
  id: 'first-steps',
  title: 'First steps',
  description: 'Complete your first guide',
  icon: 'rocket',
  trigger: { type: 'guide-completed' },
  earnedAt: Date.UTC(2026, 9, 30),
};
let mockLoading = false;

jest.mock('@grafana/scenes', () => ({ SceneObjectBase: class {} }));
jest.mock('@grafana/runtime', () => ({
  locationService: { push: jest.fn() },
  config: { bootData: { user: {} } },
}));
jest.mock('../../learning-paths', () => ({
  BADGES: jest.requireActual('../../learning-paths/badges').BADGES,
  getPathsData: () => ({ paths: [], guideMetadata: {} }),
  useLearningPaths: () => ({
    badgesWithStatus: [mockBadge],
    progress: { completedGuides: ['guide-1'], streakDays: 0 },
    paths: [],
    isLoading: mockLoading,
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockLoading = false;
});

it('opens and closes badge details from the gallery and navigates back to Home', () => {
  const Page = BadgesPanel.Component;
  render(<Page />);
  expect(screen.getByRole('heading', { name: 'Your badges', level: 1 })).toBeInTheDocument();

  fireEvent.click(screen.getByTestId(testIds.learningPaths.badgeItem(mockBadge.id)));
  const modal = screen.getByTestId(testIds.learningPaths.badgesModal);
  expect(within(modal).getByRole('heading', { name: mockBadge.title })).toBeInTheDocument();
  expect(within(modal).getByText('✨ Unlocked')).toBeInTheDocument();

  fireEvent.click(within(modal).getByTestId(testIds.learningPaths.badgesModalClose));
  expect(screen.queryByTestId(testIds.learningPaths.badgesModal)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(locationService.push).toHaveBeenCalledWith(prefixRoute(ROUTES.Home));
});

it('waits for badge loading to finish before rendering the gallery', () => {
  mockLoading = true;
  const Page = BadgesPanel.Component;
  const { rerender } = render(<Page />);
  expect(screen.queryByTestId(testIds.learningPaths.badgesSection)).not.toBeInTheDocument();

  mockLoading = false;
  rerender(<Page />);
  expect(screen.getByTestId(testIds.learningPaths.badgeItem(mockBadge.id))).toBeInTheDocument();
});

it('preserves badge-page scroll when opening the sidebar moves scrolling onto main', () => {
  const resizeCallbacks: ResizeObserverCallback[] = [];
  const originalObserver = global.ResizeObserver;
  global.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) {
      resizeCallbacks.push(callback);
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
    act(() => {
      for (const resize of resizeCallbacks) {
        resize([], {} as ResizeObserver);
      }
    });
    expect(host.scrollTop).toBe(514);
  } finally {
    unmount();
    host.remove();
    document.documentElement.scrollTop = 0;
    global.ResizeObserver = originalObserver;
  }
});
