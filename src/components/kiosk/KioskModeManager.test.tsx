import React from 'react';
import { locationService } from '@grafana/runtime';
import { render, act, screen, waitFor } from '@testing-library/react';
import { kioskState } from '../../global-state/kiosk';
import { KioskModeManager } from './KioskModeManager';
import { reportPathfinderSurface, reportPathfinderSurfaceClosed } from '../../lib/telemetry/surface';
import { loadTranslatedModule } from '../../lib/plugin-translations';
import { prepareKioskData, type PreparedKioskData } from './kiosk-rules';
import { retryChunkImport } from '../../lib/retry-chunk-import';

const mockOverlay = jest.fn();
const mockOverlayUnmount = jest.fn();
const mockOverlayMount = jest.fn();
jest.mock('../../lib/retry-chunk-import', () => ({
  retryChunkImport: jest.fn((load: () => Promise<unknown>) => load()),
}));

import { sidebarState } from '../../global-state/sidebar';

jest.mock('./kiosk-rules', () => ({ prepareKioskData: jest.fn(() => new Promise(() => {})) }));

jest.mock('../../lib/plugin-translations', () => ({
  loadTranslatedModule: jest.fn(async (load: () => Promise<unknown>) => load()),
}));

jest.mock('../../lib/telemetry/surface', () => ({
  reportPathfinderSurface: jest.fn(),
  reportPathfinderSurfaceClosed: jest.fn(),
}));

jest.mock('../../global-state/sidebar', () => ({
  sidebarState: { getIsSidebarMounted: jest.fn(() => false) },
}));

jest.mock('./KioskOverlay', () => ({
  KioskOverlay: (props: {
    onClose: () => void;
    overrideUrl?: string;
    rulesUrl: string;
    catalog: Promise<PreparedKioskData>;
  }) => {
    React.useEffect(() => {
      mockOverlayMount();
      return mockOverlayUnmount;
    }, []);
    mockOverlay(props);
    return require('react-dom').createPortal(
      <button data-testid="close-overlay" onClick={props.onClose}>
        {props.overrideUrl || props.rulesUrl}
      </button>,
      document.body
    );
  },
}));

describe('KioskModeManager', () => {
  beforeEach(() => {
    kioskState.set(null);
    window.history.replaceState({}, '', '/');
    jest.clearAllMocks();
    (sidebarState.getIsSidebarMounted as jest.Mock).mockReturnValue(false);
  });

  it('does not report the kiosk surface merely by mounting', () => {
    render(<KioskModeManager rulesUrl="https://example.com/rules.json" />);
    expect(reportPathfinderSurface).not.toHaveBeenCalled();
    expect(loadTranslatedModule).not.toHaveBeenCalled();
    expect(prepareKioskData).not.toHaveBeenCalled();
  });

  it('reports the kiosk surface only when the overlay is actually opened', async () => {
    render(<KioskModeManager rulesUrl="https://example.com/rules.json" />);

    act(() => {
      document.dispatchEvent(new CustomEvent('pathfinder-open-kiosk'));
    });

    await screen.findByTestId('close-overlay');
    expect(reportPathfinderSurface).toHaveBeenCalledWith('kiosk');
  });

  it('reports the surface closed when the overlay closes', async () => {
    const { getByTestId } = render(<KioskModeManager rulesUrl="https://example.com/rules.json" />);

    act(() => {
      document.dispatchEvent(new CustomEvent('pathfinder-open-kiosk'));
    });

    await screen.findByTestId('close-overlay');
    act(() => {
      getByTestId('close-overlay').click();
    });

    expect(reportPathfinderSurfaceClosed).toHaveBeenCalledWith('kiosk');
  });

  it('returns to the sidebar surface when the sidebar remains mounted', async () => {
    (sidebarState.getIsSidebarMounted as jest.Mock).mockReturnValue(true);
    const { getByTestId } = render(<KioskModeManager rulesUrl="https://example.com/rules.json" />);

    act(() => {
      document.dispatchEvent(new CustomEvent('pathfinder-open-kiosk'));
    });
    await screen.findByTestId('close-overlay');
    act(() => {
      getByTestId('close-overlay').click();
    });

    expect(reportPathfinderSurface).toHaveBeenLastCalledWith('sidebar');
    expect(reportPathfinderSurfaceClosed).not.toHaveBeenCalled();
  });
  it('opens a URL request received before mounting and clears it on close', async () => {
    window.history.replaceState(
      { retained: true },
      '',
      '/?pathfinderKiosk=1&kioskRulesUrl=override&kiosk=tv&orgId=1#anchor'
    );
    locationService.replace({
      pathname: '/',
      search: window.location.search,
      hash: window.location.hash,
      state: { retained: true },
    });
    kioskState.set({ source: 'url', rulesUrl: 'override' });
    const { getByTestId, queryByTestId } = render(<KioskModeManager rulesUrl="default" />);
    expect(await screen.findByTestId('close-overlay')).toHaveTextContent('override');
    act(() => getByTestId('close-overlay').click());
    expect(queryByTestId('close-overlay')).toBeNull();
    expect(locationService.getLocation().search).toBe('?kiosk=tv&orgId=1');
    expect(locationService.getLocation().hash).toBe('#anchor');
    expect(locationService.getLocation().state).toEqual({ retained: true });
    act(() => document.dispatchEvent(new CustomEvent('pathfinder-open-kiosk')));
    expect(await screen.findByTestId('close-overlay')).toHaveTextContent('default');
  });

  it('switches selection without reporting another surface open', async () => {
    kioskState.set({ source: 'url', rulesUrl: 'first' });
    render(<KioskModeManager rulesUrl="default" />);
    act(() => kioskState.set({ source: 'url', rulesUrl: 'second' }));
    expect(await screen.findByTestId('close-overlay')).toHaveTextContent('second');
    expect(reportPathfinderSurface).toHaveBeenCalledTimes(1);
  });
});

it('renders the view while the catalog is pending and aborts on close', async () => {
  kioskState.set({ source: 'url', rulesUrl: 'selected' });
  const { unmount } = render(<KioskModeManager rulesUrl="default" />);
  await screen.findByTestId('close-overlay');
  expect(prepareKioskData).toHaveBeenCalledWith('default', 'selected', expect.any(AbortSignal));
  const signal = jest.mocked(prepareKioskData).mock.calls.at(-1)![2]!;
  expect(signal.aborted).toBe(false);
  unmount();
  expect(signal.aborted).toBe(true);
  kioskState.set(null);
});

it('passes the catalog promise to the overlay before the rules chunk finishes', async () => {
  let finish!: (value: typeof import('./kiosk-rules')) => void;
  jest.mocked(retryChunkImport).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  kioskState.set({ source: 'sidebar' });
  const { unmount } = render(<KioskModeManager rulesUrl="default" />);
  await screen.findByTestId('close-overlay');
  const catalog = mockOverlay.mock.calls.at(-1)![0].catalog;
  const data = { rules: [] } as unknown as PreparedKioskData;
  jest.mocked(prepareKioskData).mockResolvedValueOnce(data);
  await act(async () => finish({ prepareKioskData } as typeof import('./kiosk-rules')));
  await expect(catalog).resolves.toBe(data);
  unmount();
  kioskState.set(null);
});

it('replaces the catalog and aborts the previous request when the launch or rules URL changes', async () => {
  kioskState.set({ source: 'url', rulesUrl: 'first' });
  const view = render(<KioskModeManager rulesUrl="default" />);
  await screen.findByTestId('close-overlay');
  const mounts = mockOverlayMount.mock.calls.length;
  const unmounts = mockOverlayUnmount.mock.calls.length;
  const first = mockOverlay.mock.calls.at(-1)![0].catalog;
  const signal = jest.mocked(prepareKioskData).mock.calls.at(-1)![2]!;
  act(() => kioskState.set({ source: 'url', rulesUrl: 'second' }));
  await waitFor(() => expect(prepareKioskData).toHaveBeenLastCalledWith('default', 'second', expect.any(AbortSignal)));
  expect(signal.aborted).toBe(true);
  const second = mockOverlay.mock.calls.at(-1)![0].catalog;
  expect(second).not.toBe(first);
  view.rerender(<KioskModeManager rulesUrl="changed" />);
  await waitFor(() => expect(prepareKioskData).toHaveBeenLastCalledWith('changed', 'second', expect.any(AbortSignal)));
  expect(mockOverlay.mock.calls.at(-1)![0].catalog).not.toBe(second);
  expect(mockOverlayMount).toHaveBeenCalledTimes(mounts);
  expect(mockOverlayUnmount).toHaveBeenCalledTimes(unmounts);
  view.unmount();
  kioskState.set(null);
});

it('passes a failed rules import to the overlay error path', async () => {
  const error = new Error('rules chunk unavailable');
  jest.mocked(retryChunkImport).mockRejectedValueOnce(error);
  kioskState.set({ source: 'sidebar' });
  const { unmount } = render(<KioskModeManager rulesUrl="default" />);
  await act(async () => {});
  await expect(mockOverlay.mock.calls.at(-1)![0].catalog).rejects.toBe(error);
  unmount();
  kioskState.set(null);
});

function isolatedManager() {
  let isolated!: {
    KioskModeManager: typeof KioskModeManager;
    kioskState: typeof kioskState;
    loadTranslatedModule: jest.MockedFunction<typeof loadTranslatedModule>;
    locationService: typeof locationService;
  };
  jest.isolateModules(() => {
    jest.doMock('react', () => React);
    isolated = {
      KioskModeManager: require('./KioskModeManager').KioskModeManager,
      kioskState: require('../../global-state/kiosk').kioskState,
      loadTranslatedModule: require('../../lib/plugin-translations').loadTranslatedModule,
      locationService: require('@grafana/runtime').locationService,
    };
  });
  return isolated;
}

it.each(['Close', 'Escape'] as const)(
  'closes a URL launch with %s after the view fails to load and clears its parameters',
  async (exit) => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      window.history.replaceState({}, '', '/?pathfinderKiosk=1&kioskRulesUrl=override&orgId=1');
      const isolated = isolatedManager();
      isolated.locationService.replace({ pathname: '/', search: window.location.search });
      isolated.loadTranslatedModule.mockRejectedValueOnce(new Error('overlay chunk unavailable'));
      isolated.kioskState.set({ source: 'url', rulesUrl: 'override' });
      render(<isolated.KioskModeManager rulesUrl="default" />);
      const close = await screen.findByRole('button', { name: 'Close' });
      if (exit === 'Close') {
        act(() => close.click());
      } else {
        act(() => {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
      }
      expect(isolated.kioskState.getSnapshot()).toBeNull();
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
      expect(isolated.locationService.getLocation().search).toBe('?orgId=1');
    } finally {
      consoleError.mockRestore();
    }
  }
);

it('closes with an already prevented Escape while the view is still loading', async () => {
  const isolated = isolatedManager();
  isolated.loadTranslatedModule.mockImplementationOnce(() => new Promise(() => {}));
  isolated.kioskState.set({ source: 'sidebar' });
  render(<isolated.KioskModeManager rulesUrl="default" />);
  expect(await screen.findByText('Loading interactive learning')).toBeInTheDocument();
  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  escape.preventDefault();
  act(() => {
    document.dispatchEvent(escape);
  });
  expect(isolated.kioskState.getSnapshot()).toBeNull();
  expect(screen.queryByText('Loading interactive learning')).toBeNull();
});

it('keeps a loading-view Escape from reaching Grafana key bindings', async () => {
  const grafanaEscape = jest.fn();
  document.addEventListener('keydown', grafanaEscape);
  try {
    const isolated = isolatedManager();
    isolated.loadTranslatedModule.mockImplementationOnce(() => new Promise(() => {}));
    isolated.kioskState.set({ source: 'sidebar' });
    render(<isolated.KioskModeManager rulesUrl="default" />);
    await screen.findByText('Loading interactive learning');
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      document.dispatchEvent(escape);
    });
    expect(isolated.kioskState.getSnapshot()).toBeNull();
    expect(escape.defaultPrevented).toBe(true);
    expect(grafanaEscape).not.toHaveBeenCalled();
  } finally {
    document.removeEventListener('keydown', grafanaEscape);
  }
});

it('leaves Escape to the loaded view', async () => {
  kioskState.set({ source: 'sidebar' });
  render(<KioskModeManager rulesUrl="default" />);
  await screen.findByTestId('close-overlay');
  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  act(() => {
    document.dispatchEvent(escape);
  });
  expect(kioskState.getSnapshot()).not.toBeNull();
  expect(escape.defaultPrevented).toBe(false);
  act(() => kioskState.set(null));
});

it('gives each launch its own pending catalog', async () => {
  jest.mocked(retryChunkImport).mockImplementation(() => new Promise(() => {}));
  try {
    const first = { source: 'sidebar' } as const;
    kioskState.set(first);
    const view = render(<KioskModeManager rulesUrl="default" />);
    await screen.findByTestId('close-overlay');
    const firstPending = mockOverlay.mock.calls[0][0].catalog;
    act(() => kioskState.set(null));
    mockOverlay.mockClear();
    act(() => kioskState.set({ source: 'sidebar' }));
    await screen.findByTestId('close-overlay');
    expect(mockOverlay.mock.calls[0][0].catalog).not.toBe(firstPending);
    view.unmount();
  } finally {
    jest.mocked(retryChunkImport).mockImplementation((load: () => Promise<unknown>) => load());
    kioskState.set(null);
  }
});
