import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import { InteractiveLearningBanner, clearBannerImpressionCache } from './InteractiveLearningBanner';
import { testIds } from '../../constants/testIds';
import { StorageKeys } from '../../lib/storage-keys';
import { UserInteraction } from '../../lib/analytics';

const mockEnroll = jest.fn();
jest.mock('../../utils/experiments/interactive-learning-banner', () => ({
  enrollInteractiveLearningBannerExperiment: () => mockEnroll(),
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
    mockEnroll.mockReturnValue({ variant: 'treatment' });
  });

  // 'excluded' is the default arm, so the first case is what every stack with no
  // MTFF value renders. The last is not a real arm: the gate is an allow-list on
  // 'treatment', so a future arm or a malformed payload shows nothing rather than
  // defaulting a user into the banner.
  it.each(['excluded', 'control', 'rollout'])('renders nothing for the %s arm', (variant) => {
    mockEnroll.mockReturnValue({ variant });
    render(<InteractiveLearningBanner />);

    expect(screen.queryByTestId(testIds.contextPanel.interactiveLearningBanner)).not.toBeInTheDocument();
    expect(mockReportAppInteraction).not.toHaveBeenCalled();
  });

  it('renders the banner and reports an impression for the treatment arm', () => {
    render(<InteractiveLearningBanner />);

    expect(screen.getByTestId(testIds.contextPanel.interactiveLearningBanner)).toBeInTheDocument();
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

  it('degrades to a visible banner when localStorage is unavailable', () => {
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });

    render(<InteractiveLearningBanner />);
    expect(screen.getByTestId(testIds.contextPanel.interactiveLearningBanner)).toBeInTheDocument();

    getItem.mockRestore();
  });
});
