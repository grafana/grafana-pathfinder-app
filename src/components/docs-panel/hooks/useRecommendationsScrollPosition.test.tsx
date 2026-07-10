import React from 'react';
import { render, act } from '@testing-library/react';
import { useRecommendationsScrollPosition } from './useRecommendationsScrollPosition';
import { StorageKeys } from '../../../lib/storage-keys';

const flushAnimationFrame = () => act(() => new Promise((resolve) => requestAnimationFrame(resolve)));

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
    Object.defineProperty(container, 'scrollTop', { value: 0, writable: true });

    await flushAnimationFrame();

    expect(container.scrollTop).toBe(450);
  });

  it('does not restore before content is ready', () => {
    sessionStorage.setItem(StorageKeys.RECOMMENDATIONS_SCROLL_POSITION, '450');

    const { getByTestId, rerender } = render(<TestContainer isReady={false} />);
    const container = getByTestId('scroll-container') as HTMLDivElement;
    Object.defineProperty(container, 'scrollTop', { value: 0, writable: true });

    rerender(<TestContainer isReady={false} />);
    expect(container.scrollTop).toBe(0);
  });

  it('saves scroll position on scroll and restores it after remount', async () => {
    const { getByTestId, unmount } = render(<TestContainer isReady={true} />);
    const container = getByTestId('scroll-container') as HTMLDivElement;
    Object.defineProperty(container, 'scrollTop', { value: 275, writable: true });

    act(() => {
      container.dispatchEvent(new Event('scroll'));
    });

    expect(sessionStorage.getItem(StorageKeys.RECOMMENDATIONS_SCROLL_POSITION)).toBe('275');

    unmount();

    const { getByTestId: getByTestIdAfterRemount } = render(<TestContainer isReady={true} />);
    const restoredContainer = getByTestIdAfterRemount('scroll-container') as HTMLDivElement;
    Object.defineProperty(restoredContainer, 'scrollTop', { value: 0, writable: true });

    await flushAnimationFrame();

    expect(restoredContainer.scrollTop).toBe(275);
  });

  it('ignores a non-numeric saved value', async () => {
    sessionStorage.setItem(StorageKeys.RECOMMENDATIONS_SCROLL_POSITION, 'not-a-number');

    const { getByTestId } = render(<TestContainer isReady={true} />);
    const container = getByTestId('scroll-container') as HTMLDivElement;
    Object.defineProperty(container, 'scrollTop', { value: 0, writable: true });

    await flushAnimationFrame();

    expect(container.scrollTop).toBe(0);
  });
});
