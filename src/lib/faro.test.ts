/**
 * jsdom's `window.location` (and its individual accessor properties) are
 * non-configurable, so tests fix the origin here instead of mocking hostname
 * per test. Only the `initFaro` gating tests below depend on this value —
 * `getEnvironment` takes hostname as an explicit argument and is tested
 * independently of the ambient location.
 *
 * @jest-environment-options {"url": "https://foo.grafana.net"}
 */
import type { TransportItem, APIEvent } from '@grafana/faro-web-sdk';

jest.mock('../../package.json', () => ({ name: 'grafana-pathfinder-app', version: '9.9.9-test' }));

const mockPushError = jest.fn();
const mockPushLog = jest.fn();
const mockActionEnd = jest.fn();
const mockStartUserAction = jest.fn(() => ({ name: 'x', parentId: 'x', end: mockActionEnd }));
const mockPause = jest.fn();
const mockFaroInstance = {
  api: { pushError: mockPushError, pushLog: mockPushLog, startUserAction: mockStartUserAction },
  pause: mockPause,
};
interface CapturedFaroConfig {
  isolate: boolean;
  app: { name: string; version: string; environment: string };
  sessionTracking: { samplingRate: number };
}

const mockInitializeFaro = jest.fn((_cfg: CapturedFaroConfig) => mockFaroInstance);

jest.mock('@grafana/faro-web-sdk', () => ({
  initializeFaro: (cfg: CapturedFaroConfig) => mockInitializeFaro(cfg),
  ErrorsInstrumentation: class ErrorsInstrumentation {},
  SessionInstrumentation: class SessionInstrumentation {},
  ViewInstrumentation: class ViewInstrumentation {},
}));

// A stable object reference, not a fresh literal per require: `freshFaro()`
// resets the module registry (so `./faro`'s internal init/instance state
// starts clean), and re-requiring this mock must keep resolving to the same
// `config` object so mutations made between tests are still visible.
const mockedConfig = {
  buildInfo: { env: 'production', version: '13.1.0' },
  bootData: { settings: { buildInfo: { versionString: 'Grafana Cloud' } } } as
    { settings: { buildInfo: { versionString: string } } } | undefined,
  analytics: { enabled: true } as { enabled: boolean } | undefined,
};

jest.mock('@grafana/runtime', () => ({ config: mockedConfig }));

// Loaded via `require`, not a static ES `import`: ES imports are evaluated
// before any of this file's own top-level statements, which would trigger
// the `@grafana/runtime` mock factory above before `mockedConfig` is
// assigned. Requiring here, after the assignment, avoids that ordering trap.
const {
  getEnvironment,
  isGrafanaCloud,
  filterPathfinderTelemetry,
  stringifyAttributes,
}: typeof import('./faro') = require('./faro');

function freshFaro(): typeof import('./faro') {
  jest.resetModules();
  return require('./faro');
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  mockedConfig.buildInfo = { env: 'production', version: '13.1.0' };
  mockedConfig.bootData = { settings: { buildInfo: { versionString: 'Grafana Cloud' } } };
  mockedConfig.analytics = { enabled: true };
});

describe('getEnvironment', () => {
  it('returns null for an unrecognized hostname in production', () => {
    expect(getEnvironment('my-oss-instance.example.com')).toBeNull();
  });

  it.each([
    ['foo.grafana-dev.net', 'dev'],
    ['foo.grafana-ops.net', 'ops'],
    ['foo.grafana.net', 'prod'],
    ['foo.grafana.com', 'prod'],
  ])('maps %s to %s', (hostname, expected) => {
    expect(getEnvironment(hostname)).toBe(expected);
  });

  it('returns null in a development build without the local override', () => {
    mockedConfig.buildInfo.env = 'development';
    expect(getEnvironment('foo.grafana.net')).toBeNull();
  });

  it('returns "local" in a development build with the override flag set', () => {
    mockedConfig.buildInfo.env = 'development';
    localStorage.setItem('pathfinder.faro.local', 'true');
    expect(getEnvironment('localhost')).toBe('local');
  });

  it('ignores the override flag outside a development build', () => {
    localStorage.setItem('pathfinder.faro.local', 'true');
    expect(getEnvironment('foo.grafana.net')).toBe('prod');
    expect(getEnvironment('localhost')).toBeNull();
  });
});

describe('isGrafanaCloud', () => {
  it('returns true when versionString starts with "Grafana Cloud"', () => {
    expect(isGrafanaCloud()).toBe(true);
  });

  it('returns false for a non-cloud versionString', () => {
    mockedConfig.bootData!.settings.buildInfo.versionString = 'Grafana Enterprise';
    expect(isGrafanaCloud()).toBe(false);
  });

  it('returns false when bootData is missing entirely', () => {
    mockedConfig.bootData = undefined;
    expect(isGrafanaCloud()).toBe(false);
  });
});

function exceptionItem(filenames: Array<string | undefined>): TransportItem<APIEvent> {
  return {
    type: 'exception',
    payload: {
      type: 'Error',
      value: 'boom',
      timestamp: new Date().toISOString(),
      stacktrace: { frames: filenames.map((filename) => ({ filename, function: 'fn' })) },
    },
    meta: {},
  } as unknown as TransportItem<APIEvent>;
}

function exceptionItemWithoutStacktrace(): TransportItem<APIEvent> {
  return {
    type: 'exception',
    payload: { type: 'Error', value: 'boom', timestamp: new Date().toISOString() },
    meta: {},
  } as unknown as TransportItem<APIEvent>;
}

function logItem(message: string): TransportItem<APIEvent> {
  return {
    type: 'log',
    payload: { message, level: 'error', timestamp: new Date().toISOString(), context: undefined },
    meta: {},
  } as unknown as TransportItem<APIEvent>;
}

function eventItem(): TransportItem<APIEvent> {
  return {
    type: 'event',
    payload: { name: 'custom_event', timestamp: new Date().toISOString(), attributes: {} },
    meta: {},
  } as unknown as TransportItem<APIEvent>;
}

describe('filterPathfinderTelemetry', () => {
  it('keeps an exception with a pathfinder stack frame', () => {
    const item = exceptionItem(['webpack://grafana-pathfinder-app/./src/lib/faro.ts']);
    expect(filterPathfinderTelemetry(item)).toBe(item);
  });

  it('keeps an exception matching the /pathfinder/ path fallback', () => {
    const item = exceptionItem(['/public/plugins/pathfinder/module.js']);
    expect(filterPathfinderTelemetry(item)).toBe(item);
  });

  it('drops an exception with only foreign stack frames', () => {
    const item = exceptionItem(['webpack://grafana-core/./src/app.ts', undefined]);
    expect(filterPathfinderTelemetry(item)).toBeNull();
  });

  it('drops an exception with no stacktrace at all', () => {
    expect(filterPathfinderTelemetry(exceptionItemWithoutStacktrace())).toBeNull();
  });

  it('keeps a log message prefixed with [pathfinder]', () => {
    const item = logItem('[pathfinder] something happened');
    expect(filterPathfinderTelemetry(item)).toBe(item);
  });

  it('drops a log message without the prefix', () => {
    expect(filterPathfinderTelemetry(logItem('something happened'))).toBeNull();
  });

  it('passes through other item types unfiltered', () => {
    const item = eventItem();
    expect(filterPathfinderTelemetry(item)).toBe(item);
  });
});

describe('initFaro', () => {
  it('does not initialize when the instance is not Grafana Cloud', async () => {
    mockedConfig.bootData!.settings.buildInfo.versionString = 'Grafana Enterprise';
    const faro = freshFaro();
    await faro.initFaro();
    expect(mockInitializeFaro).not.toHaveBeenCalled();
    expect(faro.isFaroEnabled()).toBe(false);
  });

  it('does not initialize when analytics reporting is disabled', async () => {
    mockedConfig.analytics = { enabled: false };
    const faro = freshFaro();
    await faro.initFaro();
    expect(mockInitializeFaro).not.toHaveBeenCalled();
  });

  it('initializes on a recognized Grafana Cloud hostname', async () => {
    const faro = freshFaro();
    await faro.initFaro();
    expect(mockInitializeFaro).toHaveBeenCalledTimes(1);
    expect(faro.isFaroEnabled()).toBe(true);
  });

  it('initializes with isolate: true and the real package version, not the %VERSION% placeholder', async () => {
    const faro = freshFaro();
    await faro.initFaro();
    const calledWith = mockInitializeFaro.mock.calls[0]![0];
    expect(calledWith.isolate).toBe(true);
    expect(calledWith.app.name).toBe('grafana-pathfinder-app');
    expect(calledWith.app.version).toBe('9.9.9-test');
    expect(calledWith.app.version).not.toBe('%VERSION%');
  });

  it('skips the cloud/analytics checks under the dev-build local override', async () => {
    mockedConfig.buildInfo.env = 'development';
    localStorage.setItem('pathfinder.faro.local', 'true');
    mockedConfig.bootData!.settings.buildInfo.versionString = 'Grafana Enterprise';
    mockedConfig.analytics = { enabled: false };
    const faro = freshFaro();
    await faro.initFaro();
    expect(mockInitializeFaro).toHaveBeenCalledTimes(1);
  });

  it('defaults sessionTracking.samplingRate to 1 when no rate is passed', async () => {
    const faro = freshFaro();
    await faro.initFaro();
    const calledWith = mockInitializeFaro.mock.calls[0]![0];
    expect(calledWith.sessionTracking.samplingRate).toBe(1);
  });

  it('forwards a custom sample rate into sessionTracking.samplingRate', async () => {
    const faro = freshFaro();
    await faro.initFaro(0.25);
    const calledWith = mockInitializeFaro.mock.calls[0]![0];
    expect(calledWith.sessionTracking.samplingRate).toBe(0.25);
  });

  it('ignores the passed sample rate under the local override — always samples at 1', async () => {
    mockedConfig.buildInfo.env = 'development';
    localStorage.setItem('pathfinder.faro.local', 'true');
    const faro = freshFaro();
    await faro.initFaro(0);
    const calledWith = mockInitializeFaro.mock.calls[0]![0];
    expect(calledWith.sessionTracking.samplingRate).toBe(1);
  });

  it('does not re-initialize on a second call (idempotent)', async () => {
    const faro = freshFaro();
    await faro.initFaro();
    await faro.initFaro();
    expect(mockInitializeFaro).toHaveBeenCalledTimes(1);
  });
});

describe('pushFaroError / pauseFaroBeforeReload', () => {
  it('no-op before initialization without throwing', () => {
    const faro = freshFaro();
    expect(() => faro.pushFaroError(new Error('boom'))).not.toThrow();
    expect(() => faro.pauseFaroBeforeReload()).not.toThrow();
    expect(mockPushError).not.toHaveBeenCalled();
    expect(mockPause).not.toHaveBeenCalled();
  });

  it('forwards to the Faro instance once initialized', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    const error = new Error('boom');
    faro.pushFaroError(error, { source: 'test' });
    expect(mockPushError).toHaveBeenCalledWith(error, { context: { source: 'test' } });

    faro.pauseFaroBeforeReload();
    expect(mockPause).toHaveBeenCalledTimes(1);
  });

  it('swallows errors thrown by the underlying Faro API', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    mockPushError.mockImplementationOnce(() => {
      throw new Error('transport down');
    });
    expect(() => faro.pushFaroError(new Error('boom'))).not.toThrow();
  });
});

describe('pushFaroLog', () => {
  it('no-ops before initialization without throwing', () => {
    const faro = freshFaro();
    expect(() => faro.pushFaroLog('info', 'hello')).not.toThrow();
    expect(mockPushLog).not.toHaveBeenCalled();
  });

  it('prefixes the message with [pathfinder] and forwards level/context once initialized', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    faro.pushFaroLog('warn', 'something happened', { step: 'one' });
    expect(mockPushLog).toHaveBeenCalledWith(['[pathfinder] something happened'], {
      level: 'warn',
      context: { step: 'one' },
    });
  });

  it('swallows errors thrown by the underlying Faro API', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    mockPushLog.mockImplementationOnce(() => {
      throw new Error('transport down');
    });
    expect(() => faro.pushFaroLog('error', 'boom')).not.toThrow();
  });
});

describe('stringifyAttributes', () => {
  it('passes strings through, truncated to 500 characters', () => {
    expect(stringifyAttributes({ foo: 'bar' })).toEqual({ foo: 'bar' });
    expect(stringifyAttributes({ long: 'a'.repeat(600) }).long).toHaveLength(500);
  });

  it('coerces numbers and booleans with String()', () => {
    expect(stringifyAttributes({ count: 3, ok: false })).toEqual({ count: '3', ok: 'false' });
  });

  it('JSON.stringifies objects and arrays', () => {
    expect(stringifyAttributes({ experiments: [{ flag: 'x', variant: 'treatment' }] })).toEqual({
      experiments: '[{"flag":"x","variant":"treatment"}]',
    });
  });

  it('drops null and undefined attributes entirely', () => {
    expect(stringifyAttributes({ a: null, b: undefined, c: 'kept' })).toEqual({ c: 'kept' });
  });
});

describe('pushFaroUserAction', () => {
  it('no-ops before initialization without throwing', () => {
    const faro = freshFaro();
    expect(() => faro.pushFaroUserAction('pathfinder_docs_panel_interaction', { action: 'open' })).not.toThrow();
    expect(mockStartUserAction).not.toHaveBeenCalled();
  });

  it('starts a user action with the same name and stringified attributes, and ends it immediately', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    faro.pushFaroUserAction('pathfinder_docs_panel_interaction', { action: 'open', step: 2 });
    expect(mockStartUserAction).toHaveBeenCalledWith('pathfinder_docs_panel_interaction', {
      action: 'open',
      step: '2',
    });
    expect(mockActionEnd).toHaveBeenCalledTimes(1);
  });

  it('forwards undefined attributes as undefined, not an empty object', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    faro.pushFaroUserAction('pathfinder_docs_panel_interaction');
    expect(mockStartUserAction).toHaveBeenCalledWith('pathfinder_docs_panel_interaction', undefined);
  });

  it('does not throw if startUserAction returns undefined (e.g. Faro declines to start one)', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    mockStartUserAction.mockReturnValueOnce(undefined as unknown as ReturnType<typeof mockStartUserAction>);
    expect(() => faro.pushFaroUserAction('pathfinder_docs_panel_interaction', {})).not.toThrow();
    expect(mockActionEnd).not.toHaveBeenCalled();
  });

  it('swallows errors thrown by startUserAction', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    mockStartUserAction.mockImplementationOnce(() => {
      throw new Error('transport down');
    });
    expect(() => faro.pushFaroUserAction('pathfinder_docs_panel_interaction', {})).not.toThrow();
  });

  it('swallows errors thrown by the action’s end()', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    mockActionEnd.mockImplementationOnce(() => {
      throw new Error('transport down');
    });
    expect(() => faro.pushFaroUserAction('pathfinder_docs_panel_interaction', {})).not.toThrow();
  });
});
