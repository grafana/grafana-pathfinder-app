import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { reportAppInteraction } from '../../lib/analytics';
import { FloatingPanel } from './FloatingPanel';

jest.mock('../../lib/analytics', () => ({
  ...jest.requireActual('../../lib/analytics'),
  reportAppInteraction: jest.fn(),
}));

jest.mock('./MinimizedPill', () => {
  const React = require('react');
  return {
    MinimizedPill: ({ onRestore }: { onRestore: () => void }) =>
      React.createElement('button', { type: 'button', 'aria-label': 'Restore floating panel', onClick: onRestore }),
  };
});

function flushReactUpdates(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

describe('FloatingPanel dodge session interleavings', () => {
  const noop = () => {};

  function renderPanel() {
    render(
      <FloatingPanel title="Test guide" hasActiveGuide={false} onSwitchToSidebar={noop} onClose={noop}>
        <div data-testid="guide-content" />
      </FloatingPanel>
    );
    return screen.getByTestId('guide-content').parentElement as HTMLDivElement;
  }

  beforeEach(() => {
    (reportAppInteraction as jest.Mock).mockClear();
    window.localStorage.clear();
  });

  it('applies restore-position while compacted without touching scrollTop, then restore-full lands the saved scroll', async () => {
    const content = renderPanel();
    content.scrollTop = 800;

    act(() => {
      document.dispatchEvent(new CustomEvent('pathfinder-floating-compact'));
    });
    content.scrollTop = 0;

    act(() => {
      document.dispatchEvent(new CustomEvent('pathfinder-floating-restore-position', { detail: { x: 40, y: 50 } }));
    });

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveStyle({ left: '40px', top: '50px' });
    expect(dialog).toHaveAttribute('data-panel-state', 'compact');
    expect(content.scrollTop).toBe(0);

    await act(async () => {
      document.dispatchEvent(new CustomEvent('pathfinder-floating-restore-full'));
      await flushReactUpdates();
    });

    expect(dialog).toHaveAttribute('data-panel-state', 'full');
    expect(content.scrollTop).toBe(800);
  });

  it('minimizing after restore-full still ends with the saved scroll once restored from the pill', async () => {
    const content = renderPanel();
    content.scrollTop = 800;

    act(() => {
      document.dispatchEvent(new CustomEvent('pathfinder-floating-compact'));
    });
    content.scrollTop = 0;

    act(() => {
      document.dispatchEvent(new CustomEvent('pathfinder-floating-restore-full'));
    });
    act(() => {
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });
    await act(async () => {
      await flushReactUpdates();
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Restore floating panel'));
      await flushReactUpdates();
    });

    expect(screen.getByRole('dialog')).toHaveAttribute('data-panel-state', 'full');
    expect(content.scrollTop).toBe(800);
  });

  it('a scroll restore scheduled before minimize does not write while minimized', async () => {
    const content = renderPanel();
    content.scrollTop = 800;

    act(() => {
      document.dispatchEvent(new CustomEvent('pathfinder-floating-compact'));
    });
    content.scrollTop = 0;

    act(() => {
      document.dispatchEvent(new CustomEvent('pathfinder-floating-restore-full'));
    });
    act(() => {
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });
    await act(async () => {
      await flushReactUpdates();
    });

    // Minimize staled the scheduled write: nothing may touch scrollTop while
    // the panel is display:none (a real browser would clamp the write away).
    expect(screen.getByRole('dialog', { hidden: true })).toHaveAttribute('data-panel-state', 'minimized');
    expect(content.scrollTop).toBe(0);

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Restore floating panel'));
      await flushReactUpdates();
    });

    expect(content.scrollTop).toBe(800);
  });

  it('minimizing a never-compacted panel captures the scroll, surviving the display:none clamp', async () => {
    const content = renderPanel();
    content.scrollTop = 800;

    act(() => {
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });
    // Simulate the real-browser clamp: display:none collapses the scroll
    // container and resets scrollTop to 0 (jsdom does not emulate this).
    content.scrollTop = 0;

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Restore floating panel'));
      await flushReactUpdates();
    });

    expect(screen.getByRole('dialog')).toHaveAttribute('data-panel-state', 'full');
    expect(content.scrollTop).toBe(800);
  });

  it('a dodge repositions, flashes the dodging style, and a rapid second dodge reports only the final move', () => {
    jest.useFakeTimers();
    try {
      renderPanel();
      const dialog = screen.getByRole('dialog');
      const restingClassName = dialog.className;

      act(() => {
        document.dispatchEvent(new CustomEvent('pathfinder-floating-dodge', { detail: { x: 60, y: 70 } }));
      });
      expect(dialog).toHaveStyle({ left: '60px', top: '70px' });
      expect(dialog.className).not.toBe(restingClassName);

      act(() => {
        document.dispatchEvent(new CustomEvent('pathfinder-floating-dodge', { detail: { x: 80, y: 90 } }));
      });
      act(() => {
        jest.advanceTimersByTime(250);
      });

      expect(reportAppInteraction).toHaveBeenCalledTimes(1);
      expect(reportAppInteraction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ trigger: 'highlight_dodge', x: 80, y: 90 })
      );

      act(() => {
        jest.advanceTimersByTime(1000);
      });
      expect(dialog).toHaveStyle({ left: '80px', top: '90px' });
      expect(dialog.className).toBe(restingClassName);
    } finally {
      jest.useRealTimers();
    }
  });
});
