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
import pluginJson from '../plugin.json';

jest.mock('../../package.json', () => ({ name: 'grafana-pathfinder-app', version: '9.9.9-test' }));

const mockPushError = jest.fn();
const mockPushLog = jest.fn();
const mockPushEvent = jest.fn();
const mockActionEnd = jest.fn();
const mockStartUserAction = jest.fn(() => ({
  name: 'x',
  parentId: 'x',
  attributes: undefined as Record<string, string> | undefined,
  end: mockActionEnd,
}));
const mockGetActiveUserAction = jest.fn((): unknown => undefined);
const mockSetView = jest.fn();
const mockSetUser = jest.fn();
const mockPause = jest.fn();
let mockSessionMeta: { id: string; attributes?: Record<string, string> } | undefined = {
  id: 'session-1',
  attributes: {},
};
const mockGetSession = jest.fn(() => mockSessionMeta);
const mockSetSession = jest.fn((session?: { id?: string; attributes?: Record<string, string> }) => {
  mockSessionMeta = session as typeof mockSessionMeta;
});
const mockPushMeasurement = jest.fn();
const mockFaroInstance = {
  api: {
    pushError: mockPushError,
    pushLog: mockPushLog,
    pushEvent: mockPushEvent,
    startUserAction: mockStartUserAction,
    getActiveUserAction: mockGetActiveUserAction,
    setView: mockSetView,
    setUser: mockSetUser,
    getSession: mockGetSession,
    setSession: mockSetSession,
    pushMeasurement: mockPushMeasurement,
  },
  pause: mockPause,
};
interface CapturedFaroConfig {
  isolate: boolean;
  app: { name: string; version: string; environment: string };
  sessionTracking: { samplingRate?: number; persistent: boolean };
  instrumentations: Array<{ constructor: { name: string } }>;
  beforeSend: (item: TransportItem<APIEvent>) => TransportItem<APIEvent> | null;
  ignoreUrls?: Array<string | RegExp>;
}

const mockInitializeFaro = jest.fn((_cfg: CapturedFaroConfig) => mockFaroInstance);

jest.mock('@grafana/faro-web-sdk', () => ({
  initializeFaro: (cfg: CapturedFaroConfig) => mockInitializeFaro(cfg),
  ErrorsInstrumentation: class ErrorsInstrumentation {},
  SessionInstrumentation: class SessionInstrumentation {},
  ViewInstrumentation: class ViewInstrumentation {},
  PerformanceInstrumentation: class PerformanceInstrumentation {},
}));

const mockHashUserData = jest.fn(async (userId: string, email: string) => ({
  hashedUserId: `hashed-${userId}`,
  hashedEmail: `hashed-${email}`,
}));

jest.mock('./hash.util', () => ({ hashUserData: (...args: [string, string]) => mockHashUserData(...args) }));

// Dynamically imported by initFaro's cohort stamping; the mock keeps the
// OpenFeature SDK out of these tests.
const mockGetActiveExperiments = jest.fn((): Array<Record<string, unknown>> => []);
jest.mock('../utils/openfeature', () => ({ getActiveExperiments: () => mockGetActiveExperiments() }));

// A stable object reference, not a fresh literal per require: `freshFaro()`
// resets the module registry (so `./faro`'s internal init/instance state
// starts clean), and re-requiring this mock must keep resolving to the same
// `config` object so mutations made between tests are still visible.
interface MockedBootDataUser {
  email: string;
  orgRole: string;
  orgName: string;
  analytics: { identifier: string };
  language?: string;
}

const mockedConfig = {
  buildInfo: { env: 'production', version: '13.1.0', edition: undefined as string | undefined },
  bootData: {
    settings: { buildInfo: { versionString: 'Grafana Cloud' } },
    user: {
      email: 'x@y.z',
      orgRole: 'Admin',
      orgName: 'Acme Corp',
      analytics: { identifier: 'abc' },
    } as MockedBootDataUser,
  } as { settings: { buildInfo: { versionString: string } }; user: MockedBootDataUser } | undefined,
  analytics: { enabled: true } as { enabled: boolean } | undefined,
};

jest.mock('@grafana/runtime', () => ({ config: mockedConfig }));

// stampFaroUser() is fire-and-forget inside initFaro() — flush the
// microtask queue so its `await hashUserData(...)` resolves before assertions.
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

// Loaded via `require`, not a static ES `import`: ES imports are evaluated
// before any of this file's own top-level statements, which would trigger
// the `@grafana/runtime` mock factory above before `mockedConfig` is
// assigned. Requiring here, after the assignment, avoids that ordering trap.
const {
  getEnvironment,
  isGrafanaCloud,
  filterPathfinderTelemetry,
  stringifyAttributes,
  buildResourceIgnorePattern,
}: typeof import('./faro') = require('./faro');

function freshFaro(): typeof import('./faro') {
  jest.resetModules();
  return require('./faro');
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  mockedConfig.buildInfo = { env: 'production', version: '13.1.0', edition: undefined };
  mockedConfig.bootData = {
    settings: { buildInfo: { versionString: 'Grafana Cloud' } },
    user: { email: 'x@y.z', orgRole: 'Admin', orgName: 'Acme Corp', analytics: { identifier: 'abc' } },
  };
  mockedConfig.analytics = { enabled: true };
  mockSessionMeta = { id: 'session-1', attributes: {} };
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

function exceptionItem(
  filenames: Array<string | undefined>,
  context?: Record<string, string>
): TransportItem<APIEvent> {
  return {
    type: 'exception',
    payload: {
      type: 'Error',
      value: 'boom',
      timestamp: new Date().toISOString(),
      stacktrace: { frames: filenames.map((filename) => ({ filename, function: 'fn' })) },
      ...(context && { context }),
    },
    meta: {},
  } as unknown as TransportItem<APIEvent>;
}

function exceptionItemWithoutStacktrace(context?: Record<string, string>): TransportItem<APIEvent> {
  return {
    type: 'exception',
    payload: { type: 'Error', value: 'boom', timestamp: new Date().toISOString(), ...(context && { context }) },
    meta: {},
  } as unknown as TransportItem<APIEvent>;
}

function logItem(message: string, level = 'error'): TransportItem<APIEvent> {
  return {
    type: 'log',
    payload: { message, level, timestamp: new Date().toISOString(), context: undefined },
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

function performanceResourceItem(resourceUrl: string): TransportItem<APIEvent> {
  return {
    type: 'event',
    payload: {
      name: 'faro.performance.resource',
      timestamp: new Date().toISOString(),
      attributes: { name: resourceUrl },
    },
    meta: {},
  } as unknown as TransportItem<APIEvent>;
}

function performanceNavigationItem(): TransportItem<APIEvent> {
  return {
    type: 'event',
    payload: { name: 'faro.performance.navigation', timestamp: new Date().toISOString(), attributes: {} },
    meta: {},
  } as unknown as TransportItem<APIEvent>;
}

describe('filterPathfinderTelemetry', () => {
  it('keeps an exception with a pathfinder stack frame', () => {
    const item = exceptionItem(['webpack://grafana-pathfinder-app/./src/lib/faro.ts']);
    expect(filterPathfinderTelemetry(item)).toBe(item);
  });

  it('keeps an exception served from the real plugin asset path, derived from plugin.json', () => {
    const item = exceptionItem([`https://foo.grafana.net/public/plugins/${pluginJson.id}/613.js`]);
    expect(filterPathfinderTelemetry(item)).toBe(item);
  });

  it('drops an exception with only foreign stack frames', () => {
    const item = exceptionItem(['webpack://grafana-core/./src/app.ts', undefined]);
    expect(filterPathfinderTelemetry(item)).toBeNull();
  });

  it('drops an exception with no stacktrace at all', () => {
    expect(filterPathfinderTelemetry(exceptionItemWithoutStacktrace())).toBeNull();
  });

  it('keeps a stackless exception carrying the explicit-report marker', () => {
    const item = exceptionItemWithoutStacktrace({ pathfinder_reported: 'true' });
    expect(filterPathfinderTelemetry(item)).toBe(item);
  });

  it('keeps an explicitly-reported exception even when every frame is foreign (e.g. a shared chunk)', () => {
    const item = exceptionItem(['webpack://grafana-core/./src/app.ts'], { pathfinder_reported: 'true' });
    expect(filterPathfinderTelemetry(item)).toBe(item);
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

  it('always drops page-wide navigation timing', () => {
    expect(filterPathfinderTelemetry(performanceNavigationItem())).toBeNull();
  });

  it('keeps a resource-timing entry for the docs domain', () => {
    const item = performanceResourceItem('https://grafana.com/docs/some-page/content.json');
    expect(filterPathfinderTelemetry(item)).toBe(item);
  });

  it('keeps a resource-timing entry for a tutorials path on the shared hostname', () => {
    const item = performanceResourceItem('https://grafana.com/tutorials/some-tutorial/');
    expect(filterPathfinderTelemetry(item)).toBe(item);
  });

  it('drops Grafana core traffic to the shared grafana.com hostname (non-docs paths)', () => {
    expect(filterPathfinderTelemetry(performanceResourceItem('https://grafana.com/api/plugins/foo'))).toBeNull();
    expect(filterPathfinderTelemetry(performanceResourceItem('https://grafana.com/docs-lookalike/x'))).toBeNull();
  });

  it('keeps a resource-timing entry for the recommender domain', () => {
    const item = performanceResourceItem('https://recommender.grafana.com/api/v1/recommend');
    expect(filterPathfinderTelemetry(item)).toBe(item);
  });

  it('keeps a resource-timing entry for the interactive-learning domain', () => {
    const item = performanceResourceItem('https://interactive-learning.grafana.net/guide/content.json');
    expect(filterPathfinderTelemetry(item)).toBe(item);
  });

  it('drops a resource-timing entry for an untracked (e.g. Grafana core) domain', () => {
    const item = performanceResourceItem('https://foo.grafana.net/api/dashboards/uid/abc');
    expect(filterPathfinderTelemetry(item)).toBeNull();
  });

  it('drops a resource-timing entry with a malformed URL', () => {
    const item = performanceResourceItem('not-a-valid-url');
    expect(filterPathfinderTelemetry(item)).toBeNull();
  });
});

describe('buildResourceIgnorePattern', () => {
  const pattern = buildResourceIgnorePattern(
    new Set(['grafana.com', 'recommender.grafana.com', 'interactive-learning.grafana.net'])
  );

  it('does not match (allows) tracked hostnames', () => {
    expect(pattern.test('https://grafana.com/docs/x')).toBe(false);
    expect(pattern.test('https://recommender.grafana.com/api/v1/recommend')).toBe(false);
    expect(pattern.test('https://interactive-learning.grafana.net/x')).toBe(false);
  });

  it('matches (ignores) untracked hostnames — Grafana core and third parties', () => {
    expect(pattern.test('https://foo.grafana.net/api/dashboards/uid/abc')).toBe(true);
    expect(pattern.test('https://cdn.jsdelivr.net/x')).toBe(true);
  });
});

describe('initFaro', () => {
  it('does not initialize when the instance is not Grafana Cloud', async () => {
    mockedConfig.bootData!.settings.buildInfo.versionString = 'Grafana Enterprise';
    const faro = freshFaro();
    await faro.initFaro();
    expect(mockInitializeFaro).not.toHaveBeenCalled();
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

  it('sets a non-empty ignoreUrls so core resource noise is dropped before a payload is built', async () => {
    const faro = freshFaro();
    await faro.initFaro();
    const calledWith = mockInitializeFaro.mock.calls[0]![0];
    expect(calledWith.ignoreUrls).toBeDefined();
    expect(calledWith.ignoreUrls!.length).toBeGreaterThan(0);
    // The production wiring must carry buildResourceIgnorePattern semantics:
    // ignore (match) core/third-party hosts, allow (not match) tracked ones.
    const pattern = calledWith.ignoreUrls![0] as RegExp;
    expect(pattern).toBeInstanceOf(RegExp);
    expect(pattern.test('https://foo.grafana.net/api/dashboards/uid/abc')).toBe(true);
    expect(pattern.test('https://grafana.com/docs/x')).toBe(false);
  });

  it('includes PerformanceInstrumentation (filtered down in beforeSend, not excluded outright)', async () => {
    const faro = freshFaro();
    await faro.initFaro();
    const calledWith = mockInitializeFaro.mock.calls[0]![0];
    const instrumentationNames = calledWith.instrumentations.map((i) => i.constructor.name);
    expect(instrumentationNames).toEqual(
      expect.arrayContaining([
        'ErrorsInstrumentation',
        'SessionInstrumentation',
        'ViewInstrumentation',
        'PerformanceInstrumentation',
      ])
    );
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

  it('uses volatile (sessionStorage) sessions — persistent sessions would share localStorage with Grafana core', async () => {
    const faro = freshFaro();
    await faro.initFaro();
    const calledWith = mockInitializeFaro.mock.calls[0]![0];
    expect(calledWith.sessionTracking.persistent).toBe(false);
  });

  it('sets no samplingRate — every engaged session sends (the SDK default of 1 applies)', async () => {
    const faro = freshFaro();
    await faro.initFaro();
    const calledWith = mockInitializeFaro.mock.calls[0]![0];
    expect(calledWith.sessionTracking.samplingRate).toBeUndefined();
  });

  it('does not re-initialize on a second call (idempotent)', async () => {
    const faro = freshFaro();
    await faro.initFaro();
    await faro.initFaro();
    expect(mockInitializeFaro).toHaveBeenCalledTimes(1);
  });

  it('stamps meta.user with the raw analytics id and email — Faro is first-party, unlike the hashed recommender payload', async () => {
    const faro = freshFaro();
    await faro.initFaro();
    await flushMicrotasks();
    expect(mockHashUserData).toHaveBeenCalledWith('abc', 'x@y.z');
    expect(mockSetUser).toHaveBeenCalledWith({
      id: 'abc',
      email: 'x@y.z',
      username: window.location.hostname,
      attributes: { org_role: 'Admin', org_name: 'Acme Corp' },
    });
  });

  it('omits the email field (instead of a placeholder) when the Cloud user has no email', async () => {
    mockedConfig.bootData!.user.email = '';
    const faro = freshFaro();
    await faro.initFaro();
    await flushMicrotasks();
    expect(mockSetUser).toHaveBeenCalledWith({
      id: 'abc',
      email: undefined,
      username: window.location.hostname,
      attributes: { org_role: 'Admin', org_name: 'Acme Corp' },
    });
  });

  it('uses the OSS identity placeholders (not the recommender hash) outside Grafana Cloud', async () => {
    mockedConfig.bootData!.settings.buildInfo.versionString = 'Grafana Enterprise';
    localStorage.setItem('pathfinder.faro.local', 'true');
    mockedConfig.buildInfo.env = 'development';
    const faro = freshFaro();
    await faro.initFaro();
    await flushMicrotasks();
    expect(mockHashUserData).toHaveBeenCalledWith('oss-user', 'oss-user@example.com');
  });

  it('does not stamp a user when init is skipped (outside Grafana Cloud)', async () => {
    mockedConfig.bootData!.settings.buildInfo.versionString = 'Grafana Enterprise';
    const faro = freshFaro();
    await faro.initFaro();
    await flushMicrotasks();
    expect(mockHashUserData).not.toHaveBeenCalled();
    expect(mockSetUser).not.toHaveBeenCalled();
  });

  it('includes edition, language, and the instance hostname in the initial session attributes', async () => {
    mockedConfig.bootData!.user.language = 'fr-FR';
    mockedConfig.buildInfo.edition = 'Enterprise';
    const faro = freshFaro();
    await faro.initFaro();
    const calledWith = mockInitializeFaro.mock.calls[0]![0] as unknown as {
      sessionTracking: { session: { attributes: Record<string, string> } };
    };
    expect(calledWith.sessionTracking.session.attributes).toEqual(
      expect.objectContaining({
        grafana_version: '13.1.0',
        edition: 'Enterprise',
        language: 'fr-FR',
        instance: window.location.hostname,
      })
    );
  });

  it('stamps active experiment cohorts onto the session as the versioned schema', async () => {
    mockGetActiveExperiments.mockReturnValueOnce([
      { flag: 'pathfinder.highlighted-guide-experiment', variant: 'treatment', guideId: 'bundled:welcome', pages: [] },
    ]);
    const faro = freshFaro();
    await faro.initFaro();
    await flushMicrotasks();

    expect(mockSetSession).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: expect.objectContaining({
          experiments: JSON.stringify({
            v: 1,
            cohorts: [
              { flag: 'pathfinder.highlighted-guide-experiment', variant: 'treatment', guideId: 'bundled:welcome' },
            ],
          }),
        }),
      })
    );
  });

  it('does not stamp an experiments attribute when no experiments are active', async () => {
    const faro = freshFaro();
    await faro.initFaro();
    await flushMicrotasks();

    const stamped = mockSetSession.mock.calls.some((call) => call[0]?.attributes?.experiments !== undefined);
    expect(stamped).toBe(false);
  });

  it('stamps the current surface onto the session on init', async () => {
    localStorage.setItem('grafana-pathfinder-app-panel-mode', 'floating');
    const faro = freshFaro();
    await faro.initFaro();
    expect(mockSetSession).toHaveBeenCalledWith(
      expect.objectContaining({ attributes: expect.objectContaining({ surface: 'floating' }) })
    );
  });

  it('re-stamps the surface when the surface owner reports a change', async () => {
    const faro = freshFaro();
    // Same module registry as freshFaro's require — initFaro subscribed to this instance.
    const surface: typeof import('./telemetry/surface') = require('./telemetry/surface');
    await faro.initFaro();

    surface.reportPathfinderSurface('fullscreen');

    expect(mockSetSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ attributes: expect.objectContaining({ surface: 'fullscreen' }) })
    );
  });

  it('does not clobber a destination surface when a stale unmount reports closed', async () => {
    const faro = freshFaro();
    const surface: typeof import('./telemetry/surface') = require('./telemetry/surface');
    await faro.initFaro();

    surface.reportPathfinderSurface('floating');
    surface.reportPathfinderSurfaceClosed('sidebar');

    expect(mockSetSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ attributes: expect.objectContaining({ surface: 'floating' }) })
    );

    surface.reportPathfinderSurfaceClosed('floating');
    expect(mockSetSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ attributes: expect.objectContaining({ surface: 'closed' }) })
    );
  });

  it('swallows errors from the hashing/setUser pipeline', async () => {
    mockHashUserData.mockRejectedValueOnce(new Error('crypto unavailable'));
    const faro = freshFaro();
    await expect(faro.initFaro()).resolves.not.toThrow();
    await flushMicrotasks();
    expect(mockSetUser).not.toHaveBeenCalled();
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
    expect(mockPushError).toHaveBeenCalledWith(error, {
      context: { source: 'test', pathfinder_reported: 'true' },
    });

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

describe('pushFaroEvent', () => {
  it('no-ops before initialization without throwing', () => {
    const faro = freshFaro();
    expect(() => faro.pushFaroEvent('recommender_fallback', { error_type: 'timeout' })).not.toThrow();
    expect(mockPushEvent).not.toHaveBeenCalled();
  });

  it('forwards name and stringified attributes with skipDedupe once initialized', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    faro.pushFaroEvent('requirements_exhausted', { requirement: 'has-role:admin', retry_count: 3 });
    expect(mockPushEvent).toHaveBeenCalledWith(
      'requirements_exhausted',
      { requirement: 'has-role:admin', retry_count: '3' },
      undefined,
      { skipDedupe: true }
    );
  });

  it('swallows errors thrown by the underlying Faro API', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    mockPushEvent.mockImplementationOnce(() => {
      throw new Error('transport down');
    });
    expect(() => faro.pushFaroEvent('recommender_fallback')).not.toThrow();
  });
});

describe('pushFaroMeasurement', () => {
  it('no-ops before initialization without throwing', () => {
    const faro = freshFaro();
    expect(() => faro.pushFaroMeasurement('pathfinder_panel', { panel_lcp_ms: 120 })).not.toThrow();
    expect(mockPushMeasurement).not.toHaveBeenCalled();
  });

  it('forwards type/values/context once initialized', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    faro.pushFaroMeasurement('pathfinder_recommender', { recommender_ms: 250 }, { outcome: 'ok' });
    expect(mockPushMeasurement).toHaveBeenCalledWith(
      { type: 'pathfinder_recommender', values: { recommender_ms: 250 } },
      { context: { outcome: 'ok' } }
    );
  });

  it('omits the options object entirely when no context is passed', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    faro.pushFaroMeasurement('pathfinder_panel', { panel_lcp_ms: 120 });
    expect(mockPushMeasurement).toHaveBeenCalledWith(
      { type: 'pathfinder_panel', values: { panel_lcp_ms: 120 } },
      undefined
    );
  });

  it('swallows errors thrown by the underlying Faro API', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    mockPushMeasurement.mockImplementationOnce(() => {
      throw new Error('transport down');
    });
    expect(() => faro.pushFaroMeasurement('pathfinder_panel', { panel_lcp_ms: 120 })).not.toThrow();
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
      seq: '0',
    });
    expect(mockActionEnd).toHaveBeenCalledTimes(1);
  });

  it('adds an incrementing seq attribute so identical rapid-fire mirrors survive Faro dedupe', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    faro.pushFaroUserAction('pathfinder_docs_panel_interaction', { action: 'open' });
    faro.pushFaroUserAction('pathfinder_docs_panel_interaction', { action: 'open' });
    expect(mockStartUserAction).toHaveBeenNthCalledWith(1, 'pathfinder_docs_panel_interaction', {
      action: 'open',
      seq: '0',
    });
    expect(mockStartUserAction).toHaveBeenNthCalledWith(2, 'pathfinder_docs_panel_interaction', {
      action: 'open',
      seq: '1',
    });
  });

  it('sends only the seq attribute when no attributes are passed', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    faro.pushFaroUserAction('pathfinder_docs_panel_interaction');
    expect(mockStartUserAction).toHaveBeenCalledWith('pathfinder_docs_panel_interaction', { seq: '0' });
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

describe('pushFaroUserAction fallback while a real action is active', () => {
  it('pushes a plain skip-dedupe event instead of starting a second action', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    mockGetActiveUserAction.mockReturnValueOnce({ name: 'outer' });
    faro.pushFaroUserAction('pathfinder_docs_panel_interaction', { action: 'open' });
    expect(mockPushEvent).toHaveBeenCalledWith(
      'pathfinder_docs_panel_interaction',
      { action: 'open', seq: '0' },
      undefined,
      { skipDedupe: true }
    );
    expect(mockStartUserAction).not.toHaveBeenCalled();
  });

  it('keeps one monotonic seq counter across both mirror shapes', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    faro.pushFaroUserAction('pathfinder_a');
    mockGetActiveUserAction.mockReturnValueOnce({ name: 'outer' });
    faro.pushFaroUserAction('pathfinder_b');
    expect(mockStartUserAction).toHaveBeenCalledWith('pathfinder_a', { seq: '0' });
    expect(mockPushEvent).toHaveBeenCalledWith('pathfinder_b', { seq: '1' }, undefined, { skipDedupe: true });
  });
});

describe('withFaroUserAction', () => {
  it('runs the work directly before initialization and never starts an action', async () => {
    const faro = freshFaro();
    await expect(faro.withFaroUserAction('pathfinder_step_do', {}, () => 42)).resolves.toBe(42);
    expect(mockStartUserAction).not.toHaveBeenCalled();
  });

  it('propagates a rejection with the same error instance when uninitialized', async () => {
    const faro = freshFaro();
    const boom = new Error('boom');
    await expect(
      faro.withFaroUserAction('pathfinder_step_do', {}, () => {
        throw boom;
      })
    ).rejects.toBe(boom);
  });

  it('starts an action with stringified attributes, stamps outcome ok, and ends it once', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    const result = await faro.withFaroUserAction('pathfinder_step_do', { step: 2 }, async () => 'done');
    expect(result).toBe('done');
    expect(mockStartUserAction).toHaveBeenCalledWith('pathfinder_step_do', { step: '2' }, undefined);
    const action = mockStartUserAction.mock.results[0]!.value;
    expect(action.attributes).toEqual({ outcome: 'ok' });
    expect(mockActionEnd).toHaveBeenCalledTimes(1);
  });

  it('passes importance: critical when options.critical is set', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    await faro.withFaroUserAction('pathfinder_guide_open', {}, async () => 'done', undefined, { critical: true });
    expect(mockStartUserAction).toHaveBeenCalledWith('pathfinder_guide_open', {}, { importance: 'critical' });
  });

  it('omits the options object entirely when not marked critical', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    await faro.withFaroUserAction('pathfinder_step_do', {}, async () => 'done', undefined, { critical: false });
    expect(mockStartUserAction).toHaveBeenCalledWith('pathfinder_step_do', {}, undefined);
  });

  it('stamps the outcome produced by options.outcomeFrom instead of ok when work resolves-but-failed', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    await faro.withFaroUserAction('pathfinder_guided_step', {}, async () => 'cancelled' as const, undefined, {
      outcomeFrom: (result) => (result === 'cancelled' ? 'cancelled' : 'ok'),
    });

    const action = mockStartUserAction.mock.results[0]!.value;
    expect(action.attributes).toEqual({ outcome: 'cancelled' });
    expect(mockActionEnd).toHaveBeenCalledTimes(1);
  });

  it('falls back to ok when outcomeFrom itself throws (telemetry must never break the app)', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    const result = await faro.withFaroUserAction('pathfinder_guided_step', {}, async () => 'done', undefined, {
      outcomeFrom: () => {
        throw new Error('mapper bug');
      },
    });

    expect(result).toBe('done');
    const action = mockStartUserAction.mock.results[0]!.value;
    expect(action.attributes).toEqual({ outcome: 'ok' });
  });

  it('stamps outcome error and rethrows the same error instance on rejection', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    const boom = new Error('boom');
    await expect(
      faro.withFaroUserAction('pathfinder_step_do', {}, async () => {
        throw boom;
      })
    ).rejects.toBe(boom);
    const action = mockStartUserAction.mock.results[0]!.value;
    expect(action.attributes).toEqual({ outcome: 'error' });
    expect(mockActionEnd).toHaveBeenCalledTimes(1);
  });

  it('treats a synchronous throw from work like a rejection', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    const boom = new Error('sync boom');
    await expect(
      faro.withFaroUserAction('pathfinder_step_do', {}, () => {
        throw boom;
      })
    ).rejects.toBe(boom);
    expect(mockActionEnd).toHaveBeenCalledTimes(1);
  });

  it('is a passthrough while another action is active — no start, no end', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    mockGetActiveUserAction.mockReturnValueOnce({ name: 'outer' });
    await expect(faro.withFaroUserAction('pathfinder_step_do', {}, () => 'inner')).resolves.toBe('inner');
    expect(mockStartUserAction).not.toHaveBeenCalled();
    expect(mockActionEnd).not.toHaveBeenCalled();
  });

  it('stays a passthrough when init was skipped (outside Grafana Cloud)', async () => {
    mockedConfig.bootData!.settings.buildInfo.versionString = 'Grafana Enterprise';
    const faro = freshFaro();
    await faro.initFaro();

    await expect(faro.withFaroUserAction('pathfinder_section_run', {}, () => 'ok')).resolves.toBe('ok');
    expect(mockInitializeFaro).not.toHaveBeenCalled();
    expect(mockStartUserAction).not.toHaveBeenCalled();
  });

  it('force-ends a hung action after the safety timeout with outcome timeout', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    jest.useFakeTimers();
    try {
      void faro.withFaroUserAction('pathfinder_step_do', {}, () => new Promise<never>(() => {}));
      jest.advanceTimersByTime(30_000);
      const action = mockStartUserAction.mock.results[0]!.value;
      expect(action.attributes).toEqual({ outcome: 'timeout' });
      expect(mockActionEnd).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('never double-ends: work settles first, then the timer fires', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    jest.useFakeTimers();
    try {
      await faro.withFaroUserAction('pathfinder_step_do', {}, async () => 'v');
      jest.advanceTimersByTime(60_000);
      const action = mockStartUserAction.mock.results[0]!.value;
      expect(action.attributes).toEqual({ outcome: 'ok' });
      expect(mockActionEnd).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('honors a custom timeout', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    jest.useFakeTimers();
    try {
      void faro.withFaroUserAction('pathfinder_step_do', {}, () => new Promise<never>(() => {}), 5_000);
      jest.advanceTimersByTime(5_000);
      expect(mockActionEnd).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('still runs the work when startUserAction throws', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    mockStartUserAction.mockImplementationOnce(() => {
      throw new Error('transport down');
    });
    await expect(faro.withFaroUserAction('pathfinder_step_do', {}, () => 'ok')).resolves.toBe('ok');
  });

  it('swallows errors thrown by end() and still returns the value', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    mockActionEnd.mockImplementationOnce(() => {
      throw new Error('transport down');
    });
    await expect(faro.withFaroUserAction('pathfinder_step_do', {}, () => 'ok')).resolves.toBe('ok');
  });
});

describe('setFaroUserActionAttributes', () => {
  it('merges stringified attributes onto the active action', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    const active = { name: 'outer', attributes: { a: '1' } };
    mockGetActiveUserAction.mockReturnValueOnce(active);
    faro.setFaroUserActionAttributes({ b: 2 });
    expect(active.attributes).toEqual({ a: '1', b: '2' });
  });

  it('no-ops without an active action or before initialization', () => {
    const faro = freshFaro();
    expect(() => faro.setFaroUserActionAttributes({ a: 1 })).not.toThrow();
  });
});

describe('setFaroSessionAttributes', () => {
  it('merges onto existing session attributes and preserves the session id', async () => {
    const faro = freshFaro();
    await faro.initFaro();
    mockSetSession.mockClear();
    mockSessionMeta = { id: 'session-1', attributes: { grafana_version: '13.1.0' } };

    faro.setFaroSessionAttributes({ experiments: '[{"flag":"x"}]' });

    expect(mockSetSession).toHaveBeenCalledWith({
      id: 'session-1',
      attributes: { grafana_version: '13.1.0', experiments: '[{"flag":"x"}]' },
    });
  });

  it('no-ops before initialization without throwing', () => {
    const faro = freshFaro();
    expect(() => faro.setFaroSessionAttributes({ surface: 'floating' })).not.toThrow();
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  it('swallows errors thrown by the underlying Faro API', async () => {
    const faro = freshFaro();
    await faro.initFaro();
    mockGetSession.mockImplementationOnce(() => {
      throw new Error('transport down');
    });
    expect(() => faro.setFaroSessionAttributes({ surface: 'floating' })).not.toThrow();
  });
});

describe('passesActivityGate', () => {
  const DOCKED_KEY = 'grafana.navigation.extensionSidebarDocked';
  const PANEL_MODE_KEY = 'grafana-pathfinder-app-panel-mode';

  it('drops events while no Pathfinder surface is open', () => {
    const faro = freshFaro();
    expect(faro.passesActivityGate(eventItem())).toBe(false);
  });

  it('passes events when the panel mode is floating', () => {
    localStorage.setItem(PANEL_MODE_KEY, 'floating');
    const faro = freshFaro();
    expect(faro.passesActivityGate(eventItem())).toBe(true);
  });

  it('passes events when the panel mode is fullscreen', () => {
    localStorage.setItem(PANEL_MODE_KEY, 'fullscreen');
    const faro = freshFaro();
    expect(faro.passesActivityGate(eventItem())).toBe(true);
  });

  it('stays closed for the default sidebar mode with nothing docked', () => {
    localStorage.setItem(PANEL_MODE_KEY, 'sidebar');
    const faro = freshFaro();
    expect(faro.passesActivityGate(eventItem())).toBe(false);
  });

  it('passes events when the extension sidebar is docked by Pathfinder', () => {
    localStorage.setItem(DOCKED_KEY, JSON.stringify({ pluginId: pluginJson.id }));
    const faro = freshFaro();
    expect(faro.passesActivityGate(eventItem())).toBe(true);
  });

  it('recognizes the legacy plain-string docked format', () => {
    localStorage.setItem(DOCKED_KEY, pluginJson.id);
    const faro = freshFaro();
    expect(faro.passesActivityGate(eventItem())).toBe(true);
  });

  it('recognizes a componentTitle match from older Grafana versions', () => {
    localStorage.setItem(DOCKED_KEY, JSON.stringify({ componentTitle: 'Interactive learning' }));
    const faro = freshFaro();
    expect(faro.passesActivityGate(eventItem())).toBe(true);
  });

  it('stays closed when another plugin owns the docked sidebar', () => {
    localStorage.setItem(DOCKED_KEY, JSON.stringify({ pluginId: 'some-other-app' }));
    const faro = freshFaro();
    expect(faro.passesActivityGate(eventItem())).toBe(false);
  });

  it('passes events when the pathfinder-controller-root overlay is mounted in this tab', () => {
    const el = document.createElement('div');
    el.id = 'pathfinder-controller-root';
    document.body.appendChild(el);
    try {
      const faro = freshFaro();
      expect(faro.passesActivityGate(eventItem())).toBe(true);
    } finally {
      el.remove();
    }
  });

  it('does not pass events merely because the kiosk manager root is mounted — the overlay may not be open', () => {
    const el = document.createElement('div');
    el.id = 'pathfinder-kiosk-root';
    document.body.appendChild(el);
    try {
      const faro = freshFaro();
      expect(faro.passesActivityGate(eventItem())).toBe(false);
    } finally {
      el.remove();
    }
  });

  it('passes events when the kiosk overlay is actually mounted, not just its persistent root', () => {
    const root = document.createElement('div');
    root.id = 'pathfinder-kiosk-root';
    document.body.appendChild(root);
    const overlay = document.createElement('div');
    overlay.setAttribute('data-testid', 'kiosk-mode-overlay');
    root.appendChild(overlay);
    try {
      const faro = freshFaro();
      expect(faro.passesActivityGate(eventItem())).toBe(true);
    } finally {
      root.remove();
    }
  });

  it('latches open for the rest of the page load once Pathfinder was open', () => {
    localStorage.setItem(PANEL_MODE_KEY, 'floating');
    const faro = freshFaro();
    expect(faro.passesActivityGate(eventItem())).toBe(true);
    localStorage.removeItem(PANEL_MODE_KEY);
    expect(faro.passesActivityGate(eventItem())).toBe(true);
  });

  it('opens on a later check after starting closed — closed does not latch', () => {
    const faro = freshFaro();
    expect(faro.passesActivityGate(eventItem())).toBe(false);
    localStorage.setItem(PANEL_MODE_KEY, 'floating');
    expect(faro.passesActivityGate(eventItem())).toBe(true);
  });

  it('lets exceptions through while closed', () => {
    const faro = freshFaro();
    expect(faro.passesActivityGate(exceptionItem(['webpack://grafana-core/x.ts']))).toBe(true);
  });

  it('lets error-level logs through while closed, but not warn-level ones', () => {
    const faro = freshFaro();
    expect(faro.passesActivityGate(logItem('[pathfinder] broke'))).toBe(true);
    expect(faro.passesActivityGate(logItem('[pathfinder] hmm', 'warn'))).toBe(false);
  });

  it('an exception while closed does not latch the gate open', () => {
    const faro = freshFaro();
    faro.passesActivityGate(exceptionItem(['webpack://grafana-core/x.ts']));
    expect(faro.passesActivityGate(eventItem())).toBe(false);
  });
});

describe('beforeSend wiring', () => {
  it('composes the activity gate with attribution filtering', async () => {
    const faro = freshFaro();
    await faro.initFaro();
    const { beforeSend } = mockInitializeFaro.mock.calls[0]![0];

    expect(beforeSend(eventItem())).toBeNull();
    expect(beforeSend(exceptionItem(['webpack://grafana-pathfinder-app/./src/lib/faro.ts']))).not.toBeNull();
    expect(beforeSend(exceptionItem(['webpack://grafana-core/./src/app.ts']))).toBeNull();

    localStorage.setItem('grafana-pathfinder-app-panel-mode', 'floating');
    expect(beforeSend(eventItem())).not.toBeNull();
  });
});

describe('setFaroView', () => {
  it('no-ops before initialization without throwing', () => {
    const faro = freshFaro();
    expect(() => faro.setFaroView('https://grafana.com/docs/grafana/latest/')).not.toThrow();
    expect(mockSetView).not.toHaveBeenCalled();
  });

  it('sets the view to hostname + pathname, dropping query and fragment', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    faro.setFaroView('https://grafana.com/docs/grafana/latest/alerting/?pg=docs#section-2');
    expect(mockSetView).toHaveBeenCalledWith({ name: 'grafana.com/docs/grafana/latest/alerting/' });
  });

  it('no-ops on an empty URL, keeping the previous view', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    faro.setFaroView('');
    expect(mockSetView).not.toHaveBeenCalled();
  });

  it('swallows errors thrown by the underlying Faro API', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    mockSetView.mockImplementationOnce(() => {
      throw new Error('transport down');
    });
    expect(() => faro.setFaroView('https://grafana.com/docs/')).not.toThrow();
  });

  it('sets internal content identifiers as the view instead of dropping them', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    faro.setFaroView('bundled:welcome-to-pathfinder');
    expect(mockSetView).toHaveBeenCalledWith({ name: 'bundled:welcome-to-pathfinder' });

    faro.setFaroView('backend-guide:my-guide');
    expect(mockSetView).toHaveBeenCalledWith({ name: 'backend-guide:my-guide' });
  });

  it('bounds the view name length', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    faro.setFaroView(`https://grafana.com/docs/${'a'.repeat(500)}`);

    const { name } = mockSetView.mock.calls[0]![0] as { name: string };
    expect(name.length).toBeLessThanOrEqual(200);
    expect(name.startsWith('grafana.com/docs/')).toBe(true);
  });
});

describe('setFaroViewName', () => {
  it('no-ops before initialization without throwing', () => {
    const faro = freshFaro();
    expect(() => faro.setFaroViewName('recommendations')).not.toThrow();
    expect(mockSetView).not.toHaveBeenCalled();
  });

  it('sets the view to the literal name once initialized', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    faro.setFaroViewName('recommendations');
    expect(mockSetView).toHaveBeenCalledWith({ name: 'recommendations' });
  });

  it('ignores an empty name, keeping the previous view', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    faro.setFaroViewName('');
    expect(mockSetView).not.toHaveBeenCalled();
  });

  it('swallows errors thrown by the underlying Faro API', async () => {
    const faro = freshFaro();
    await faro.initFaro();

    mockSetView.mockImplementationOnce(() => {
      throw new Error('transport down');
    });
    expect(() => faro.setFaroViewName('recommendations')).not.toThrow();
  });
});
