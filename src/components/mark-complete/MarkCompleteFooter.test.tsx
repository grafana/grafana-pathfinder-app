import React from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';

import { testIds } from '../../constants/testIds';
import { UserInteraction } from '../../lib/analytics';
import { StorageEvents } from '../../lib/event-names';
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
  sanitizeContentKey: (value: string) => value,
}));

jest.mock('../../global-state/completion-store', () => ({
  isPreviewContentKey: () => false,
  getGuideProgress: () => ({ completed: 1, total: 4, percentage: 25 }),
  subscribeProgress: () => () => undefined,
}));

beforeEach(() => {
  jest.clearAllMocks();
  markStorage.get.mockResolvedValue(null);
  markStorage.set.mockResolvedValue(undefined);
});

/** The control is clickable only once the stored mark has been read. */
async function clickWhenReady(): Promise<void> {
  const button = await screen.findByTestId(testIds.markComplete.button);
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}

describe('MarkCompleteFooter', () => {
  it('records exactly one completion and one analytics event per click', async () => {
    const onMarkComplete = jest.fn();
    render(<MarkCompleteFooter context="guide" onMarkComplete={onMarkComplete} />);

    await clickWhenReady();

    expect(onMarkComplete).toHaveBeenCalledTimes(1);
    expect(reportAppInteraction).toHaveBeenCalledTimes(1);
    expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.MarkCompleteClicked, {
      interaction_location: 'content_footer',
      completion_context: 'guide',
      completion_percentage_before: 25,
    });
    await waitFor(() => expect(markStorage.set).toHaveBeenCalledWith('guide-key', true));
  });

  it('fires nothing on render or re-render', async () => {
    const onMarkComplete = jest.fn();
    const { rerender } = render(<MarkCompleteFooter context="guide" onMarkComplete={onMarkComplete} />);
    rerender(<MarkCompleteFooter context="guide" onMarkComplete={onMarkComplete} />);
    await waitFor(() => expect(screen.getByTestId(testIds.markComplete.button)).toBeEnabled());

    expect(onMarkComplete).not.toHaveBeenCalled();
    expect(reportAppInteraction).not.toHaveBeenCalled();
  });

  it('refuses the click until the stored mark has been read', async () => {
    let resolveRead: (value: true | null) => void = () => undefined;
    markStorage.get.mockReturnValue(
      new Promise<true | null>((resolve) => {
        resolveRead = resolve;
      })
    );
    const onMarkComplete = jest.fn();
    render(<MarkCompleteFooter context="guide" onMarkComplete={onMarkComplete} />);

    // The control stays visible throughout — an intermittently absent control
    // is the interpretability problem the model exists to prevent.
    const button = await screen.findByTestId(testIds.markComplete.button);
    fireEvent.click(button);
    expect(onMarkComplete).not.toHaveBeenCalled();
    expect(reportAppInteraction).not.toHaveBeenCalled();

    await act(async () => {
      resolveRead(null);
    });
    fireEvent.click(button);
    expect(onMarkComplete).toHaveBeenCalledTimes(1);
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

    await clickWhenReady();

    expect(setCompletionPercentage).toHaveBeenCalledWith('guide-key', 100);
    expect(dispatchProgress).toHaveBeenCalledWith({
      kind: 'guide',
      contentKey: 'guide-key',
      percentage: 100,
      hasProgress: true,
    });
    expect(screen.getByTestId(testIds.markComplete.percentage)).toHaveTextContent('100% complete');
  });

  it('announces the new state and keeps focus, rather than dropping it to the body', async () => {
    render(<MarkCompleteFooter context="guide" onMarkComplete={jest.fn()} />);

    await clickWhenReady();

    const completed = screen.getByTestId(testIds.markComplete.completed);
    expect(completed).toHaveAttribute('role', 'status');
    expect(completed).toHaveTextContent('Completed');
    expect(completed).toHaveFocus();
    // The percentage is a live region of its own, so the reader hears the new
    // number without the footer carrying it twice.
    expect(screen.getByTestId(testIds.markComplete.percentage)).toHaveAttribute('role', 'status');
    expect(screen.getAllByText(/100% complete/)).toHaveLength(1);
  });

  it('does not steal focus when a return visit hydrates an existing mark', async () => {
    markStorage.get.mockResolvedValue(true);
    render(<MarkCompleteFooter context="guide" onMarkComplete={jest.fn()} />);

    const completed = await screen.findByTestId(testIds.markComplete.completed);

    expect(completed).not.toHaveFocus();
  });

  it.each([
    ['every guide', '*'],
    ['this guide', 'guide-key'],
  ])('comes back clickable when a reset clears the mark for %s underneath it', async (_label, clearedKey) => {
    markStorage.get.mockResolvedValue(true);
    render(<MarkCompleteFooter context="guide" onMarkComplete={jest.fn()} />);
    await waitFor(() => expect(screen.queryByTestId(testIds.markComplete.button)).not.toBeInTheDocument());

    markStorage.get.mockResolvedValue(null);
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(StorageEvents.InteractiveProgressCleared, { detail: { contentKey: clearedKey } })
      );
    });

    await waitFor(() => expect(screen.getByTestId(testIds.markComplete.button)).toBeEnabled());
    expect(screen.getByTestId(testIds.markComplete.percentage)).toHaveTextContent('25% complete');
  });

  it('ignores a reset that clears some other guide', async () => {
    markStorage.get.mockResolvedValue(true);
    render(<MarkCompleteFooter context="guide" onMarkComplete={jest.fn()} />);
    await waitFor(() => expect(screen.queryByTestId(testIds.markComplete.button)).not.toBeInTheDocument());

    markStorage.get.mockResolvedValue(null);
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(StorageEvents.InteractiveProgressCleared, { detail: { contentKey: 'other-guide-key' } })
      );
    });

    expect(screen.queryByTestId(testIds.markComplete.button)).not.toBeInTheDocument();
  });

  it('completes and continues on a milestone', async () => {
    jest.useFakeTimers();
    const onContinue = jest.fn();
    const onMarkComplete = jest.fn();
    render(<MarkCompleteFooter context="milestone" onMarkComplete={onMarkComplete} onContinue={onContinue} />);
    // Settles the stored-mark read; promises are not faked.
    await act(async () => {});

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
