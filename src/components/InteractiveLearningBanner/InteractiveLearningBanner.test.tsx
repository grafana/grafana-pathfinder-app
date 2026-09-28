import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

import { InteractiveLearningBanner, clearBannerImpressionCache } from './InteractiveLearningBanner';
import { testIds } from '../../constants/testIds';
import { StorageKeys } from '../../lib/storage-keys';
import { UserInteraction } from '../../lib/analytics';

// Stands in for the enroller's memo plus its subscription. The banner only ever
// reads this store — enrollment itself belongs to the sidebar seam, which
// enrollment-boundary.test.ts pins.
let enrolledArm: { variant: string } | null = null;
const subscribers = new Set<() => void>();
const resolveArm = (variant: string) => {
  enrolledArm = { variant };
  subscribers.forEach((onChange) => onChange());
};

jest.mock('../../utils/experiments/interactive-learning-banner', () => ({
  getEnrolledInteractiveLearningBannerConfig: () => enrolledArm,
}));
jest.mock('../../utils/experiments/enrollment-notifier', () => ({
  subscribeToEnrollment: (onChange: () => void) => {
    subscribers.add(onChange);
    return () => subscribers.delete(onChange);
  },
}));

const mockReportAppInteraction = jest.fn();
jest.mock('../../lib/analytics', () => ({
  ...jest.requireActual('../../lib/analytics'),
  reportAppInteraction: (...args: unknown[]) => mockReportAppInteraction(...args),
}));

const dismissalKey = `${StorageKeys.INTERACTIVE_LEARNING_BANNER_DISMISSED_PREFIX}${window.location.hostname}`;

describe('InteractiveLearningBanner', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    clearBannerImpressionCache();
    subscribers.clear();
    enrolledArm = { variant: 'treatment' };
  });

  // 'excluded' is the default arm, so the first case is what every stack with no
  // MTFF value renders. The last is not a real arm: the gate is an allow-list on
  // 'treatment', so a future arm or a malformed payload shows nothing rather than
  // defaulting a user into the banner.
  it.each(['excluded', 'control', 'rollout'])('renders nothing for the %s arm', (variant) => {
    enrolledArm = { variant };
    render(<InteractiveLearningBanner />);

    expect(screen.queryByTestId(testIds.contextPanel.interactiveLearningBanner)).not.toBeInTheDocument();
    expect(mockReportAppInteraction).not.toHaveBeenCalled();
  });

  it('renders the banner and reports an impression for the treatment arm', () => {
    render(<InteractiveLearningBanner />);

    expect(screen.getByTestId(testIds.contextPanel.interactiveLearningBanner)).toBeInTheDocument();
    // Unprefixed, and it must stay that way: this value is already in the stream.
    expect(mockReportAppInteraction).toHaveBeenCalledWith(UserInteraction.InteractiveLearningBannerShown, {
      interaction_location: 'interactive_learning_banner',
    });
  });

  it('reports one impression per page load, not per remount', () => {
    const first = render(<InteractiveLearningBanner />);
    first.unmount();
    render(<InteractiveLearningBanner />);

    const impressions = mockReportAppInteraction.mock.calls.filter(
      (call) => call[0] === UserInteraction.InteractiveLearningBannerShown
    );
    expect(impressions).toHaveLength(1);
  });

  it('stays hidden when it was dismissed on a previous page load', () => {
    localStorage.setItem(dismissalKey, 'true');
    render(<InteractiveLearningBanner />);

    expect(screen.queryByTestId(testIds.contextPanel.interactiveLearningBanner)).not.toBeInTheDocument();
  });

  it('persists the dismissal and reports it when the close control is used', () => {
    render(<InteractiveLearningBanner />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));

    expect(screen.queryByTestId(testIds.contextPanel.interactiveLearningBanner)).not.toBeInTheDocument();
    expect(localStorage.getItem(dismissalKey)).toBe('true');
    expect(mockReportAppInteraction).toHaveBeenCalledWith(UserInteraction.InteractiveLearningBannerDismissed, {
      interaction_location: 'interactive_learning_banner',
    });
  });

  it('stays hidden while no arm has been enrolled yet', () => {
    enrolledArm = null;
    render(<InteractiveLearningBanner />);

    expect(screen.queryByTestId(testIds.contextPanel.interactiveLearningBanner)).not.toBeInTheDocument();
    expect(mockReportAppInteraction).not.toHaveBeenCalled();
  });

  it('appears when the arm resolves after it has mounted', () => {
    // The sidebar seam's effect runs before this lazily-loaded panel renders, so in
    // practice the arm is already there. This is the guard for that order flipping:
    // the banner subscribes rather than enrolling itself, so a late arm still shows.
    enrolledArm = null;
    render(<InteractiveLearningBanner />);
    expect(screen.queryByTestId(testIds.contextPanel.interactiveLearningBanner)).not.toBeInTheDocument();

    act(() => resolveArm('treatment'));

    expect(screen.getByTestId(testIds.contextPanel.interactiveLearningBanner)).toBeInTheDocument();
    expect(mockReportAppInteraction).toHaveBeenCalledWith(UserInteraction.InteractiveLearningBannerShown, {
      interaction_location: 'interactive_learning_banner',
    });
  });

  it('tags the guide placement distinctly on both events', () => {
    render(<InteractiveLearningBanner placement="guide" />);

    expect(mockReportAppInteraction).toHaveBeenCalledWith(UserInteraction.InteractiveLearningBannerShown, {
      interaction_location: 'interactive_learning_banner_guide',
    });

    fireEvent.click(screen.getByRole('button', { name: /close/i }));

    expect(mockReportAppInteraction).toHaveBeenCalledWith(UserInteraction.InteractiveLearningBannerDismissed, {
      interaction_location: 'interactive_learning_banner_guide',
    });
  });

  it('dismissing above a guide also hides it on the context page', () => {
    // The requirement, and the reason it needs no cross-instance plumbing: one
    // localStorage key, and the two placements never mount at the same time — the
    // sidebar's content area is an if/else — so each mount just re-reads it.
    const guide = render(<InteractiveLearningBanner placement="guide" />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    guide.unmount();

    render(<InteractiveLearningBanner placement="context-page" />);

    expect(screen.queryByTestId(testIds.contextPanel.interactiveLearningBanner)).not.toBeInTheDocument();
  });

  it('dismissing on the context page also hides it above a guide', () => {
    const context = render(<InteractiveLearningBanner />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    context.unmount();

    render(<InteractiveLearningBanner placement="guide" />);

    expect(screen.queryByTestId(testIds.contextPanel.interactiveLearningBanner)).not.toBeInTheDocument();
  });

  it('degrades to a visible banner when localStorage is unavailable', () => {
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });

    render(<InteractiveLearningBanner />);
    expect(screen.getByTestId(testIds.contextPanel.interactiveLearningBanner)).toBeInTheDocument();

    getItem.mockRestore();
  });
});
