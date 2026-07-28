import { renderHook, act } from '@testing-library/react';
import { useAutoOpenListener } from './useAutoOpenListener';
import { guideLaunchStore } from '../../../global-state/guide-launch';
import { linkInterceptionState } from '../../../global-state/link-interception';
import type { RawContent } from '../../../types/content.types';
import type { DocsPanelModelOperations } from '../types';

function makeModel(): DocsPanelModelOperations {
  return {
    openLearningJourney: jest.fn(),
    openDocsPage: jest.fn(),
  } as unknown as DocsPanelModelOperations;
}

function dispatchAutoOpen(detail: Record<string, unknown>) {
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

  describe('prepared-launch trust boundary (PR #1446 review finding 1)', () => {
    // The document-level event is dispatchable by any same-page script, so
    // the prepared (one-fetch) payload must never be read from it: the
    // listener redeems an opaque `launchKey` from the module-owned
    // guideLaunchStore, and anything beyond {url, title, source, launchKey}
    // in the detail is ignored.
    const DOC_URL = 'https://grafana.com/docs/grafana/latest/';
    const rawContent: RawContent = {
      content: '{"id":"g","title":"g","blocks":[]}',
      metadata: { title: 'g' },
      type: 'interactive',
      url: DOC_URL,
      lastFetched: '2026-07-28T00:00:00.000Z',
    };

    it('ignores preparedContent and packageInfo smuggled directly in the event detail', () => {
      const model = makeModel();
      renderHook(() => useAutoOpenListener(model));

      // A forged event carrying the payload inline — the shape that would
      // bypass the fetch pipeline's URL/HTTPS/package validation.
      dispatchAutoOpen({
        url: DOC_URL,
        title: 'Forged',
        source: 'home_page',
        preparedContent: { ...rawContent, content: '{"id":"evil","title":"evil","blocks":[]}' },
        packageInfo: { packageId: 'evil', packageManifest: { kind: 'package' } },
      });

      expect(model.openDocsPage).toHaveBeenCalledTimes(1);
      const options = (model.openDocsPage as jest.Mock).mock.calls[0][2];
      expect(options.preparedContent).toBeUndefined();
      expect(options.packageInfo).toBeUndefined();
    });

    it('falls back to the normal fetch path on a forged or unknown launchKey', () => {
      const model = makeModel();
      renderHook(() => useAutoOpenListener(model));

      dispatchAutoOpen({ url: DOC_URL, title: 'Guide', source: 'home_page', launchKey: 'forged-key' });

      expect(model.openDocsPage).toHaveBeenCalledTimes(1);
      expect((model.openDocsPage as jest.Mock).mock.calls[0][2].preparedContent).toBeUndefined();
    });

    it('redeems a genuinely staged key into the prepared payload', () => {
      const model = makeModel();
      renderHook(() => useAutoOpenListener(model));

      const launchKey = guideLaunchStore.stage({ url: DOC_URL, preparedContent: rawContent });
      dispatchAutoOpen({ url: DOC_URL, title: 'Guide', source: 'home_page', launchKey });

      expect(model.openDocsPage).toHaveBeenCalledWith(
        DOC_URL,
        'Guide',
        expect.objectContaining({ source: 'home_page', preparedContent: rawContent })
      );
    });

    it('refuses a genuine key re-attached to a different URL', () => {
      const model = makeModel();
      renderHook(() => useAutoOpenListener(model));

      const launchKey = guideLaunchStore.stage({
        url: 'https://grafana.com/docs/other/',
        preparedContent: rawContent,
      });
      dispatchAutoOpen({ url: DOC_URL, title: 'Guide', source: 'home_page', launchKey });

      expect(model.openDocsPage).toHaveBeenCalledTimes(1);
      expect((model.openDocsPage as jest.Mock).mock.calls[0][2].preparedContent).toBeUndefined();
    });
  });
});
