import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { FloatingPanel } from './FloatingPanel';

/** Flushes one requestAnimationFrame tick (the restore-full handler defers its scrollTop write to a frame). */
function flushFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
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

  it('restores scrollTop after a compact -> restore-full cycle', async () => {
    const content = renderPanel();
    content.scrollTop = 800;

    act(() => {
      document.dispatchEvent(new CustomEvent('pathfinder-floating-compact'));
    });
    expect(screen.getByRole('dialog')).toHaveAttribute('data-panel-state', 'compact');

    // Compact mode sets the panel's own height to 'auto', which collapses
    // .content's scroll container in a real browser (nothing left to
    // scroll). jsdom does no layout, so emulate that clamp explicitly.
    content.scrollTop = 0;

    await act(async () => {
      document.dispatchEvent(new CustomEvent('pathfinder-floating-restore-full'));
      await flushFrame();
    });
    expect(screen.getByRole('dialog')).toHaveAttribute('data-panel-state', 'full');

    expect(content.scrollTop).toBe(800);
  });

  it('does not restore a stale scroll position on a second, scroll-free compact cycle', async () => {
    const content = renderPanel();
    content.scrollTop = 800;

    act(() => {
      document.dispatchEvent(new CustomEvent('pathfinder-floating-compact'));
    });
    content.scrollTop = 0;
    await act(async () => {
      document.dispatchEvent(new CustomEvent('pathfinder-floating-restore-full'));
      await flushFrame();
    });
    expect(content.scrollTop).toBe(800);

    // A second cycle starting from scrollTop 0 (user scrolled back to the
    // top) must not resurrect the previous saved value.
    content.scrollTop = 0;
    act(() => {
      document.dispatchEvent(new CustomEvent('pathfinder-floating-compact'));
    });
    content.scrollTop = 0;
    await act(async () => {
      document.dispatchEvent(new CustomEvent('pathfinder-floating-restore-full'));
      await flushFrame();
    });
    expect(content.scrollTop).toBe(0);
  });
});
