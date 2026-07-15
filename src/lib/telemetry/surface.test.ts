// Module state (the reported surface) persists per registry — isolate each test.
function freshSurface(): typeof import('./surface') {
  jest.resetModules();
  return require('./surface');
}

describe('surface owner', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('falls back to the DOM/localStorage read until a surface is reported', () => {
    localStorage.setItem('grafana-pathfinder-app-panel-mode', 'floating');
    const surface = freshSurface();
    expect(surface.getPathfinderSurface()).toBe('floating');
  });

  it('performs the cold read once and answers subsequent calls from the latch', () => {
    const surface = freshSurface();
    const getItem = jest.spyOn(Storage.prototype, 'getItem');
    const querySelector = jest.spyOn(document, 'querySelector');

    expect(surface.getPathfinderSurface()).toBe('closed');
    const storageReads = getItem.mock.calls.length;
    const domQueries = querySelector.mock.calls.length;
    expect(storageReads).toBeGreaterThan(0);

    surface.getPathfinderSurface();
    surface.isPathfinderOpen();
    expect(getItem).toHaveBeenCalledTimes(storageReads);
    expect(querySelector).toHaveBeenCalledTimes(domQueries);
  });

  it('latches the cold read: an out-of-band localStorage write is not re-read, only a report supersedes it', () => {
    const surface = freshSurface();
    expect(surface.getPathfinderSurface()).toBe('closed');

    // Cross-tab writes land without a report; same-tab opens always report
    // (setMode / sidebar mount / kiosk open), so the report path suffices.
    localStorage.setItem('grafana-pathfinder-app-panel-mode', 'floating');
    expect(surface.getPathfinderSurface()).toBe('closed');
    expect(surface.isPathfinderOpen()).toBe(false);

    surface.reportPathfinderSurface('floating');
    expect(surface.getPathfinderSurface()).toBe('floating');
    expect(surface.isPathfinderOpen()).toBe(true);
  });

  it('notifies listeners on the first report even when it matches the latched cold value', () => {
    localStorage.setItem('grafana-pathfinder-app-panel-mode', 'floating');
    const surface = freshSurface();
    expect(surface.getPathfinderSurface()).toBe('floating');

    const listener = jest.fn();
    surface.onPathfinderSurfaceChange(listener);
    surface.reportPathfinderSurface('floating');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('floating');
  });

  it('double init: a second consumer cold-reading after the latch sees the latched value, not the changed DOM', () => {
    const surface = freshSurface();
    expect(surface.isPathfinderOpen()).toBe(false);

    const el = document.createElement('div');
    el.id = 'pathfinder-controller-root';
    document.body.appendChild(el);
    expect(surface.getPathfinderSurface()).toBe('closed');

    surface.reportPathfinderSurface('controller');
    expect(surface.getPathfinderSurface()).toBe('controller');
  });

  it('cold-read fallback requires the visible kiosk overlay, not just its persistent mount root', () => {
    const root = document.createElement('div');
    root.id = 'pathfinder-kiosk-root';
    document.body.appendChild(root);
    // The manager root mounts once kiosk mode is config-enabled and stays
    // in the DOM whether or not the overlay is actually open.
    expect(freshSurface().getPathfinderSurface()).toBe('closed');

    const overlay = document.createElement('div');
    overlay.setAttribute('data-testid', 'kiosk-mode-overlay');
    root.appendChild(overlay);
    expect(freshSurface().getPathfinderSurface()).toBe('kiosk');
  });

  it('prefers the reported surface over the cold-read fallback', () => {
    const surface = freshSurface();
    localStorage.setItem('grafana-pathfinder-app-panel-mode', 'floating');

    surface.reportPathfinderSurface('sidebar');
    expect(surface.getPathfinderSurface()).toBe('sidebar');
  });

  it('notifies subscribers once per change and dedupes repeats', () => {
    const surface = freshSurface();
    const listener = jest.fn();
    surface.onPathfinderSurfaceChange(listener);

    surface.reportPathfinderSurface('kiosk');
    surface.reportPathfinderSurface('kiosk');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('kiosk');
  });

  it('guarded close only applies when the closing surface is still active', () => {
    const surface = freshSurface();

    surface.reportPathfinderSurface('sidebar');
    surface.reportPathfinderSurface('floating');
    // Stale sidebar unmount after a handoff — must not clobber floating.
    surface.reportPathfinderSurfaceClosed('sidebar');
    expect(surface.getPathfinderSurface()).toBe('floating');

    surface.reportPathfinderSurfaceClosed('floating');
    expect(surface.getPathfinderSurface()).toBe('closed');
  });

  it('unsubscribe stops notifications', () => {
    const surface = freshSurface();
    const listener = jest.fn();
    const unsubscribe = surface.onPathfinderSurfaceChange(listener);

    unsubscribe();
    surface.reportPathfinderSurface('fullscreen');
    expect(listener).not.toHaveBeenCalled();
  });

  it('swallows listener errors so telemetry cannot break surface reporting', () => {
    const surface = freshSurface();
    surface.onPathfinderSurfaceChange(() => {
      throw new Error('listener bug');
    });
    expect(() => surface.reportPathfinderSurface('kiosk')).not.toThrow();
  });

  it('registering the same listener reference twice still notifies it once per change', () => {
    const surface = freshSurface();
    const listener = jest.fn();
    surface.onPathfinderSurfaceChange(listener);
    surface.onPathfinderSurfaceChange(listener);

    surface.reportPathfinderSurface('sidebar');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('a second registration does not clobber or duplicate an existing subscriber', () => {
    const surface = freshSurface();
    const first = jest.fn();
    const second = jest.fn();
    surface.onPathfinderSurfaceChange(first);
    surface.onPathfinderSurfaceChange(second);

    surface.reportPathfinderSurface('floating');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
