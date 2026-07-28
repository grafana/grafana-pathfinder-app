/**
 * Cold-sidebar payload-relay boundary test (PR #1446 review finding 5).
 *
 * A prepared (one-fetch) launch from My Learning with the sidebar unmounted
 * crosses several independently owned seams:
 *
 *   HomePanel stage+queue → linkInterceptionState.processQueuedLinks →
 *   `pathfinder-auto-open-docs` → useAutoOpenListener → model open method
 *
 * Unit tests of each seam can all stay green while a handoff silently drops
 * the payload, so this test runs the REAL queue, REAL store, and REAL
 * listener (only the model is mocked) and asserts the staged payload
 * arrives intact with no network fetch along the way. The final hop —
 * the loader consuming `preparedContent` without calling `fetchContent` —
 * is pinned separately in `docs-panel.load-tab-content.test.ts`.
 */

import { renderHook, act } from '@testing-library/react';
import { useAutoOpenListener } from './useAutoOpenListener';
import { guideLaunchStore } from '../../../global-state/guide-launch';
import { linkInterceptionState } from '../../../global-state/link-interception';
import type { RawContent } from '../../../types/content.types';
import type { PackageOpenInfo } from '../../../types/content-panel.types';
import type { DocsPanelModelOperations } from '../types';

const DOC_URL = 'https://grafana.com/docs/grafana/latest/';

const preparedContent: RawContent = {
  content: '{"id":"g","title":"g","blocks":[]}',
  metadata: { title: 'g' },
  type: 'interactive',
  url: DOC_URL,
  lastFetched: '2026-07-28T00:00:00.000Z',
};

const packageInfo: PackageOpenInfo = { packageId: 'pkg-1', packageManifest: { kind: 'package' } };

function makeModel(): DocsPanelModelOperations {
  return {
    openLearningJourney: jest.fn(),
    openDocsPage: jest.fn(),
  } as unknown as DocsPanelModelOperations;
}

describe('cold-sidebar relay: queued prepared launch reaches the model intact', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // Drain anything a previous test left in the shared queue singleton.
    while (linkInterceptionState.hasQueuedLinks()) {
      linkInterceptionState.shiftFromQueue();
    }
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('delivers preparedContent and packageInfo through queue → drain → event → listener without a network fetch', () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    // 1. What HomePanel does when the sidebar is unmounted: stage the trusted
    //    payload, queue only the redeemable key.
    const launchKey = guideLaunchStore.stage({ url: DOC_URL, preparedContent, packageInfo });
    linkInterceptionState.addToQueue({ url: DOC_URL, title: 'Guide', timestamp: 0, launchKey });

    // 2. The sidebar mounts: the listener registers, then drains the queue on
    //    the next tick (the H2 ordering the hook deliberately preserves).
    const model = makeModel();
    renderHook(() => useAutoOpenListener(model));
    expect(model.openDocsPage).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(0);
    });

    // 3. The model receives the exact staged payload, once, with no fetch.
    expect(model.openDocsPage).toHaveBeenCalledTimes(1);
    expect(model.openDocsPage).toHaveBeenCalledWith(DOC_URL, 'Guide', {
      source: 'queued_link',
      preparedContent,
      packageInfo,
    });
    expect(model.openLearningJourney).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(linkInterceptionState.hasQueuedLinks()).toBe(false);
  });

  it('routes a queued journey URL through openLearningJourney with the payload intact', () => {
    const journeyUrl = 'https://grafana.com/docs/learning-journeys/intro/';
    const journeyContent = { ...preparedContent, url: journeyUrl };

    const launchKey = guideLaunchStore.stage({ url: journeyUrl, preparedContent: journeyContent });
    linkInterceptionState.addToQueue({ url: journeyUrl, title: 'Journey', timestamp: 0, launchKey });

    const model = makeModel();
    renderHook(() => useAutoOpenListener(model));
    act(() => {
      jest.advanceTimersByTime(0);
    });

    expect(model.openLearningJourney).toHaveBeenCalledWith(
      journeyUrl,
      'Journey',
      expect.objectContaining({ preparedContent: journeyContent })
    );
    expect(model.openDocsPage).not.toHaveBeenCalled();
  });

  it('a queued link without a key still opens — via the normal fetch path', () => {
    linkInterceptionState.addToQueue({ url: DOC_URL, title: 'Plain', timestamp: 0 });

    const model = makeModel();
    renderHook(() => useAutoOpenListener(model));
    act(() => {
      jest.advanceTimersByTime(0);
    });

    expect(model.openDocsPage).toHaveBeenCalledTimes(1);
    expect((model.openDocsPage as jest.Mock).mock.calls[0][2].preparedContent).toBeUndefined();
  });
});
