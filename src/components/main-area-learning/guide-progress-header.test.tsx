/**
 * Tests for GuideProgressHeader.
 *
 * Validates title display, progress loading from storage, real-time event
 * updates, content key matching, and sidebar handoff button.
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { GuideProgressHeader } from './guide-progress-header';
import { interactiveCompletionStorage } from '../../lib/user-storage';
import { testIds } from '../../constants/testIds';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockTheme = {
  isDark: false,
  spacing: (n: number) => `${n * 8}px`,
  shape: { radius: { default: '4px', pill: '9999px' } },
  colors: {
    text: { primary: '#000', secondary: '#666', disabled: '#aaa' },
    background: { primary: '#fff', secondary: '#f5f5f5' },
    border: { weak: '#ddd' },
    action: { hover: '#eee' },
    success: { main: '#0f0' },
  },
  typography: {
    h3: { fontSize: '24px' },
    body: { fontSize: '14px' },
    bodySmall: { fontSize: '12px' },
    fontWeightMedium: 500,
  },
};

jest.mock('@grafana/ui', () => ({
  useStyles2: (fn: any) => fn(mockTheme),
  Button: ({ children, onClick, ...rest }: any) => (
    <button data-testid={rest['data-testid']} onClick={onClick}>
      {children}
    </button>
  ),
}));

jest.mock('../../lib/user-storage', () => ({
  interactiveCompletionStorage: {
    get: jest.fn().mockResolvedValue(0),
  },
}));

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  (interactiveCompletionStorage.get as jest.Mock).mockResolvedValue(0);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GuideProgressHeader', () => {
  const defaultProps = {
    title: 'Getting started with Prometheus',
    contentKey: 'bundled:prometheus-101',
    onOpenInSidebar: jest.fn(),
  };

  it('renders the guide title', () => {
    render(<GuideProgressHeader {...defaultProps} />);
    expect(screen.getByText('Getting started with Prometheus')).toBeInTheDocument();
  });

  it('renders the progress header container', () => {
    render(<GuideProgressHeader {...defaultProps} />);
    expect(screen.getByTestId(testIds.mainAreaLearning.progressHeader)).toBeInTheDocument();
  });

  it('renders the progress bar', () => {
    render(<GuideProgressHeader {...defaultProps} />);
    expect(screen.getByTestId(testIds.mainAreaLearning.progressBar)).toBeInTheDocument();
  });

  it('shows progress percentage after async storage load', async () => {
    (interactiveCompletionStorage.get as jest.Mock).mockResolvedValue(42);

    render(<GuideProgressHeader {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('42% complete')).toBeInTheDocument();
    });

    expect(interactiveCompletionStorage.get).toHaveBeenCalledWith('bundled:prometheus-101');
  });

  it('hides progress text when progress is 0', async () => {
    (interactiveCompletionStorage.get as jest.Mock).mockResolvedValue(0);

    render(<GuideProgressHeader {...defaultProps} />);

    // Wait for the async load to complete
    await act(async () => {});

    expect(screen.queryByText(/complete/)).not.toBeInTheDocument();
  });

  it('updates on interactive-progress-saved event with matching contentKey', async () => {
    render(<GuideProgressHeader {...defaultProps} />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent('interactive-progress-saved', {
          detail: {
            contentKey: 'bundled:prometheus-101',
            completionPercentage: 75,
            hasProgress: true,
          },
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText('75% complete')).toBeInTheDocument();
    });
  });

  it('ignores interactive-progress-saved event with non-matching contentKey', async () => {
    (interactiveCompletionStorage.get as jest.Mock).mockResolvedValue(10);

    render(<GuideProgressHeader {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('10% complete')).toBeInTheDocument();
    });

    act(() => {
      window.dispatchEvent(
        new CustomEvent('interactive-progress-saved', {
          detail: {
            contentKey: 'bundled:some-other-guide',
            completionPercentage: 90,
            hasProgress: true,
          },
        })
      );
    });

    // Should still show 10%, not 90%
    expect(screen.getByText('10% complete')).toBeInTheDocument();
    expect(screen.queryByText('90% complete')).not.toBeInTheDocument();
  });

  it('calls onOpenInSidebar when button is clicked', () => {
    const onOpenInSidebar = jest.fn();
    render(<GuideProgressHeader {...defaultProps} onOpenInSidebar={onOpenInSidebar} />);

    screen.getByTestId(testIds.mainAreaLearning.openInSidebarHeaderButton).click();

    expect(onOpenInSidebar).toHaveBeenCalledTimes(1);
  });

  it('re-fetches progress when contentKey changes', async () => {
    (interactiveCompletionStorage.get as jest.Mock).mockResolvedValueOnce(25).mockResolvedValueOnce(60);

    const { rerender } = render(<GuideProgressHeader {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('25% complete')).toBeInTheDocument();
    });

    rerender(<GuideProgressHeader {...defaultProps} title="New guide" contentKey="bundled:new-guide" />);

    await waitFor(() => {
      expect(screen.getByText('60% complete')).toBeInTheDocument();
    });

    expect(interactiveCompletionStorage.get).toHaveBeenCalledWith('bundled:new-guide');
  });
});
