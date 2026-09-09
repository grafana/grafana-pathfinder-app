import React from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';

import { testIds } from '../../constants/testIds';
import { UserInteraction } from '../../lib/analytics';
import { MarkCompleteFooter } from './MarkCompleteFooter';

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string, vars?: Record<string, unknown>) =>
    vars ? fallback.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(vars[name])) : fallback,
}));

const reportAppInteraction = jest.fn();
jest.mock('../../lib/analytics', () => ({
  ...jest.requireActual('../../lib/analytics'),
  reportAppInteraction: (...args: unknown[]) => reportAppInteraction(...args),
}));

const markStorage = { get: jest.fn(), set: jest.fn(), clear: jest.fn() };
const setCompletionPercentage = jest.fn();
jest.mock('../../lib/user-storage', () => ({
  guideCompletionMarkStorage: {
    get: (...a: unknown[]) => markStorage.get(...a),
    set: (...a: unknown[]) => markStorage.set(...a),
    clear: (...a: unknown[]) => markStorage.clear(...a),
  },
  interactiveCompletionStorage: { set: (...a: unknown[]) => setCompletionPercentage(...a) },
}));

const dispatchProgress = jest.fn();
jest.mock('../../global-state/progress-events', () => ({
  dispatchProgress: (...a: unknown[]) => dispatchProgress(...a),
}));

jest.mock('../../global-state/content-key', () => ({
  getContentKey: () => 'guide-key',
}));

let previewKey = false;
jest.mock('../../global-state/completion-store', () => ({
  isPreviewContentKey: () => previewKey,
  getGuideProgress: () => ({ completed: 1, total: 4, percentage: 25 }),
  subscribeProgress: () => () => undefined,
}));

beforeEach(() => {
  jest.clearAllMocks();
  previewKey = false;
  markStorage.get.mockResolvedValue(null);
  markStorage.set.mockResolvedValue(undefined);
});

describe('MarkCompleteFooter', () => {
  it('records exactly one completion and one analytics event per click', async () => {
    const onMarkComplete = jest.fn();
    render(<MarkCompleteFooter context="guide" onMarkComplete={onMarkComplete} />);

    fireEvent.click(screen.getByTestId(testIds.markComplete.button));

    expect(onMarkComplete).toHaveBeenCalledTimes(1);
    expect(reportAppInteraction).toHaveBeenCalledTimes(1);
    expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.MarkCompleteClicked, {
      interaction_location: 'content_footer',
      completion_context: 'guide',
      completion_percentage_before: 25,
    });
    await waitFor(() => expect(markStorage.set).toHaveBeenCalledWith('guide-key', true));
  });

  it('fires nothing on render or re-render', () => {
    const onMarkComplete = jest.fn();
    const { rerender } = render(<MarkCompleteFooter context="guide" onMarkComplete={onMarkComplete} />);
    rerender(<MarkCompleteFooter context="guide" onMarkComplete={onMarkComplete} />);

    expect(onMarkComplete).not.toHaveBeenCalled();
    expect(reportAppInteraction).not.toHaveBeenCalled();
  });

  it('fires nothing on a return visit once the mark exists, and offers no button to click', async () => {
    markStorage.get.mockResolvedValue(true);
    const onMarkComplete = jest.fn();
    render(<MarkCompleteFooter context="guide" onMarkComplete={onMarkComplete} />);

    await waitFor(() => expect(screen.queryByTestId(testIds.markComplete.button)).not.toBeInTheDocument());
    expect(screen.getByTestId(testIds.markComplete.percentage)).toHaveTextContent('100% complete');
    expect(onMarkComplete).not.toHaveBeenCalled();
    expect(reportAppInteraction).not.toHaveBeenCalled();
  });

  it('drives the guide to 100% and announces it', async () => {
    render(<MarkCompleteFooter context="guide" onMarkComplete={jest.fn()} />);

    fireEvent.click(screen.getByTestId(testIds.markComplete.button));

    expect(setCompletionPercentage).toHaveBeenCalledWith('guide-key', 100);
    expect(dispatchProgress).toHaveBeenCalledWith({
      kind: 'guide',
      contentKey: 'guide-key',
      percentage: 100,
      hasProgress: true,
    });
    expect(screen.getByTestId(testIds.markComplete.percentage)).toHaveTextContent('100% complete');
  });

  it('persists nothing from a block-editor preview, but still completes the reading', async () => {
    previewKey = true;
    const onMarkComplete = jest.fn();
    render(<MarkCompleteFooter context="guide" onMarkComplete={onMarkComplete} />);

    fireEvent.click(screen.getByTestId(testIds.markComplete.button));

    expect(onMarkComplete).toHaveBeenCalledTimes(1);
    expect(markStorage.set).not.toHaveBeenCalled();
    expect(setCompletionPercentage).not.toHaveBeenCalled();
    expect(dispatchProgress).not.toHaveBeenCalled();
  });

  it('completes and continues on a milestone', async () => {
    jest.useFakeTimers();
    const onContinue = jest.fn();
    const onMarkComplete = jest.fn();
    render(<MarkCompleteFooter context="milestone" onMarkComplete={onMarkComplete} onContinue={onContinue} />);

    fireEvent.click(screen.getByTestId(testIds.markComplete.button));

    // The completion write does not wait on the celebration.
    expect(onMarkComplete).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled();

    act(() => {
      jest.runOnlyPendingTimers();
    });
    expect(onContinue).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});
