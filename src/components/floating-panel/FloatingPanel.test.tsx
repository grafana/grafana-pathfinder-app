import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { FloatingPanel } from './FloatingPanel';

jest.mock('./MinimizedPill', () => {
  const React = require('react');
  return {
    MinimizedPill: ({ onRestore }: { onRestore: () => void }) =>
      React.createElement('button', { type: 'button', 'aria-label': 'Restore floating panel', onClick: onRestore }),
  };
});

/**
 * Mirrors `waitForReactUpdates` (double requestAnimationFrame) — the
 * restore-full handler defers its scrollTop write behind the same wait,
 * so tests need to flush the same number of frames to observe it land.
 */
function flushReactUpdates(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

describe('FloatingPanel scroll preservation across compact <-> full', () => {
  const noop = () => {};

  function renderPanel() {
    render(
      <FloatingPanel title="Test guide" hasActiveGuide={false} onSwitchToSidebar={noop} onClose={noop}>
        <div data-testid="guide-content" />
      </FloatingPanel>
    );
    return screen.getByTestId('guide-content').parentElement as HTMLDivElement;
  }

  /**
   * Drives one compact -> restore-full cycle. `scrollTopDuringCompact`
   * emulates the real-browser clamp: compact mode collapses .content's
   * scroll container, so scrollTop reads back as 0 (or whatever a user
   * scroll during compact left it at) until restore-full completes.
   */
  async function compactAndRestore(content: HTMLDivElement, scrollTopDuringCompact = 0) {
    act(() => {
      document.dispatchEvent(new CustomEvent('pathfinder-floating-compact'));
    });
    expect(screen.getByRole('dialog')).toHaveAttribute('data-panel-state', 'compact');
    content.scrollTop = scrollTopDuringCompact;

    await act(async () => {
      document.dispatchEvent(new CustomEvent('pathfinder-floating-restore-full'));
      await flushReactUpdates();
    });
    expect(screen.getByRole('dialog')).toHaveAttribute('data-panel-state', 'full');
  }

  it('restores scrollTop after a compact -> restore-full cycle', async () => {
    const content = renderPanel();
    content.scrollTop = 800;

    await compactAndRestore(content);

    expect(content.scrollTop).toBe(800);
  });

  it('does not restore a stale scroll position on a second, scroll-free compact cycle', async () => {
    const content = renderPanel();
    content.scrollTop = 800;

    await compactAndRestore(content);
    expect(content.scrollTop).toBe(800);

    // A second cycle starting from scrollTop 0 (user scrolled back to the
    // top) must not resurrect the previous saved value.
    content.scrollTop = 0;
    await compactAndRestore(content);

    expect(content.scrollTop).toBe(0);
  });

  it('drops a stale restore write when a new compact starts before it lands', async () => {
    const content = renderPanel();
    content.scrollTop = 800;

    act(() => {
      document.dispatchEvent(new CustomEvent('pathfinder-floating-compact'));
    });
    content.scrollTop = 0;

    // Schedule the deferred restore write (saved scrollTop: 800), but don't
    // flush the frames yet — a second compact should invalidate it before
    // it has a chance to land.
    act(() => {
      document.dispatchEvent(new CustomEvent('pathfinder-floating-restore-full'));
    });
    act(() => {
      document.dispatchEvent(new CustomEvent('pathfinder-floating-compact'));
    });
    expect(screen.getByRole('dialog')).toHaveAttribute('data-panel-state', 'compact');

    await act(async () => {
      await flushReactUpdates();
    });

    // The stale write (800, from the superseded restore) must not have
    // landed — nothing has restored scrollTop since the second compact.
    expect(content.scrollTop).toBe(0);
    expect(screen.getByRole('dialog')).toHaveAttribute('data-panel-state', 'compact');
  });

  it('restores saved compact scroll when the user minimizes before restore-full', async () => {
    const content = renderPanel();
    content.scrollTop = 800;

    act(() => {
      document.dispatchEvent(new CustomEvent('pathfinder-floating-compact'));
    });
    content.scrollTop = 0;

    act(() => {
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Restore floating panel'));
      await flushReactUpdates();
    });

    expect(screen.getByRole('dialog')).toHaveAttribute('data-panel-state', 'full');
    expect(content.scrollTop).toBe(800);
  });
});
