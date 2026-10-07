import React from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';

import { testIds } from '../../constants/testIds';
import { UserInteraction } from '../../lib/analytics';
import { StorageEvents } from '../../lib/event-names';
import { computeGuideBlockIndex } from '../../lib/guide-stats';
import { evictAllGuideIndexes, publishGuideIndex } from '../../global-state/active-guide-index';
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

let ambientKey = 'guide-key';
jest.mock('../../global-state/content-key', () => ({
  getContentKey: () => ambientKey,
  sanitizeContentKey: (value: string) => value,
}));

let percentage = 25;
let notifyProgress: (() => void) | undefined;
/** Every content key the footer has asked the store about, in order. */
const progressKeys: string[] = [];
const subscribedKeys: string[] = [];
jest.mock('../../global-state/completion-store', () => ({
  ...jest.requireActual('../../global-state/completion-store'),
  peekGuidePercentage: (contentKey: string) => {
    progressKeys.push(contentKey);
    return percentage;
  },
  subscribeProgress: (contentKey: string, listener: () => void) => {
    subscribedKeys.push(contentKey);
    notifyProgress = listener;
    return () => {
      notifyProgress = undefined;
    };
  },
}));

/**
 * Publishes the content key from a layout effect, as both production producers
 * do — so the key is ambient only *after* the footer beneath it has rendered.
 */
function Milestone({ url, onMarkComplete }: { url: string; onMarkComplete?: () => void }) {
  React.useLayoutEffect(() => {
    ambientKey = url;
  }, [url]);
  return <MarkCompleteFooter context="milestone" contentUrl={url} onMarkComplete={onMarkComplete} />;
}

/** Every live region the footer currently exposes. */
function liveRegions(): Element[] {
  return Array.from(screen.getByTestId(testIds.markComplete.footer).querySelectorAll('[role="status"], [aria-live]'));
}

beforeEach(() => {
  jest.clearAllMocks();
  percentage = 25;
  notifyProgress = undefined;
  ambientKey = 'guide-key';
  progressKeys.length = 0;
  subscribedKeys.length = 0;
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
      block_progress_rule_version: 'block-position-v1',
    });
    await waitFor(() => expect(markStorage.set).toHaveBeenCalledWith('guide-key', true));
  });

  it("carries the reader's position in the path on a milestone", async () => {
    render(
      <MarkCompleteFooter context="milestone" currentMilestone={2} totalMilestones={5} onMarkComplete={jest.fn()} />
    );

    await clickWhenReady();

    expect(reportAppInteraction).toHaveBeenCalledWith(
      UserInteraction.MarkCompleteClicked,
      expect.objectContaining({ current_milestone: 2, total_milestones: 5 })
    );
  });

  it('sends no milestone position for a standalone guide', async () => {
    render(<MarkCompleteFooter context="guide" currentMilestone={2} totalMilestones={5} />);

    await clickWhenReady();

    const properties = jest.mocked(reportAppInteraction).mock.calls[0]![1];
    expect(properties).not.toHaveProperty('current_milestone');
    expect(properties).not.toHaveProperty('total_milestones');
  });

  describe('block counts', () => {
    const index = computeGuideBlockIndex([
      { type: 'markdown' },
      { type: 'section', id: 'setup', blocks: [{ type: 'interactive' }, { type: 'markdown' }] },
    ]);

    afterEach(() => {
      evictAllGuideIndexes();
    });

    it("carries the guide's counts when its frozen index has published", async () => {
      publishGuideIndex({ contentKey: 'guide-key', index, denominatorSource: 'live-pre-inlining' });
      render(<MarkCompleteFooter context="guide" />);

      await clickWhenReady();

      expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.MarkCompleteClicked, {
        interaction_location: 'content_footer',
        completion_context: 'guide',
        completion_percentage_before: 25,
        block_progress_rule_version: 'block-position-v1',
        guide_stats_version: 1,
        total_block_count: 3,
        completable_block_count: 1,
        section_count: 1,
      });
    });

    it('omits the counts when only another guide has an index', async () => {
      publishGuideIndex({ contentKey: 'other-guide-key', index, denominatorSource: 'live-pre-inlining' });
      render(<MarkCompleteFooter context="guide" />);

      await clickWhenReady();

      expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.MarkCompleteClicked, {
        interaction_location: 'content_footer',
        completion_context: 'guide',
        completion_percentage_before: 25,
        block_progress_rule_version: 'block-position-v1',
      });
    });
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
  });

  it('announces reaching complete exactly once, and keeps focus rather than dropping it to the body', async () => {
    render(<MarkCompleteFooter context="guide" onMarkComplete={jest.fn()} />);

    await clickWhenReady();

    const completed = screen.getByTestId(testIds.markComplete.completed);
    expect(liveRegions()).toEqual([completed]);
    expect(completed).toHaveTextContent('Completed');
    expect(completed).toHaveFocus();
  });

  it('announces nothing while unmarked, however often the percentage moves', async () => {
    render(<MarkCompleteFooter context="guide" onMarkComplete={jest.fn()} />);
    await waitFor(() => expect(screen.getByTestId(testIds.markComplete.button)).toBeEnabled());
    expect(liveRegions()).toEqual([]);

    percentage = 50;
    act(() => {
      notifyProgress?.();
    });

    expect(liveRegions()).toEqual([]);
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

  it('records, persists and reports nothing from a block-editor preview', async () => {
    const onMarkComplete = jest.fn();
    render(
      <MarkCompleteFooter context="guide" contentUrl="block-editor://preview/demo" onMarkComplete={onMarkComplete} />
    );

    await clickWhenReady();

    expect(onMarkComplete).not.toHaveBeenCalled();
    expect(reportAppInteraction).not.toHaveBeenCalled();
    expect(markStorage.set).not.toHaveBeenCalled();
    expect(setCompletionPercentage).not.toHaveBeenCalled();
    expect(dispatchProgress).not.toHaveBeenCalled();
  });

  it("never asks about the previous milestone's key when the guide changes", async () => {
    const { rerender } = render(<Milestone url="milestone-1" />);
    await waitFor(() => expect(screen.getByTestId(testIds.markComplete.button)).toBeEnabled());
    progressKeys.length = 0;
    subscribedKeys.length = 0;

    await act(async () => {
      rerender(<Milestone url="milestone-2" />);
    });

    // Resolving the key during render would latch `milestone-1`, and since the
    // reader has just marked it, paint "100% complete" on the fresh milestone.
    expect(progressKeys).not.toContain('milestone-1');
    expect(subscribedKeys).not.toContain('milestone-1');
    expect(progressKeys).toContain('milestone-2');
  });

  it('stops offering the button when another tab marks the same guide', async () => {
    render(<MarkCompleteFooter context="guide" onMarkComplete={jest.fn()} />);
    await waitFor(() => expect(screen.getByTestId(testIds.markComplete.button)).toBeEnabled());

    // The cross-tab storage listener notifies this key; a marked guide must
    // never present a clickable button, because the click mints a second
    // durable completion record.
    markStorage.get.mockResolvedValue(true);
    percentage = 100;
    await act(async () => {
      notifyProgress?.();
    });

    expect(screen.queryByTestId(testIds.markComplete.button)).not.toBeInTheDocument();
    expect(screen.getByTestId(testIds.markComplete.completed)).toBeInTheDocument();
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
    expect(getComputedStyle(screen.getByTestId(testIds.markComplete.completed)).animation).not.toBe('');

    act(() => {
      jest.runOnlyPendingTimers();
    });
    expect(onContinue).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('skips the celebration dwell for a reader who asked for reduced motion', async () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      ...originalMatchMedia(query),
      matches: query.includes('prefers-reduced-motion'),
    })) as typeof window.matchMedia;
    jest.useFakeTimers();
    const onContinue = jest.fn();
    const onMarkComplete = jest.fn();
    try {
      render(<MarkCompleteFooter context="milestone" onMarkComplete={onMarkComplete} onContinue={onContinue} />);
      // Settles the stored-mark read; promises are not faked.
      await act(async () => {});

      fireEvent.click(screen.getByTestId(testIds.markComplete.button));

      // No dwell: continuing happens on the click itself, not after a timer.
      expect(onMarkComplete).toHaveBeenCalledTimes(1);
      expect(onContinue).toHaveBeenCalledTimes(1);
      // And nothing animates on arrival either.
      expect(getComputedStyle(screen.getByTestId(testIds.markComplete.completed)).animation).toBe('');
    } finally {
      jest.useRealTimers();
      window.matchMedia = originalMatchMedia;
    }
  });
});
