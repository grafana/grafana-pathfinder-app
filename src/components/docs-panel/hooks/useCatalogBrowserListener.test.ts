import { act, renderHook, waitFor } from '@testing-library/react';
import { config } from '@grafana/runtime';
import { useCatalogBrowserListener } from './useCatalogBrowserListener';
import {
  cancelCatalogActivation,
  getCatalogActivation,
  requestCatalogActivation,
} from '../../../global-state/package-browser';
import { panelModeManager, type PanelMode } from '../../../global-state/panel-mode';
import { OPEN_CATALOG_BROWSER_EVENT } from '../../../lib/event-names';

jest.mock('@grafana/runtime', () => ({ config: { namespace: 'org-a', bootData: { user: { orgId: 1, id: 2 } } } }));
jest.mock('../../../global-state/panel-mode', () => ({ panelModeManager: { getMode: jest.fn() } }));

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((finish) => {
    resolve = () => finish();
  });
  return { promise, resolve };
}

function openEvent() {
  document.dispatchEvent(new CustomEvent(OPEN_CATALOG_BROWSER_EVENT, { detail: { tabId: 'browse' } }));
}

beforeEach(() => {
  jest.clearAllMocks();
  cancelCatalogActivation();
  config.namespace = 'org-a';
  jest.mocked(panelModeManager.getMode).mockReturnValue('sidebar');
});

it('waits for in-flight restoration before consuming the cold sidebar intent', async () => {
  const restore = deferred();
  const model = { restoreTabsAsync: jest.fn(() => restore.promise), setActiveTab: jest.fn() };
  requestCatalogActivation('org-a:1:2');
  renderHook(() => useCatalogBrowserListener(model, 'sidebar'));
  expect(model.restoreTabsAsync).toHaveBeenCalledTimes(1);
  expect(model.setActiveTab).not.toHaveBeenCalled();
  expect(getCatalogActivation('org-a:1:2')).not.toBeNull();
  await act(async () => restore.resolve());
  expect(model.setActiveTab).toHaveBeenCalledWith('browse');
  expect(getCatalogActivation('org-a:1:2')).toBeNull();
});

it('consumes a genuine activation once even if repeated events race during restore', async () => {
  const restore = deferred();
  const model = { restoreTabsAsync: jest.fn(() => restore.promise), setActiveTab: jest.fn() };
  renderHook(() => useCatalogBrowserListener(model, 'sidebar'));
  requestCatalogActivation('org-a:1:2');
  act(() => {
    openEvent();
    openEvent();
  });
  await act(async () => restore.resolve());
  expect(model.setActiveTab).toHaveBeenCalledTimes(1);
  act(openEvent);
  expect(model.setActiveTab).toHaveBeenCalledTimes(1);
});

it('ignores forged public activation events that have no module-owned intent', () => {
  const model = { restoreTabsAsync: jest.fn().mockResolvedValue(undefined), setActiveTab: jest.fn() };
  renderHook(() => useCatalogBrowserListener(model, 'sidebar'));
  act(openEvent);
  expect(model.restoreTabsAsync).not.toHaveBeenCalled();
  expect(model.setActiveTab).not.toHaveBeenCalled();
});

it.each(['floating', 'fullscreen'] as const)('does not consume pending Browse from the %s model', (mode) => {
  const model = { restoreTabsAsync: jest.fn().mockResolvedValue(undefined), setActiveTab: jest.fn() };
  requestCatalogActivation('org-a:1:2');
  renderHook(() => useCatalogBrowserListener(model, mode));
  act(openEvent);
  expect(model.restoreTabsAsync).not.toHaveBeenCalled();
  expect(getCatalogActivation('org-a:1:2')).not.toBeNull();
});

it.each(['unmount', 'mode-change', 'scope-change', 'manual-cancel'] as const)(
  'suppresses late activation after %s during restoration',
  async (condition) => {
    const restore = deferred();
    const model = { restoreTabsAsync: jest.fn(() => restore.promise), setActiveTab: jest.fn() };
    requestCatalogActivation('org-a:1:2');
    const { unmount, rerender } = renderHook(
      ({ mode }: { mode: PanelMode }) => useCatalogBrowserListener(model, mode),
      {
        initialProps: { mode: 'sidebar' },
      }
    );
    if (condition === 'unmount') {
      unmount();
    } else if (condition === 'mode-change') {
      jest.mocked(panelModeManager.getMode).mockReturnValue('floating');
      rerender({ mode: 'floating' });
    } else if (condition === 'scope-change') {
      config.namespace = 'org-b';
    } else {
      cancelCatalogActivation();
    }
    await act(async () => restore.resolve());
    expect(model.setActiveTab).not.toHaveBeenCalled();
  }
);

it('only lets the latest requested activation select Browse', async () => {
  const first = deferred();
  const second = deferred();
  const model = {
    restoreTabsAsync: jest.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
    setActiveTab: jest.fn(),
  };
  requestCatalogActivation('org-a:1:2');
  renderHook(() => useCatalogBrowserListener(model, 'sidebar'));
  requestCatalogActivation('org-a:1:2');
  act(openEvent);
  await act(async () => first.resolve());
  expect(model.setActiveTab).not.toHaveBeenCalled();
  await act(async () => second.resolve());
  await waitFor(() => expect(model.setActiveTab).toHaveBeenCalledTimes(1));
});

it('keeps the intent available for retry after restoration fails', async () => {
  const model = {
    restoreTabsAsync: jest.fn().mockRejectedValueOnce(new Error('storage unavailable')).mockResolvedValue(undefined),
    setActiveTab: jest.fn(),
  };
  requestCatalogActivation('org-a:1:2');
  renderHook(() => useCatalogBrowserListener(model, 'sidebar'));
  await act(async () => Promise.resolve());
  expect(model.setActiveTab).not.toHaveBeenCalled();
  expect(getCatalogActivation('org-a:1:2')).not.toBeNull();
  act(openEvent);
  await waitFor(() => expect(model.setActiveTab).toHaveBeenCalledWith('browse'));
});
