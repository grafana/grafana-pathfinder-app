import React from 'react';
import { render, screen, act } from '@testing-library/react';

import { SegmentedGuideProgressBar } from './SegmentedGuideProgressBar';

// Mock @grafana/ui
jest.mock('@grafana/ui', () => ({
  useStyles2: (fn: any) =>
    fn({
      colors: {
        background: { canvas: '#fff', secondary: '#eee' },
        border: { weak: '#ddd' },
        success: { main: '#52c41a' },
      },
      spacing: (n: number) => `${n * 8}px`,
    }),
}));

// Mock getGuideIndex
const mockGetGuideIndex = jest.fn();
jest.mock('../../global-state/active-guide-index', () => ({
  getGuideIndex: (_contentKey: string) => mockGetGuideIndex(_contentKey),
}));

// Mock subscribeProgress and peekGuidePercentage
let mockPercentage = 0;
let progressListener: (() => void) | undefined;
const mockSubscribeProgress = jest.fn((_contentKey: string, listener: () => void) => {
  progressListener = listener;
  return () => {
    progressListener = undefined;
  };
});
const mockPeekGuidePercentage = jest.fn((_contentKey: string) => mockPercentage);

jest.mock('../../global-state/completion-store', () => ({
  subscribeProgress: (_contentKey: string, listener: () => void) => mockSubscribeProgress(_contentKey, listener),
  peekGuidePercentage: (_contentKey: string) => mockPeekGuidePercentage(_contentKey),
}));

describe('SegmentedGuideProgressBar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPercentage = 0;
    progressListener = undefined;
    mockGetGuideIndex.mockReturnValue({
      index: {
        totalBlockCount: 5,
        positionsByStepId: new Map(),
      },
    });
  });

  it('returns null when guide index is not available', () => {
    mockGetGuideIndex.mockReturnValue(undefined);

    const { container } = render(<SegmentedGuideProgressBar contentKey="test-guide" />);

    expect(container.firstChild).toBeNull();
  });

  it('returns null when totalBlockCount is 0', () => {
    mockGetGuideIndex.mockReturnValue({
      index: {
        totalBlockCount: 0,
        positionsByStepId: new Map(),
      },
    });

    const { container } = render(<SegmentedGuideProgressBar contentKey="test-guide" />);

    expect(container.firstChild).toBeNull();
  });

  it('renders correct number of segments for totalBlockCount = 5', () => {
    mockGetGuideIndex.mockReturnValue({
      index: {
        totalBlockCount: 5,
        positionsByStepId: new Map(),
      },
    });
    mockPercentage = 0;

    const { container } = render(<SegmentedGuideProgressBar contentKey="test-guide" />);

    const segments = container.querySelectorAll('[data-segment-state]');
    expect(segments).toHaveLength(5);
  });

  it('all segments have "upcoming" state when percentage is 0', () => {
    mockGetGuideIndex.mockReturnValue({
      index: {
        totalBlockCount: 5,
        positionsByStepId: new Map(),
      },
    });
    mockPercentage = 0;

    const { container } = render(<SegmentedGuideProgressBar contentKey="test-guide" />);

    const upcomingSegments = container.querySelectorAll('[data-segment-state="upcoming"]');
    const doneSegments = container.querySelectorAll('[data-segment-state="done"]');

    expect(upcomingSegments).toHaveLength(5);
    expect(doneSegments).toHaveLength(0);
  });

  it('correct segments are "done" when percentage is 40 and totalBlockCount = 10 (should be 4 done)', () => {
    mockGetGuideIndex.mockReturnValue({
      index: {
        totalBlockCount: 10,
        positionsByStepId: new Map(),
      },
    });
    mockPercentage = 40;

    const { container } = render(<SegmentedGuideProgressBar contentKey="test-guide" />);

    const doneSegments = container.querySelectorAll('[data-segment-state="done"]');
    const upcomingSegments = container.querySelectorAll('[data-segment-state="upcoming"]');

    expect(doneSegments).toHaveLength(4);
    expect(upcomingSegments).toHaveLength(6);
  });

  it('all segments have "done" state when percentage is 100', () => {
    mockGetGuideIndex.mockReturnValue({
      index: {
        totalBlockCount: 5,
        positionsByStepId: new Map(),
      },
    });
    mockPercentage = 100;

    const { container } = render(<SegmentedGuideProgressBar contentKey="test-guide" />);

    const doneSegments = container.querySelectorAll('[data-segment-state="done"]');
    const upcomingSegments = container.querySelectorAll('[data-segment-state="upcoming"]');

    expect(doneSegments).toHaveLength(5);
    expect(upcomingSegments).toHaveLength(0);
  });

  it('has proper accessibility attributes: role="progressbar", aria-valuenow, aria-valuemax, aria-label', () => {
    mockGetGuideIndex.mockReturnValue({
      index: {
        totalBlockCount: 10,
        positionsByStepId: new Map(),
      },
    });
    mockPercentage = 40;

    render(<SegmentedGuideProgressBar contentKey="test-guide" />);

    const progressBar = screen.getByRole('progressbar');

    expect(progressBar).toHaveAttribute('aria-valuenow', '4');
    expect(progressBar).toHaveAttribute('aria-valuemax', '10');
    expect(progressBar).toHaveAttribute('aria-label', 'Guide progress: 4 of 10 steps completed');
  });

  it('updates segments when percentage changes and progress listener is notified', () => {
    mockGetGuideIndex.mockReturnValue({
      index: {
        totalBlockCount: 10,
        positionsByStepId: new Map(),
      },
    });
    mockPercentage = 20;

    const { container } = render(<SegmentedGuideProgressBar contentKey="test-guide" />);

    // Initially 2 segments should be done (20% of 10)
    expect(container.querySelectorAll('[data-segment-state="done"]')).toHaveLength(2);

    // Update percentage and notify listener
    mockPercentage = 50;
    act(() => {
      progressListener?.();
    });

    // Now 5 segments should be done (50% of 10)
    expect(container.querySelectorAll('[data-segment-state="done"]')).toHaveLength(5);
  });

  it('subscribes to progress changes with the correct content key', () => {
    render(<SegmentedGuideProgressBar contentKey="my-test-guide" />);

    expect(mockSubscribeProgress).toHaveBeenCalledWith('my-test-guide', expect.any(Function));
  });

  it('peeks at the correct content key for initial percentage', () => {
    render(<SegmentedGuideProgressBar contentKey="my-test-guide" />);

    expect(mockPeekGuidePercentage).toHaveBeenCalledWith('my-test-guide');
  });

  it('handles edge case of percentage 50 with odd totalBlockCount (e.g. 5 blocks, 50% = 2.5 rounds to 2 or 3)', () => {
    mockGetGuideIndex.mockReturnValue({
      index: {
        totalBlockCount: 5,
        positionsByStepId: new Map(),
      },
    });
    mockPercentage = 50;

    const { container } = render(<SegmentedGuideProgressBar contentKey="test-guide" />);

    const doneSegments = container.querySelectorAll('[data-segment-state="done"]');

    // 50% of 5 = 2.5, which should round to 3 with Math.round
    expect(doneSegments).toHaveLength(3);
  });

  it('correctly handles percentage that equals 100 (all segments done)', () => {
    mockGetGuideIndex.mockReturnValue({
      index: {
        totalBlockCount: 7,
        positionsByStepId: new Map(),
      },
    });
    mockPercentage = 100;

    const { container } = render(<SegmentedGuideProgressBar contentKey="test-guide" />);

    const doneSegments = container.querySelectorAll('[data-segment-state="done"]');

    // At 100%, all 7 segments should be done
    expect(doneSegments).toHaveLength(7);
  });
});
