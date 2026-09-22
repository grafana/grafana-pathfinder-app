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

  it('renders the percentage from the completion store', () => {
    mockPercentage = 40;
    render(<GuideProgressBar contentUrl="guide-a" />);

    const bar = screen.getByRole('progressbar');
    // Locks the e2e contract: tests/helpers/completion.helpers.ts reads these.
    expect(bar).toHaveAttribute('data-testid', 'guide-progress-bar');
    expect(screen.getByText('40% complete')).toHaveAttribute('data-testid', 'guide-progress-percentage');
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(screen.getByText('40% complete')).toBeInTheDocument();
  });

  it('updates live when the store notifies a progress change', () => {
    mockPercentage = 20;
    render(<GuideProgressBar contentUrl="guide-a" />);
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
