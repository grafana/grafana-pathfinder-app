import React from 'react';
import { render, act } from '@testing-library/react';
import { useRecommendationsScrollPosition } from './useRecommendationsScrollPosition';
import { StorageKeys } from '../../../lib/storage-keys';

const flushAnimationFrame = () => act(() => new Promise((resolve) => requestAnimationFrame(resolve)));

function setScrollMetrics(
  container: HTMLDivElement,
  metrics: { scrollTop?: number; scrollHeight?: number; clientHeight?: number } = {}
) {
  Object.defineProperties(container, {
    scrollTop: { value: metrics.scrollTop ?? 0, writable: true, configurable: true },
    scrollHeight: { value: metrics.scrollHeight ?? 2000, configurable: true },
    clientHeight: { value: metrics.clientHeight ?? 100, configurable: true },
  });
}

function TestContainer({ isReady }: { isReady: boolean }) {
  const ref = useRecommendationsScrollPosition(isReady);
  return (
    <div ref={ref} data-testid="scroll-container" style={{ height: '100px', overflow: 'auto' }}>
      <div style={{ height: '2000px' }} />
    </div>
  );
}

describe('useRecommendationsScrollPosition', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('restores the saved scroll position once content is ready', async () => {
    sessionStorage.setItem(StorageKeys.RECOMMENDATIONS_SCROLL_POSITION, '450');

    const { getByTestId } = render(<TestContainer isReady={true} />);
    const container = getByTestId('scroll-container') as HTMLDivElement;
    setScrollMetrics(container);

    await flushAnimationFrame();

    expect(container.scrollTop).toBe(450);
  });

  it('does not restore before content is ready', async () => {
    sessionStorage.setItem(StorageKeys.RECOMMENDATIONS_SCROLL_POSITION, '450');

    const { getByTestId, rerender } = render(<TestContainer isReady={false} />);
    const container = getByTestId('scroll-container') as HTMLDivElement;
    setScrollMetrics(container);

    rerender(<TestContainer isReady={false} />);
    await flushAnimationFrame();

    expect(container.scrollTop).toBe(0);
  });

  it('does not clobber the saved position when isReady flips from false to true within one mount', async () => {
    sessionStorage.setItem(StorageKeys.RECOMMENDATIONS_SCROLL_POSITION, '450');

    const { getByTestId, rerender } = render(<TestContainer isReady={false} />);
    const container = getByTestId('scroll-container') as HTMLDivElement;
    setScrollMetrics(container);

    act(() => {
      rerender(<TestContainer isReady={true} />);
    });
    await flushAnimationFrame();

    expect(sessionStorage.getItem(StorageKeys.RECOMMENDATIONS_SCROLL_POSITION)).toBe('450');
    expect(container.scrollTop).toBe(450);
  });

  it('does not clobber the saved position when unmounting before content is ready', () => {
    sessionStorage.setItem(StorageKeys.RECOMMENDATIONS_SCROLL_POSITION, '450');

    const { getByTestId, unmount } = render(<TestContainer isReady={false} />);
    const container = getByTestId('scroll-container') as HTMLDivElement;
    setScrollMetrics(container);

    unmount();

    expect(sessionStorage.getItem(StorageKeys.RECOMMENDATIONS_SCROLL_POSITION)).toBe('450');
  });

  it('retries restore if the current content height cannot fit the saved position', async () => {
    sessionStorage.setItem(StorageKeys.RECOMMENDATIONS_SCROLL_POSITION, '450');

    const { getByTestId, rerender } = render(<TestContainer isReady={true} />);
    const container = getByTestId('scroll-container') as HTMLDivElement;
    setScrollMetrics(container, { scrollHeight: 100, clientHeight: 100 });

    await flushAnimationFrame();

    expect(container.scrollTop).toBe(0);

    act(() => {
      rerender(<TestContainer isReady={false} />);
    });
    setScrollMetrics(container, { scrollHeight: 2000, clientHeight: 100 });
    act(() => {
      rerender(<TestContainer isReady={true} />);
    });
    await flushAnimationFrame();

    expect(container.scrollTop).toBe(450);
  });

  it('saves scroll position on scroll and restores it after remount', async () => {
    const { getByTestId, unmount } = render(<TestContainer isReady={true} />);
    const container = getByTestId('scroll-container') as HTMLDivElement;
    setScrollMetrics(container, { scrollTop: 275 });

    act(() => {
      container.dispatchEvent(new Event('scroll'));
    });

    expect(sessionStorage.getItem(StorageKeys.RECOMMENDATIONS_SCROLL_POSITION)).toBe('275');

    unmount();

    const { getByTestId: getByTestIdAfterRemount } = render(<TestContainer isReady={true} />);
    const restoredContainer = getByTestIdAfterRemount('scroll-container') as HTMLDivElement;
    setScrollMetrics(restoredContainer);

    await flushAnimationFrame();

    expect(restoredContainer.scrollTop).toBe(275);
  });

  it('ignores a non-numeric saved value', async () => {
    sessionStorage.setItem(StorageKeys.RECOMMENDATIONS_SCROLL_POSITION, 'not-a-number');

    const { getByTestId } = render(<TestContainer isReady={true} />);
    const container = getByTestId('scroll-container') as HTMLDivElement;
    setScrollMetrics(container);

    await flushAnimationFrame();

    expect(container.scrollTop).toBe(0);
  });
});
