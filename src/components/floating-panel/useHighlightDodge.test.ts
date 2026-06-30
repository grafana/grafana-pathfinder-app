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

function captureEvents() {
  const events: string[] = [];
  const dodge = () => events.push('dodge');
  const compact = () => events.push('compact');
  document.addEventListener('pathfinder-floating-dodge', dodge);
  document.addEventListener('pathfinder-floating-compact', compact);
  return {
    events,
    cleanup: () => {
      document.removeEventListener('pathfinder-floating-dodge', dodge);
      document.removeEventListener('pathfinder-floating-compact', compact);
    },
  };
}

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
    expect(cap.events).toContain('dodge');
    expect(cap.events).not.toContain('compact');
    cap.cleanup();
  });

  it('compacts when a full-viewport modal leaves no clear corner', () => {
    addModal(0, 0, 1280, 800); // covers everything
    const cap = captureEvents();
    renderHook(() => useHighlightDodge(GEOMETRY, false, true));
    expect(cap.events).toContain('compact');
    expect(cap.events).not.toContain('dodge');
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
