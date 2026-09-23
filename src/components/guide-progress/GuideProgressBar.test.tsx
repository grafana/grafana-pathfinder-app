import React from 'react';
import { render, screen, act } from '@testing-library/react';

import { GuideProgressBar } from './GuideProgressBar';

jest.mock('@grafana/ui', () => ({
  useStyles2: (fn: any) =>
    fn({
      colors: {
        background: { canvas: '#fff', secondary: '#eee' },
        border: { weak: '#ddd' },
        success: { main: '#52c41a' },
        text: { secondary: '#888' },
      },
      spacing: (...n: number[]) => n.map((x) => `${x * 8}px`).join(' '),
      shape: { radius: { pill: '9999px' } },
      typography: { bodySmall: { fontSize: '12px' } },
    }),
}));

jest.mock('@grafana/i18n', () => ({
  t: (_id: string, def: string, vars?: Record<string, unknown>) =>
    def.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars?.[k] ?? '')),
}));

// Resolve the content key straight through to the URL so the test controls it.
jest.mock('../../global-state/guide-content-key', () => ({
  resolveGuideContentKey: (url: string | undefined) => url ?? 'default',
}));

let mockPercentage = 0;
let progressListener: (() => void) | undefined;
jest.mock('../../global-state/completion-store', () => ({
  peekGuidePercentage: () => mockPercentage,
  subscribeProgress: (_key: string, listener: () => void) => {
    progressListener = listener;
    return () => {
      progressListener = undefined;
    };
  },
}));

function setPercentage(p: number) {
  act(() => {
    mockPercentage = p;
    progressListener?.();
  });
}

describe('GuideProgressBar', () => {
  beforeEach(() => {
    mockPercentage = 0;
    progressListener = undefined;
  });

  it('renders nothing when no contentUrl is provided', () => {
    const { container } = render(<GuideProgressBar contentUrl={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  /**
   * Regression test for PR #1973, Bug 1: progress bar subscribes to previous guide.
   *
   * Before the fix, GuideProgressBar resolved the content key during render,
   * but content-key producers publish in layout effects. This caused the bar
   * to latch the PREVIOUS milestone's key and show its percentage (including 100%)
   * after a reader advanced.
   *
   * The fix mirrors MarkCompleteFooter: resolve the key in a passive effect,
   * store it in state, then subscribe to the state-held key.
   */
  it('re-subscribes to the new guide when contentUrl changes (milestone navigation)', async () => {
    // Start with guide-a at 60%
    mockPercentage = 60;
    const { rerender } = render(<GuideProgressBar contentUrl="guide-a" />);

    // Wait for effect to resolve key
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText('60% complete')).toBeInTheDocument();

    // Navigate to guide-b (which is at 0%)
    mockPercentage = 0;
    rerender(<GuideProgressBar contentUrl="guide-b" />);

    // Wait for effect to resolve new key
    await act(async () => {
      await Promise.resolve();
    });

    // Bar should now show guide-b's percentage, not guide-a's
    expect(screen.getByText('0% complete')).toBeInTheDocument();

    // Advance guide-b to 100% (reader marks it complete)
    setPercentage(100);
    expect(screen.getByText('100% complete')).toBeInTheDocument();

    // Navigate to guide-c (which is at 25%)
    mockPercentage = 25;
    rerender(<GuideProgressBar contentUrl="guide-c" />);

    // Wait for effect to resolve new key
    await act(async () => {
      await Promise.resolve();
    });

    // Bar should show guide-c's percentage, NOT guide-b's 100%
    expect(screen.getByText('25% complete')).toBeInTheDocument();
  });

  it('renders the percentage from the completion store', async () => {
    mockPercentage = 40;
    render(<GuideProgressBar contentUrl="guide-a" />);

    // Wait for effect to resolve key
    await act(async () => {
      await Promise.resolve();
    });

    const bar = screen.getByRole('progressbar');
    // Locks the e2e contract: tests/helpers/completion.helpers.ts reads these.
    expect(bar).toHaveAttribute('data-testid', 'guide-progress-bar');
    expect(screen.getByText('40% complete')).toHaveAttribute('data-testid', 'guide-progress-percentage');
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(screen.getByText('40% complete')).toBeInTheDocument();
  });

  it('updates live when the store notifies a progress change', async () => {
    mockPercentage = 20;
    render(<GuideProgressBar contentUrl="guide-a" />);

    // Wait for effect to resolve key
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText('20% complete')).toBeInTheDocument();

    setPercentage(90);
    expect(screen.getByText('90% complete')).toBeInTheDocument();

    // 100 arrives only when the guide is truly complete (e.g. Mark complete),
    // mirroring the footer exactly since both read the same source.
    setPercentage(100);
    expect(screen.getByText('100% complete')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });
});
