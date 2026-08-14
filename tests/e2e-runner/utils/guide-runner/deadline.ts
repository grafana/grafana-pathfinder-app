export class DeadlineExceededError extends Error {
  constructor(
    readonly code: 'STEP_TIMEOUT',
    readonly timeoutMs: number,
    message: string
  ) {
    super(message);
    this.name = 'DeadlineExceededError';
  }
}

export interface DeadlineOptions<T> {
  timeoutMs: number;
  operation(signal: AbortSignal): Promise<T>;
  cancel(reason: DeadlineExceededError): void | Promise<void>;
  message: string;
  cancelTimeoutMs?: number;
}

export async function runWithDeadline<T>(options: DeadlineOptions<T>): Promise<T> {
  const controller = new AbortController();
  const cancelTimeoutMs = options.cancelTimeoutMs ?? 5000;
  return new Promise<T>((resolve, reject) => {
    let state: 'active' | 'deadline' | 'settled' = 'active';
    const operation = Promise.resolve().then(() => options.operation(controller.signal));
    const timer = setTimeout(() => {
      if (state !== 'active') {
        return;
      }
      state = 'deadline';
      const error = new DeadlineExceededError('STEP_TIMEOUT', options.timeoutMs, options.message);
      controller.abort(error);
      let cancelTimer: ReturnType<typeof setTimeout> | undefined;
      const cancellation = Promise.resolve()
        .then(() => options.cancel(error))
        .then(
          () => undefined,
          () => undefined
        );
      const boundedCancellation = Promise.race([
        cancellation,
        new Promise<void>((finish) => {
          cancelTimer = setTimeout(finish, cancelTimeoutMs);
        }),
      ]);
      void boundedCancellation.then(() => {
        if (cancelTimer) {
          clearTimeout(cancelTimer);
        }
        if (state === 'deadline') {
          state = 'settled';
          reject(error);
        }
      });
    }, options.timeoutMs);

    operation.then(
      (value) => {
        if (state === 'active') {
          state = 'settled';
          clearTimeout(timer);
          resolve(value);
        }
      },
      (error) => {
        if (state === 'active') {
          state = 'settled';
          clearTimeout(timer);
          reject(error);
        }
      }
    );
  });
}
