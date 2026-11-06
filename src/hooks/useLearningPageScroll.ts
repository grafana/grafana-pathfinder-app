import { useLayoutEffect, type RefObject } from 'react';

function findScrollContainer(element: HTMLElement): Element {
  for (
    let current: HTMLElement | null = element;
    current && current !== document.body && current !== document.documentElement;
    current = current.parentElement
  ) {
    if (/(auto|scroll)/.test(getComputedStyle(current).overflowY) && current.scrollHeight > current.clientHeight) {
      return current;
    }
  }
  return document.scrollingElement ?? document.documentElement;
}

export function useLearningPageScroll(ref: RefObject<HTMLElement | null>, enabled = true): void {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!enabled || !element) {
      return;
    }
    let container = findScrollContainer(element);
    let scrollTop = container.scrollTop;

    // Grafana moves scrolling from the document to main when an extension sidebar opens.
    const syncContainer = () => {
      const next = findScrollContainer(element);
      if (next === container) {
        return false;
      }
      container = next;
      container.scrollTop = scrollTop;
      return true;
    };
    const onScroll = (event: Event) => {
      if (syncContainer()) {
        return;
      }
      if (
        event.target === container ||
        (container === (document.scrollingElement ?? document.documentElement) && event.target === document)
      ) {
        scrollTop = container.scrollTop;
      }
    };
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(syncContainer);
    observer?.observe(element);
    const main = element.closest('main');
    if (main && main !== element) {
      observer?.observe(main);
    }
    observer?.observe(document.documentElement);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', syncContainer);
    return () => {
      observer?.disconnect();
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', syncContainer);
    };
  }, [ref, enabled]);
}
