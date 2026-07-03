import { renderHook, act } from '@testing-library/react';
import { useActiveOutlineItem } from './useActiveOutlineItem';
import { useDocumentOutline, type OutlineItem } from './useDocumentOutline';

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  observe = jest.fn();
  disconnect = jest.fn();
  constructor(public callback: IntersectionObserverCallback) {
    MockIntersectionObserver.instances.push(this);
  }
  trigger() {
    this.callback([], this as unknown as IntersectionObserver);
  }
}

const ITEMS: OutlineItem[] = [
  { id: 'intro', text: 'Introduction', level: 2, kind: 'heading' },
  { id: 'middle', text: 'Middle', level: 2, kind: 'heading' },
  { id: 'end', text: 'End', level: 2, kind: 'heading' },
];

function rectAt(top: number, height = 400) {
  return { top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) };
}

function buildRefs() {
  const container = document.createElement('div');
  ITEMS.forEach((item) => {
    const el = document.createElement('div');
    el.id = item.id;
    el.getBoundingClientRect = jest.fn(() => rectAt(1000));
    container.appendChild(el);
  });
  const root = document.createElement('div');
  root.getBoundingClientRect = jest.fn(() => rectAt(0));
  return { containerRef: { current: container }, rootRef: { current: root }, container, root };
}

beforeEach(() => {
  MockIntersectionObserver.instances = [];
  (global as unknown as { IntersectionObserver: unknown }).IntersectionObserver = MockIntersectionObserver;
});

describe('useActiveOutlineItem', () => {
  it('returns null when there are no items', () => {
    const { containerRef, rootRef } = buildRefs();
    const { result } = renderHook(() => useActiveOutlineItem([], containerRef, rootRef));
    expect(result.current.activeId).toBeNull();
  });

  it('activates the last heading whose top has crossed the top-quarter band', () => {
    const { containerRef, rootRef, container } = buildRefs();
    container.querySelector<HTMLElement>('#intro')!.getBoundingClientRect = jest.fn(() => rectAt(-50));
    container.querySelector<HTMLElement>('#middle')!.getBoundingClientRect = jest.fn(() => rectAt(10));
    container.querySelector<HTMLElement>('#end')!.getBoundingClientRect = jest.fn(() => rectAt(500));

    const { result } = renderHook(() => useActiveOutlineItem(ITEMS, containerRef, rootRef));

    // root height 400, band = 25% of 400 = 100px from the top.
    // intro (-50) and middle (10) are within the band; end (500) is not.
    // The later of the two crossed items — middle — wins.
    expect(result.current.activeId).toBe('middle');
  });

  it('recomputes when the observer fires again after a scroll', () => {
    const { containerRef, rootRef, container } = buildRefs();
    container.querySelectorAll('div').forEach((el) => {
      (el as HTMLElement).getBoundingClientRect = jest.fn(() => rectAt(1000));
    });

    const { result } = renderHook(() => useActiveOutlineItem(ITEMS, containerRef, rootRef));
    expect(result.current.activeId).toBe('intro');

    container.querySelector<HTMLElement>('#end')!.getBoundingClientRect = jest.fn(() => rectAt(-10));
    act(() => {
      MockIntersectionObserver.instances.at(-1)!.trigger();
    });

    expect(result.current.activeId).toBe('end');
  });

  it('suppresses spy updates for a short window after notifyJump, and jumps straight to the target', () => {
    const { containerRef, rootRef } = buildRefs();
    const { result } = renderHook(() => useActiveOutlineItem(ITEMS, containerRef, rootRef));

    act(() => {
      result.current.notifyJump('end');
    });
    expect(result.current.activeId).toBe('end');

    act(() => {
      MockIntersectionObserver.instances.at(-1)!.trigger();
    });
    // Still suppressed immediately after the jump, so the recompute is a no-op.
    expect(result.current.activeId).toBe('end');
  });

  it('resets activeId when items are non-empty but none resolve in the container', () => {
    const { containerRef, rootRef } = buildRefs();
    const { result, rerender } = renderHook(({ items }) => useActiveOutlineItem(items, containerRef, rootRef), {
      initialProps: { items: ITEMS },
    });
    expect(result.current.activeId).toBe('intro');

    rerender({ items: [{ id: 'missing', text: 'Missing', level: 2, kind: 'heading' }] });
    expect(result.current.activeId).toBeNull();
  });

  it('does not throw for ids generated from headings with no ASCII alphanumerics (CJK/Cyrillic/emoji)', () => {
    const container = document.createElement('div');
    container.innerHTML = '<h2>こんにちは</h2><h2>Привет</h2><h2>🎉🎊</h2>';
    const containerRef = { current: container };
    const { result: outline } = renderHook(() => useDocumentOutline(containerRef, 'doc-1', true));
    expect(outline.current.every((item) => item.id.length > 0)).toBe(true);

    const root = document.createElement('div');
    root.getBoundingClientRect = jest.fn(() => rectAt(0));
    container.querySelectorAll<HTMLElement>('h2').forEach((el) => {
      el.getBoundingClientRect = jest.fn(() => rectAt(1000));
    });

    expect(() => {
      renderHook(() => useActiveOutlineItem(outline.current, containerRef, { current: root }));
    }).not.toThrow();
  });
});
