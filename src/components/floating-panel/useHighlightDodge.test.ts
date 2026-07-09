import { renderHook } from '@testing-library/react';

import { useHighlightDodge } from './useHighlightDodge';

const GEOMETRY = { x: 50, y: 50, width: 400, height: 400 };

function mockRect(el: HTMLElement, left: number, top: number, width: number, height: number) {
  el.getBoundingClientRect = () =>
    ({
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      x: left,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
}

function addModal(left: number, top: number, width: number, height: number, attrs: Record<string, string> = {}) {
  const el = document.createElement('div');
  el.setAttribute('role', 'dialog');
  el.style.opacity = '1';
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  document.body.appendChild(el);
  mockRect(el, left, top, width, height);
  return el;
}

function addHighlight(left: number, top: number, width: number, height: number) {
  const el = document.createElement('div');
  el.className = 'interactive-highlight-outline';
  document.body.appendChild(el);
  mockRect(el, left, top, width, height);
  return el;
}

type CapturedEvent = { type: string; detail?: { x: number; y: number } };

function captureEvents() {
  const events: CapturedEvent[] = [];
  const push = (type: string) => (e: Event) => events.push({ type, detail: (e as CustomEvent).detail });
  const handlers: Array<[string, EventListener]> = [
    ['pathfinder-floating-dodge', push('dodge')],
    ['pathfinder-floating-compact', push('compact')],
    ['pathfinder-floating-restore-position', push('restore-position')],
    ['pathfinder-floating-restore-full', push('restore-full')],
  ];
  handlers.forEach(([name, h]) => document.addEventListener(name, h));
  return {
    events,
    types: () => events.map((e) => e.type),
    cleanup: () => handlers.forEach(([name, h]) => document.removeEventListener(name, h)),
  };
}

const settle = () => new Promise((r) => setTimeout(r, 30));

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  document.body.innerHTML = '';
});

describe('useHighlightDodge — modal dodging', () => {
  it('dodges to a clear corner when a modal overlaps the panel (dodgeModal=true)', () => {
    addModal(0, 0, 300, 300); // top-left modal, overlaps the panel at 50,50
    const cap = captureEvents();
    renderHook(() => useHighlightDodge(GEOMETRY, false, true));
    expect(cap.types()).toContain('dodge');
    expect(cap.types()).not.toContain('compact');
    cap.cleanup();
  });

  it('compacts (without repositioning) when a full-viewport modal leaves no corner at any size', () => {
    addModal(0, 0, 1280, 800); // covers everything
    const cap = captureEvents();
    renderHook(() => useHighlightDodge(GEOMETRY, false, true));
    expect(cap.types()).toContain('compact');
    expect(cap.types()).not.toContain('dodge');
    cap.cleanup();
  });

  it('dodges the journey image lightbox — matched by class only, no role/aria', () => {
    const lightbox = document.createElement('div');
    lightbox.className = 'journey-image-modal';
    lightbox.style.opacity = '1';
    document.body.appendChild(lightbox);
    mockRect(lightbox, 0, 0, 500, 500); // overlaps the panel

    const cap = captureEvents();
    renderHook(() => useHighlightDodge(GEOMETRY, false, true));
    expect(cap.types()).toContain('dodge');
    cap.cleanup();
  });

  it('models every open modal, not just the largest', () => {
    addModal(700, 0, 500, 700); // largest, does not overlap the panel
    addModal(0, 0, 150, 150); // small, overlaps the panel
    const cap = captureEvents();
    renderHook(() => useHighlightDodge(GEOMETRY, false, true));
    expect(cap.types()).toContain('dodge');
    // The chosen corner must clear both modals, including the large one.
    const dodge = cap.events.find((e) => e.type === 'dodge');
    expect(dodge?.detail).toEqual({ x: 32, y: 368 }); // bottom-left
    cap.cleanup();
  });

  it('does not force compact when far-apart obstacles leave a corner free (no union inflation)', () => {
    addHighlight(0, 0, 100, 100); // overlaps the panel, top-left
    addModal(1150, 720, 100, 60); // bottom-right corner
    const cap = captureEvents();
    renderHook(() => useHighlightDodge(GEOMETRY, false, true));
    expect(cap.types()).toContain('dodge');
    expect(cap.types()).not.toContain('compact');
    cap.cleanup();
  });

  it('compacts and repositions when only the compacted panel fits a corner', () => {
    addModal(0, 0, 1280, 450); // upper half+ of the viewport; no corner fits a 400-high panel
    const cap = captureEvents();
    renderHook(() => useHighlightDodge(GEOMETRY, false, true));
    expect(cap.types()).toContain('compact');
    const dodge = cap.events.find((e) => e.type === 'dodge');
    expect(dodge?.detail).toEqual({ x: 848, y: 488 }); // bottom-right at min height
    cap.cleanup();
  });

  it('excludes the Pathfinder panel itself from modal dodging', () => {
    addModal(0, 0, 300, 300, { 'data-pathfinder-content': 'true' });
    const cap = captureEvents();
    renderHook(() => useHighlightDodge(GEOMETRY, false, true));
    expect(cap.events).toEqual([]);
    cap.cleanup();
  });

  it('ignores modals entirely when dodgeModal=false (regression of base behavior)', () => {
    addModal(0, 0, 300, 300); // overlaps the panel, but dodgeModal is off
    const cap = captureEvents();
    renderHook(() => useHighlightDodge(GEOMETRY, false, false));
    expect(cap.events).toEqual([]);
    cap.cleanup();
  });
});

describe('useHighlightDodge — restore vs manual drag', () => {
  it('restores to the pre-dodge position when obstacles clear', async () => {
    const highlight = addHighlight(0, 0, 200, 200); // overlaps the panel
    const cap = captureEvents();
    renderHook(() => useHighlightDodge(GEOMETRY, false, true));
    expect(cap.types()).toContain('dodge');

    highlight.remove();
    document.dispatchEvent(new CustomEvent('pathfinder-modal-state-changed', { detail: { isOpen: false } }));
    await settle();

    const restore = cap.events.find((e) => e.type === 'restore-position');
    expect(restore?.detail).toEqual({ x: 50, y: 50 });
    expect(cap.types()).toContain('restore-full');
    cap.cleanup();
  });

  it('a manual drag during a dodge becomes the new restore target (no stale teleport)', async () => {
    const highlight = addHighlight(0, 0, 200, 200);
    const cap = captureEvents();
    renderHook(() => useHighlightDodge(GEOMETRY, false, true));
    expect(cap.types()).toContain('dodge');

    document.dispatchEvent(new CustomEvent('pathfinder-floating-manual-move', { detail: { x: 300, y: 300 } }));

    highlight.remove();
    document.dispatchEvent(new CustomEvent('pathfinder-modal-state-changed', { detail: { isOpen: false } }));
    await settle();

    const restore = cap.events.find((e) => e.type === 'restore-position');
    expect(restore?.detail).toEqual({ x: 300, y: 300 });
    cap.cleanup();
  });

  it('a manual drag with no dodge active does not arm a restore', async () => {
    const cap = captureEvents();
    renderHook(() => useHighlightDodge(GEOMETRY, false, true));

    document.dispatchEvent(new CustomEvent('pathfinder-floating-manual-move', { detail: { x: 300, y: 300 } }));
    document.dispatchEvent(new CustomEvent('pathfinder-modal-state-changed', { detail: { isOpen: false } }));
    await settle();

    expect(cap.events).toEqual([]);
    cap.cleanup();
  });
});
