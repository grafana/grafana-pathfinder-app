/**
 * #1450 — the auto-open listener must be live on WHATEVER surface owns the
 * display, and exactly one surface may act on a given event.
 *
 * `AUTO_OPEN_DOCS_EVENT` is fire-and-forget. Before #1450 only the sidebar
 * listened, so an intercepted docs-link click while the floating or full-screen
 * panel owned the surface was dispatched into the void — the click did nothing.
 * The fix mounts `useAutoOpenListener` on all three surfaces, mode-gated to the
 * surface each instance belongs to, so a dock-back (both surfaces briefly
 * mounted) can't double-open the tab.
 */
import { renderHook, act } from '@testing-library/react';
import { useAutoOpenListener } from './useAutoOpenListener';
import { linkInterceptionState } from '../../../global-state/link-interception';
import { type PanelMode } from '../../../global-state/panel-mode';
import { StorageKeys } from '../../../lib/storage-keys';
import type { DocsPanelModelOperations } from '../types';

function makeModel(): DocsPanelModelOperations {
  return {
    openLearningJourney: jest.fn(),
    openDocsPage: jest.fn(),
  } as unknown as DocsPanelModelOperations;
}

function setMode(mode: PanelMode) {
  localStorage.setItem(StorageKeys.PANEL_MODE, mode);
}

function dispatchAutoOpen(detail: Record<string, unknown>) {
  act(() => {
    document.dispatchEvent(new CustomEvent('pathfinder-auto-open-docs', { detail }));
  });
}

const DOC = { url: 'https://grafana.com/docs/grafana/latest/', title: 'Docs' };

describe('useAutoOpenListener surface ownership (#1450)', () => {
  let processQueuedLinksSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    processQueuedLinksSpy = jest.spyOn(linkInterceptionState, 'processQueuedLinks').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    processQueuedLinksSpy.mockRestore();
    localStorage.clear();
  });

  it('the floating listener opens an intercepted link when floating owns the surface', () => {
    setMode('floating');
    const model = makeModel();
    renderHook(() => useAutoOpenListener(model, 'floating'));

    dispatchAutoOpen({ ...DOC, source: 'link_interception' });

    expect(model.openDocsPage).toHaveBeenCalledWith(DOC.url, DOC.title, { source: 'link_interception' });
  });

  it('the full-screen listener opens an intercepted link when full screen owns the surface', () => {
    setMode('fullscreen');
    const model = makeModel();
    renderHook(() => useAutoOpenListener(model, 'fullscreen'));

    dispatchAutoOpen({ ...DOC, source: 'link_interception' });

    expect(model.openDocsPage).toHaveBeenCalledWith(DOC.url, DOC.title, { source: 'link_interception' });
  });

  it('a listener ignores events when it is not the current surface (mode-gate)', () => {
    setMode('floating');
    const sidebarModel = makeModel();
    renderHook(() => useAutoOpenListener(sidebarModel, 'sidebar'));

    dispatchAutoOpen({ ...DOC, source: 'link_interception' });

    expect(sidebarModel.openDocsPage).not.toHaveBeenCalled();
  });

  it('during a dock-back overlap, exactly one surface handles the event', () => {
    // Both the tearing-down sidebar listener and the incoming floating listener
    // are mounted at once; the live mode is 'floating'. Only the floating model
    // must open the tab — no double-open across two models.
    setMode('floating');
    const sidebarModel = makeModel();
    const floatingModel = makeModel();
    renderHook(() => useAutoOpenListener(sidebarModel, 'sidebar'));
    renderHook(() => useAutoOpenListener(floatingModel, 'floating'));

    dispatchAutoOpen({ ...DOC, source: 'queued_link' });

    expect(floatingModel.openDocsPage).toHaveBeenCalledTimes(1);
    expect(sidebarModel.openDocsPage).not.toHaveBeenCalled();
  });
});
