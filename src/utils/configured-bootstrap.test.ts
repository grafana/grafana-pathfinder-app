import { getConfigWithDefaults } from '../constants';
import { initializeConfiguredSurfaces } from './configured-bootstrap';

function effects() {
  return {
    applySettings: jest.fn(),
    mountController: jest.fn(),
    mountExecutor: jest.fn(),
    mountKiosk: jest.fn(),
    setupAutoOpen: jest.fn(),
  };
}

const live = { pathfinderEnabled: true, controllerRequested: false, hasDoc: false };

describe('configured bootstrap', () => {
  it('waits for authoritative settings before mounting anything', async () => {
    const calls = effects();
    let resolve!: (value: ReturnType<typeof getConfigWithDefaults>) => void;
    const pending = new Promise<ReturnType<typeof getConfigWithDefaults>>((done) => {
      resolve = done;
    });
    const initialized = initializeConfiguredSurfaces(pending, live, calls);
    expect(Object.values(calls).every((call) => call.mock.calls.length === 0)).toBe(true);

    const authoritative = getConfigWithDefaults({
      enableTwoTabController: true,
      enableKioskMode: true,
      openPanelOnLaunch: true,
    });
    resolve(authoritative);
    await initialized;

    expect(calls.mountExecutor).toHaveBeenCalledWith(authoritative);
    expect(calls.mountKiosk).toHaveBeenCalledWith(authoritative);
    expect(calls.setupAutoOpen).toHaveBeenCalledWith(authoritative);
  });

  it('uses authoritative off values even when an earlier metadata snapshot enabled every surface', async () => {
    const stale = getConfigWithDefaults({
      enableTwoTabController: true,
      enableKioskMode: true,
      openPanelOnLaunch: true,
    });
    const authoritative = { ...stale, enableTwoTabController: false, enableKioskMode: false, openPanelOnLaunch: false };
    const calls = effects();
    await initializeConfiguredSurfaces(Promise.resolve(authoritative), live, calls);

    expect(calls.mountController).not.toHaveBeenCalled();
    expect(calls.mountExecutor).not.toHaveBeenCalled();
    expect(calls.mountKiosk).not.toHaveBeenCalled();
    expect(calls.setupAutoOpen).toHaveBeenCalledWith(expect.objectContaining({ openPanelOnLaunch: false }));
  });

  it.each([false, true])('isolates a controller request with controller setting %s', async (enabled) => {
    const calls = effects();
    await initializeConfiguredSurfaces(
      Promise.resolve(
        getConfigWithDefaults({ enableTwoTabController: enabled, enableKioskMode: true, openPanelOnLaunch: true })
      ),
      { ...live, controllerRequested: true, hasDoc: true },
      calls
    );
    expect(calls.mountController).toHaveBeenCalledTimes(enabled ? 1 : 0);
    expect(calls.mountExecutor).not.toHaveBeenCalled();
    expect(calls.mountKiosk).not.toHaveBeenCalled();
    expect(calls.setupAutoOpen).not.toHaveBeenCalled();
  });

  it('leaves doc deep links in charge of opening their own surface', async () => {
    const calls = effects();
    await initializeConfiguredSurfaces(
      Promise.resolve(getConfigWithDefaults({ enableKioskMode: true })),
      { ...live, hasDoc: true },
      calls
    );
    expect(calls.mountKiosk).not.toHaveBeenCalled();
    expect(calls.setupAutoOpen).not.toHaveBeenCalled();
  });

  it('fails closed when settings cannot be read', async () => {
    const calls = effects();
    await initializeConfiguredSurfaces(Promise.resolve(undefined), live, calls);
    expect(Object.values(calls).every((call) => call.mock.calls.length === 0)).toBe(true);
  });

  it('preserves the system kill switch over all enabled tenant settings', async () => {
    const calls = effects();
    await initializeConfiguredSurfaces(
      Promise.resolve(getConfigWithDefaults({ enableTwoTabController: true, enableKioskMode: true })),
      { ...live, pathfinderEnabled: false },
      calls
    );
    expect(calls.applySettings).toHaveBeenCalledTimes(1);
    expect(calls.mountController).not.toHaveBeenCalled();
    expect(calls.mountExecutor).not.toHaveBeenCalled();
    expect(calls.mountKiosk).not.toHaveBeenCalled();
    expect(calls.setupAutoOpen).not.toHaveBeenCalled();
  });
});
