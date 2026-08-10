/**
 * Tests for useVerticalOverflow. jsdom performs no layout, so scrollHeight /
 * clientHeight are stubbed on the prototype to model the two cases that matter
 * for a scroll-fade affordance: content that fits (no fade) and content that
 * spills (fade).
 */

import React from 'react';
import { render, act, screen } from '@testing-library/react';

import { useVerticalOverflow } from './useVerticalOverflow';

let scrollHeight = 0;
let clientHeight = 0;
let scrollTop = 0;

const originalScrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight');
const originalClientHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight');
const originalScrollTop = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');

/** Captures the observer callbacks so tests can drive a resize. */
function installResizeObserver() {
  const callbacks: Array<() => void> = [];
  class MockResizeObserver {
    constructor(callback: () => void) {
      callbacks.push(callback);
    }
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  (global as unknown as { ResizeObserver: unknown }).ResizeObserver = MockResizeObserver;
  return { fire: () => callbacks.forEach((cb) => cb()) };
}

/** `mounted: false` models a list still hidden behind a loading skeleton. */
function Probe({ mounted = true }: { mounted?: boolean }) {
  const [ref, hasOverflow] = useVerticalOverflow<HTMLDivElement>();
  return React.createElement(
    'div',
    { 'data-testid': 'probe' },
    String(hasOverflow),
    mounted ? React.createElement('div', { ref, 'data-testid': 'region' }) : null
  );
}

function overflowState() {
  return screen.getByTestId('probe').textContent?.startsWith('true') ? 'true' : 'false';
}

beforeAll(() => {
  Object.defineProperty(Element.prototype, 'scrollHeight', { get: () => scrollHeight, configurable: true });
  Object.defineProperty(Element.prototype, 'clientHeight', { get: () => clientHeight, configurable: true });
  Object.defineProperty(Element.prototype, 'scrollTop', { get: () => scrollTop, configurable: true });
});

afterAll(() => {
  if (originalScrollHeight) {
    Object.defineProperty(Element.prototype, 'scrollHeight', originalScrollHeight);
  }
  if (originalClientHeight) {
    Object.defineProperty(Element.prototype, 'clientHeight', originalClientHeight);
  }
  if (originalScrollTop) {
    Object.defineProperty(Element.prototype, 'scrollTop', originalScrollTop);
  }
});

beforeEach(() => {
  scrollTop = 0;
});

afterEach(() => {
  delete (global as unknown as { ResizeObserver?: unknown }).ResizeObserver;
});

describe('useVerticalOverflow', () => {
  it('reports no overflow when the content fits', () => {
    installResizeObserver();
    // Two short courses in a panel stretched by a taller sibling column: there
    // is nothing below, so no fade may be applied.
    scrollHeight = 160;
    clientHeight = 400;

    render(React.createElement(Probe));

    expect(overflowState()).toBe('false');
  });

  it('reports overflow when the content exceeds the element height', () => {
    installResizeObserver();
    scrollHeight = 482;
    clientHeight = 400;

    render(React.createElement(Probe));

    expect(overflowState()).toBe('true');
  });

  it('measures an element that mounts after the hook does', () => {
    installResizeObserver();
    scrollHeight = 482;
    clientHeight = 400;

    // Discover more renders a skeleton first, so the measured list attaches on a
    // later render. A ref read once on mount would leave this false forever.
    const { rerender } = render(React.createElement(Probe, { mounted: false }));
    expect(overflowState()).toBe('false');

    rerender(React.createElement(Probe, { mounted: true }));

    expect(overflowState()).toBe('true');
  });

  it('clears overflow when the measured element unmounts', () => {
    installResizeObserver();
    scrollHeight = 482;
    clientHeight = 400;

    const { rerender } = render(React.createElement(Probe, { mounted: true }));
    expect(overflowState()).toBe('true');

    rerender(React.createElement(Probe, { mounted: false }));

    expect(overflowState()).toBe('false');
  });

  it('re-measures when content grows after mount', () => {
    const { fire } = installResizeObserver();
    scrollHeight = 100;
    clientHeight = 400;

    render(React.createElement(Probe));
    expect(overflowState()).toBe('false');

    // A card expanding in place grows scrollHeight without resizing the scroller.
    scrollHeight = 620;
    act(() => fire());

    expect(overflowState()).toBe('true');
  });

  it('turns the fade back off when content shrinks to fit', () => {
    const { fire } = installResizeObserver();
    scrollHeight = 620;
    clientHeight = 400;

    render(React.createElement(Probe));
    expect(overflowState()).toBe('true');

    scrollHeight = 300;
    act(() => fire());

    expect(overflowState()).toBe('false');
  });

  it('reports nothing below once scrolled to the end', () => {
    installResizeObserver();
    scrollHeight = 482;
    clientHeight = 400;

    render(React.createElement(Probe));
    expect(overflowState()).toBe('true');

    // A fade means "more below", so it must clear at the end — otherwise it dims
    // the last row with nothing left to reveal.
    scrollTop = 82;
    act(() => {
      screen.getByTestId('region').dispatchEvent(new Event('scroll'));
    });

    expect(overflowState()).toBe('false');
  });

  it('reports content below again after scrolling back up', () => {
    installResizeObserver();
    scrollHeight = 482;
    clientHeight = 400;
    scrollTop = 82;

    render(React.createElement(Probe));
    expect(overflowState()).toBe('false');

    scrollTop = 0;
    act(() => {
      screen.getByTestId('region').dispatchEvent(new Event('scroll'));
    });

    expect(overflowState()).toBe('true');
  });

  it('treats a sub-pixel height difference as fitting', () => {
    installResizeObserver();
    scrollHeight = 400.5;
    clientHeight = 400;

    render(React.createElement(Probe));

    expect(overflowState()).toBe('false');
  });

  it('still measures when ResizeObserver is unavailable', () => {
    scrollHeight = 482;
    clientHeight = 400;

    expect(() => render(React.createElement(Probe))).not.toThrow();
    expect(overflowState()).toBe('true');
  });
});
