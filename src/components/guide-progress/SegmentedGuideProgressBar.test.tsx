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

/** Dispatch the shared step-progress signal the component subscribes to. */
function emitStepProgress(completedCount: number, totalSteps: number): void {
  act(() => {
    window.dispatchEvent(
      new CustomEvent('pathfinder-step-progress', {
        detail: { totalSteps, completedCount },
      })
    );
  });
}

function doneCount(container: HTMLElement): number {
  return container.querySelectorAll('[data-segment-state="done"]').length;
}
function upcomingCount(container: HTMLElement): number {
  return container.querySelectorAll('[data-segment-state="upcoming"]').length;
}

describe('SegmentedGuideProgressBar', () => {
  it('renders nothing before any progress signal has been observed', () => {
    const { container } = render(<SegmentedGuideProgressBar hasActiveGuide />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when there is no active guide', () => {
    const { container } = render(<SegmentedGuideProgressBar hasActiveGuide={false} />);
    emitStepProgress(2, 14);
    expect(container.firstChild).toBeNull();
  });

  it('renders one segment per user-facing step (not per content block)', () => {
    const { container } = render(<SegmentedGuideProgressBar hasActiveGuide />);
    emitStepProgress(0, 14);

    const segments = container.querySelectorAll('[data-segment-state]');
    expect(segments).toHaveLength(14);
  });

  it('lights exactly one segment when one of many steps is completed', () => {
    // This is the regression the bug report described: completing step 1 of 14
    // must light exactly 1 segment — not ~3 of 19 blocks.
    const { container } = render(<SegmentedGuideProgressBar hasActiveGuide />);
    emitStepProgress(1, 14);

    expect(doneCount(container)).toBe(1);
    expect(upcomingCount(container)).toBe(13);
  });

  it('all segments are upcoming when nothing is completed', () => {
    const { container } = render(<SegmentedGuideProgressBar hasActiveGuide />);
    emitStepProgress(0, 5);

    expect(doneCount(container)).toBe(0);
    expect(upcomingCount(container)).toBe(5);
  });

  it('all segments are done when every step is completed', () => {
    const { container } = render(<SegmentedGuideProgressBar hasActiveGuide />);
    emitStepProgress(7, 7);

    expect(doneCount(container)).toBe(7);
    expect(upcomingCount(container)).toBe(0);
  });

  it('clamps done to total if the signal reports more completed than exist', () => {
    const { container } = render(<SegmentedGuideProgressBar hasActiveGuide />);
    emitStepProgress(99, 5);

    expect(doneCount(container)).toBe(5);
    expect(upcomingCount(container)).toBe(0);
  });

  it('updates live as further steps are completed', () => {
    const { container } = render(<SegmentedGuideProgressBar hasActiveGuide />);

    emitStepProgress(2, 10);
    expect(doneCount(container)).toBe(2);

    emitStepProgress(5, 10);
    expect(doneCount(container)).toBe(5);
  });

  it('exposes accessible progressbar semantics in steps', () => {
    render(<SegmentedGuideProgressBar hasActiveGuide />);
    emitStepProgress(4, 10);

    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveAttribute('aria-valuenow', '4');
    expect(progressBar).toHaveAttribute('aria-valuemax', '10');
    expect(progressBar).toHaveAttribute('aria-label', 'Guide progress: 4 of 10 steps completed');
  });

  it('renders nothing when the guide reports zero steps', () => {
    const { container } = render(<SegmentedGuideProgressBar hasActiveGuide />);
    emitStepProgress(0, 0);
    expect(container.firstChild).toBeNull();
  });
});
