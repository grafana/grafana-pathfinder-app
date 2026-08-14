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
}

export async function runWithDeadline<T>(options: DeadlineOptions<T>): Promise<T> {
  const controller = new AbortController();
  let rejectDeadline!: (error: DeadlineExceededError) => void;
  const deadline = new Promise<never>((_, reject) => {
    rejectDeadline = reject;
  });
  const operation = Promise.resolve().then(() => options.operation(controller.signal));
  operation.catch(() => undefined);

  const timer = setTimeout(() => {
    const error = new DeadlineExceededError('STEP_TIMEOUT', options.timeoutMs, options.message);
    rejectDeadline(error);
    controller.abort(error);
    Promise.resolve(options.cancel(error)).catch(() => undefined);
  }, options.timeoutMs);

  try {
    return await Promise.race([operation, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
