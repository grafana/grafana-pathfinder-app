import { DeadlineExceededError, runWithDeadline } from './deadline';

describe('runWithDeadline', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('aborts and cancels a hanging operation', async () => {
    const cancel = jest.fn();
    let observedAbort = false;
    const result = runWithDeadline({
      timeoutMs: 100,
      message: 'step timed out',
      operation: (signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            observedAbort = true;
            reject(signal.reason);
          });
        }),
      cancel,
    });
    const rejection = expect(result).rejects.toMatchObject<Partial<DeadlineExceededError>>({
      code: 'STEP_TIMEOUT',
    });

    await jest.advanceTimersByTimeAsync(100);

    await rejection;
    expect(observedAbort).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('handles a late rejection after timeout without an unhandled rejection', async () => {
    let rejectOperation!: (error: Error) => void;
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const result = runWithDeadline({
        timeoutMs: 100,
        message: 'step timed out',
        operation: () =>
          new Promise<void>((_resolve, reject) => {
            rejectOperation = reject;
          }),
        cancel: () => undefined,
      });
      const rejection = expect(result).rejects.toMatchObject({ code: 'STEP_TIMEOUT' });

      await jest.advanceTimersByTimeAsync(100);
      await rejection;
      rejectOperation(new Error('late operation failure'));
      await Promise.resolve();

      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
