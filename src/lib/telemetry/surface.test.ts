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

  it('falls back to the DOM/localStorage read until a surface is reported', () => {
    const surface = freshSurface();
    expect(surface.getPathfinderSurface()).toBe('closed');

    localStorage.setItem('grafana-pathfinder-app-panel-mode', 'floating');
    expect(surface.getPathfinderSurface()).toBe('floating');
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
