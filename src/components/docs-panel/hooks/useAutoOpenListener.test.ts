import { renderHook, act } from '@testing-library/react';
import { useAutoOpenListener } from './useAutoOpenListener';
import { linkInterceptionState } from '../../../global-state/link-interception';
import type { DocsPanelModelOperations } from '../types';

function makeModel(): DocsPanelModelOperations {
  return {
    openLearningJourney: jest.fn(),
    openDocsPage: jest.fn(),
  } as unknown as DocsPanelModelOperations;
}

function dispatchAutoOpen(detail: { url: string; title: string; source?: string }) {
  act(() => {
    document.dispatchEvent(new CustomEvent('pathfinder-auto-open-docs', { detail }));
  });
}

describe('useAutoOpenListener', () => {
  let processQueuedLinksSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    processQueuedLinksSpy = jest.spyOn(linkInterceptionState, 'processQueuedLinks').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    processQueuedLinksSpy.mockRestore();
  });

  it('routes /learning-journeys/ URLs to openLearningJourney', () => {
    const model = makeModel();
    renderHook(() => useAutoOpenListener(model));

    dispatchAutoOpen({
      url: 'https://grafana.com/docs/learning-journeys/intro/',
      title: 'Intro journey',
      source: 'recommender',
    });

    expect(model.openLearningJourney).toHaveBeenCalledWith(
      'https://grafana.com/docs/learning-journeys/intro/',
      'Intro journey',
      { source: 'recommender' }
    );
    expect(model.openDocsPage).not.toHaveBeenCalled();
  });

  it('routes /learning-paths/ URLs to openLearningJourney (alias)', () => {
    const model = makeModel();
    renderHook(() => useAutoOpenListener(model));

    dispatchAutoOpen({
      url: 'https://grafana.com/docs/learning-paths/some-path/',
      title: 'Some path',
    });

    expect(model.openLearningJourney).toHaveBeenCalled();
    expect(model.openDocsPage).not.toHaveBeenCalled();
  });

  it('routes non-journey URLs to openDocsPage', () => {
    const model = makeModel();
    renderHook(() => useAutoOpenListener(model));

    dispatchAutoOpen({ url: 'https://grafana.com/docs/grafana/latest/', title: 'Docs', source: 'recommender' });

    expect(model.openDocsPage).toHaveBeenCalledWith('https://grafana.com/docs/grafana/latest/', 'Docs', {
      source: 'recommender',
    });
    expect(model.openLearningJourney).not.toHaveBeenCalled();
  });

  it('coerces unknown source strings to undefined (boundary safety)', () => {
    const model = makeModel();
    renderHook(() => useAutoOpenListener(model));

    dispatchAutoOpen({ url: 'https://grafana.com/docs/foo', title: 'Foo', source: 'not-a-real-source' });

    expect(model.openDocsPage).toHaveBeenCalledWith('https://grafana.com/docs/foo', 'Foo', { source: undefined });
  });

  it('flushes queued links via setTimeout(..., 0) AFTER addEventListener (H2 ordering)', () => {
    const model = makeModel();

    // processQueuedLinks must not have been called synchronously during the
    // hook setup — it is deferred to the next tick so the listener is
    // registered first.
    renderHook(() => useAutoOpenListener(model));
    expect(processQueuedLinksSpy).not.toHaveBeenCalled();

    // After the timer fires, the queue flush runs.
    act(() => {
      jest.advanceTimersByTime(0);
    });
    expect(processQueuedLinksSpy).toHaveBeenCalledTimes(1);
  });

  it('removes the listener on unmount', () => {
    const model = makeModel();
    const removeSpy = jest.spyOn(document, 'removeEventListener');
    const { unmount } = renderHook(() => useAutoOpenListener(model));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('pathfinder-auto-open-docs', expect.any(Function));
    removeSpy.mockRestore();
  });
});
