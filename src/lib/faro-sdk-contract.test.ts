/**
 * Contract tests against the *installed* @grafana/faro-web-sdk (not a mock).
 *
 * pushFaroUserAction() casts startUserAction()'s result to
 * UserActionInternalInterface to call end() — an internal API with no public
 * equivalent. A type-level rename fails the build, but a runtime-semantics
 * change (end() no longer emitting the faro.user.action event) would compile
 * and silently kill the analytics mirror. These tests fail loudly on an SDK
 * bump instead.
 */
import { PathfinderErrorsInstrumentation } from './telemetry/browser-errors';
import { filterPathfinderTelemetry } from './telemetry/filtering';
import {
  BaseTransport,
  initializeFaro,
  SessionInstrumentation,
  type TransportItem,
  type UserActionInternalInterface,
} from '@grafana/faro-web-sdk';

class CaptureTransport extends BaseTransport {
  readonly name = '@pathfinder/capture-transport';
  readonly version = '0.0.0';
  items: TransportItem[] = [];

  send(items: TransportItem | TransportItem[]): void {
    this.items.push(...(Array.isArray(items) ? items : [items]));
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('faro-web-sdk user action contract', () => {
  const transport = new CaptureTransport();
  const faro = initializeFaro({
    app: { name: 'pathfinder-sdk-contract-test', version: '0.0.0' },
    transports: [transport],
    instrumentations: [],
    isolate: true,
    globalObjectKey: 'pathfinderSdkContractTest',
    batching: { enabled: false },
    dedupe: false,
  });

  it('startUserAction returns an action exposing the internal end()', () => {
    const action = faro.api.startUserAction('pathfinder_contract_check', { seq: '0' });
    expect(action).toBeDefined();
    expect(typeof (action as UserActionInternalInterface).end).toBe('function');
    (action as UserActionInternalInterface).end();
  });

  it('ending the action emits a faro.user.action event that reaches the transport', async () => {
    transport.items = [];
    const action = faro.api.startUserAction('pathfinder_contract_emit', { seq: '1' });
    (action as UserActionInternalInterface | undefined)?.end();

    await waitFor(() =>
      transport.items.some(
        (item) => item.type === 'event' && (item.payload as { name?: string }).name === 'faro.user.action'
      )
    );

    const userActionEvent = transport.items.find(
      (item) => item.type === 'event' && (item.payload as { name?: string }).name === 'faro.user.action'
    );
    expect(userActionEvent).toBeDefined();
    expect(JSON.stringify(userActionEvent!.payload)).toContain('pathfinder_contract_emit');
  });
});

// setFaroSessionAttributes re-stamps the whole session meta on every surface
// change (sidebar open, close, pop-out). If the SDK treated that as a new
// session, one visit would fan out into a session per open — and with session
// replay that means a recording per open, not per visit.
describe('faro-web-sdk session identity contract', () => {
  const transport = new CaptureTransport();
  const faro = initializeFaro({
    app: { name: 'pathfinder-session-identity-test', version: '0.0.0' },
    transports: [transport],
    instrumentations: [new SessionInstrumentation()],
    sessionTracking: { enabled: true, persistent: false, session: { attributes: { surface: 'closed' } } },
    isolate: true,
    globalObjectKey: 'pathfinderSessionIdentityTest',
    batching: { enabled: false },
    dedupe: false,
  });

  const restampSurface = (surface: string) => {
    const session = faro.api.getSession();
    faro.api.setSession({ ...session, attributes: { ...session?.attributes, surface } });
  };

  it('keeps one session id across repeated surface re-stamps', () => {
    const initialId = faro.api.getSession()?.id;
    expect(initialId).toBeDefined();

    for (const surface of ['sidebar', 'closed', 'floating', 'closed', 'sidebar']) {
      restampSurface(surface);
    }

    expect(faro.api.getSession()?.id).toBe(initialId);
    expect(faro.api.getSession()?.attributes?.['surface']).toBe('sidebar');
  });

  it('emits no additional session_start when only attributes change', async () => {
    transport.items = [];
    restampSurface('kiosk');
    await waitFor(() => transport.items.length > 0, 200);

    const sessionStarts = transport.items.filter(
      (item) => item.type === 'event' && (item.payload as { name?: string }).name === 'session_start'
    );
    expect(sessionStarts).toHaveLength(0);
  });
});

describe('browser error capture through the installed Faro SDK', () => {
  it('captures plugin failures while rejecting dashboard URL and wrapper-only attribution', () => {
    const transport = new CaptureTransport();
    const instrumentation = new PathfinderErrorsInstrumentation();
    const faro = initializeFaro({
      app: { name: 'pathfinder-browser-error-contract', version: '0.0.0' },
      transports: [transport],
      instrumentations: [instrumentation],
      isolate: true,
      globalObjectKey: 'pathfinderBrowserErrorContract',
      batching: { enabled: false },
      dedupe: false,
      beforeSend: filterPathfinderTelemetry,
    });
    try {
      const error = new Error('Plugin failure');
      error.stack =
        'Error: Plugin failure\n    at openGuide (https://example.org/public/plugins/grafana-pathfinder-app/1.js:10:5)';
      window.dispatchEvent(new ErrorEvent('error', { error, message: error.message }));
      window.dispatchEvent(
        new ErrorEvent('error', {
          message: 'ResizeObserver loop completed with undelivered notifications.',
          filename: 'https://ops.grafana-ops.net/d/status?var-plugin_id=grafana-pathfinder-app',
        })
      );
      const wrapperError = new Error('Permission denied to access property "apply"');
      wrapperError.stack =
        'Error: Permission denied\n    at apply (webpack://grafana-pathfinder-app/../node_modules/@grafana/faro-web-sdk/dist/esm/instrumentations/errors/registerOnerror.js:18:0)';
      window.dispatchEvent(new ErrorEvent('error', { error: wrapperError }));
      const frameless = new TypeError('Frameless plugin failure');
      frameless.stack = 'TypeError: Frameless plugin failure';
      window.dispatchEvent(
        new ErrorEvent('error', {
          error: frameless,
          filename: 'https://example.org/public/plugins/grafana-pathfinder-app/2.js',
          lineno: 12,
          colno: 7,
        })
      );
      window.dispatchEvent(
        new ErrorEvent('error', {
          error: frameless,
          filename: 'https://example.org/public/build/grafana.js',
        })
      );
      expect(transport.items).toHaveLength(2);
      expect(transport.items[1]).toMatchObject({
        type: 'exception',
        payload: {
          type: 'TypeError',
          value: 'Frameless plugin failure',
          stacktrace: {
            frames: [
              {
                filename: 'https://example.org/public/plugins/grafana-pathfinder-app/2.js',
                function: '?',
                lineno: 12,
                colno: 7,
              },
            ],
          },
        },
      });
      expect(transport.items[0]).toMatchObject({ type: 'exception', payload: { value: 'Plugin failure' } });
    } finally {
      faro.instrumentations.remove(instrumentation);
    }
  });
});
