import { BaseInstrumentation } from '@grafana/faro-web-sdk';

function isErrorLike(value: unknown): value is Error {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof value.name === 'string' &&
    'message' in value &&
    typeof value.message === 'string'
  );
}

export class PathfinderErrorsInstrumentation extends BaseInstrumentation {
  readonly name = 'pathfinder-browser-errors';
  readonly version = '1.0.0';

  private readonly onError = (event: ErrorEvent) => {
    try {
      if (isErrorLike(event.error) && event.error.stack) {
        this.api.pushError(event.error);
      } else if (event.message) {
        this.api.pushError(new Error(event.message), {
          stackFrames: event.filename
            ? [{ filename: event.filename, function: '?', lineno: event.lineno, colno: event.colno }]
            : [],
        });
      }
    } catch {
      // An inaccessible cross-realm error must not cause another browser error.
    }
  };

  private readonly onRejection = (event: PromiseRejectionEvent) => {
    try {
      if (isErrorLike(event.reason)) {
        this.api.pushError(event.reason);
      }
    } catch {
      // An inaccessible cross-realm error must not cause another browser error.
    }
  };

  initialize(): void {
    // Listeners preserve the host's handlers without chaining cross-realm functions.
    window.addEventListener('error', this.onError);
    window.addEventListener('unhandledrejection', this.onRejection);
  }

  destroy(): void {
    window.removeEventListener('error', this.onError);
    window.removeEventListener('unhandledrejection', this.onRejection);
  }
}
