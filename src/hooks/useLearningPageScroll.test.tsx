import React, { useRef } from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { useLearningPageScroll } from './useLearningPageScroll';

let resize: ResizeObserverCallback;
const disconnect = jest.fn();
const originalObserver = global.ResizeObserver;

beforeEach(() => {
  disconnect.mockClear();
  global.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) {
      resize = callback;
    }
    observe() {}
    disconnect = disconnect;
  } as unknown as typeof ResizeObserver;
  document.documentElement.scrollTop = 0;
});
afterEach(() => {
  global.ResizeObserver = originalObserver;
});

function Page({ enabled = true }: { enabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useLearningPageScroll(ref, enabled);
  return (
    <div ref={ref} data-testid="page">
      <div data-testid="reader" />
    </div>
  );
}

function setup() {
  const main = document.createElement('main');
  Object.defineProperties(main, {
    scrollHeight: { value: 2000 },
    clientHeight: { value: 600 },
  });
  document.body.style.overflowY = 'auto';
  Object.defineProperties(document.body, {
    scrollHeight: { configurable: true, value: 2000 },
    clientHeight: { configurable: true, value: 600 },
  });
  main.style.overflowY = 'visible';
  document.body.appendChild(main);
  const result = render(<Page />, { container: main });
  return { main, ...result };
}

it('preserves document scroll when opening the sidebar changes the scroll container', () => {
  const { main, unmount } = setup();
  document.documentElement.scrollTop = 514;
  fireEvent.scroll(document);
  main.style.overflowY = 'auto';
  document.documentElement.scrollTop = 0;
  act(() => resize([], {} as ResizeObserver));
  expect(main.scrollTop).toBe(514);
  unmount();
  expect(disconnect).toHaveBeenCalledTimes(1);
  main.remove();
});

it('restores the current page position when closing the sidebar and ignores reader scrolling', () => {
  const { main, getByTestId, unmount } = setup();
  document.documentElement.scrollTop = 400;
  fireEvent.scroll(document);
  main.style.overflowY = 'auto';
  act(() => resize([], {} as ResizeObserver));
  main.scrollTop = 620;
  fireEvent.scroll(main);
  const reader = getByTestId('reader');
  reader.scrollTop = 90;
  fireEvent.scroll(reader);
  main.style.overflowY = 'visible';
  act(() => resize([], {} as ResizeObserver));
  expect(document.documentElement.scrollTop).toBe(620);
  unmount();
  main.remove();
});

it('keeps an intentional scroll to the top when the layout later changes', () => {
  const { main, unmount } = setup();
  document.documentElement.scrollTop = 400;
  fireEvent.scroll(document);
  document.documentElement.scrollTop = 0;
  fireEvent.scroll(document);
  main.style.overflowY = 'auto';
  act(() => resize([], {} as ResizeObserver));
  expect(main.scrollTop).toBe(0);
  unmount();
  main.remove();
});
