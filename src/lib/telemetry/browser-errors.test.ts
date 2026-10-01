import { runInNewContext } from 'node:vm';
import type { API } from '@grafana/faro-web-sdk';
import { PathfinderErrorsInstrumentation } from './browser-errors';

const pushError = jest.fn();
let instrumentation: PathfinderErrorsInstrumentation;

beforeEach(() => {
  pushError.mockReset();
  instrumentation = new PathfinderErrorsInstrumentation();
  instrumentation.api = { pushError } as unknown as API;
  instrumentation.initialize();
});

afterEach(() => instrumentation.destroy());

it('leaves the host error handler intact and never accesses its apply property', () => {
  const original = window.onerror;
  const host = jest.fn();
  Object.defineProperty(host, 'apply', {
    get: () => {
      throw new Error('Permission denied to access property "apply"');
    },
  });
  window.onerror = host;
  try {
    instrumentation.destroy();
    instrumentation.initialize();
    const error = new TypeError('Original failure');
    window.dispatchEvent(new ErrorEvent('error', { error, message: error.message }));
    expect(window.onerror).toBe(host);
    expect(host).toHaveBeenCalledTimes(1);
    expect(pushError).toHaveBeenCalledWith(error, { stackFrames: expect.any(Array) });
    instrumentation.destroy();
    expect(window.onerror).toBe(host);
  } finally {
    window.onerror = original;
  }
});

it('uses the browser filename for stackless errors instead of attributing its own handler stack', () => {
  window.dispatchEvent(
    new ErrorEvent('error', {
      message: 'ResizeObserver loop completed with undelivered notifications.',
      filename: 'https://example.grafana.net/d/status?var-plugin_id=grafana-pathfinder-app',
      lineno: 0,
    })
  );
  expect(pushError).toHaveBeenCalledWith(expect.any(Error), {
    stackFrames: [
      {
        filename: 'https://example.grafana.net/d/status?var-plugin_id=grafana-pathfinder-app',
        function: '?',
        lineno: 0,
        colno: 0,
      },
    ],
  });
});

it('captures unhandled errors without preventing other listeners from receiving them', () => {
  const error = new Error('Rejected');
  const event = new Event('unhandledrejection', { cancelable: true });
  Object.defineProperty(event, 'reason', { value: error });
  window.dispatchEvent(event);
  expect(pushError).toHaveBeenCalledWith(error);
  expect(event.defaultPrevented).toBe(false);
});

it('does not manufacture Pathfinder stacks for primitive rejections or resource errors', () => {
  const event = new Event('unhandledrejection');
  Object.defineProperty(event, 'reason', { value: 'unattributed rejection' });
  window.dispatchEvent(event);
  window.dispatchEvent(new Event('error'));
  expect(pushError).not.toHaveBeenCalled();
});

it('removes both listeners on destruction', () => {
  instrumentation.destroy();
  window.dispatchEvent(new ErrorEvent('error', { error: new Error('Later') }));
  const event = new Event('unhandledrejection');
  Object.defineProperty(event, 'reason', { value: new Error('Later rejection') });
  window.dispatchEvent(event);
  expect(pushError).not.toHaveBeenCalled();
});

it('retains an Error thrown from a different realm', () => {
  const error = runInNewContext('new Error("Cross-realm rejection")') as Error;
  expect(error instanceof Error).toBe(false);
  const event = new Event('unhandledrejection');
  Object.defineProperty(event, 'reason', { value: error });
  window.dispatchEvent(event);
  expect(pushError).toHaveBeenCalledWith(error);
});

it('contains inaccessible error properties without reporting a new error', () => {
  const error = Object.defineProperty({}, 'name', {
    get() {
      throw new Error('Permission denied');
    },
  });
  window.dispatchEvent(new ErrorEvent('error', { error }));
  expect(pushError).not.toHaveBeenCalled();
});

it('uses the source location when an Error has no stack', () => {
  const error = new Error('Stackless');
  error.stack = undefined;
  window.dispatchEvent(
    new ErrorEvent('error', {
      error,
      message: error.message,
      filename: 'https://example.org/public/plugins/grafana-pathfinder-app/1.js',
    })
  );
  expect(pushError).toHaveBeenCalledWith(expect.any(Error), {
    stackFrames: [
      expect.objectContaining({ filename: 'https://example.org/public/plugins/grafana-pathfinder-app/1.js' }),
    ],
  });
});

it.each(['TypeError: Frameless', 'unparseable stack contents'])(
  'uses the source location for a non-empty frameless stack: %s',
  (stack) => {
    const error = new TypeError('Frameless');
    error.stack = stack;
    window.dispatchEvent(
      new ErrorEvent('error', {
        error,
        filename: 'https://example.org/public/plugins/grafana-pathfinder-app/1.js',
        lineno: 12,
        colno: 7,
      })
    );
    expect(pushError).toHaveBeenCalledWith(error, {
      stackFrames: [
        {
          filename: 'https://example.org/public/plugins/grafana-pathfinder-app/1.js',
          function: '?',
          lineno: 12,
          colno: 7,
        },
      ],
    });
  }
);
