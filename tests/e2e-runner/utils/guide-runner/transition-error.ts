export type FatalTransitionKind =
  'badge-obstruction' | 'guide-load-ambiguous' | 'reset-ambiguous' | 'tab-close-failed' | 'step-detach-failed';

export class FatalTransitionError extends Error {
  constructor(
    public readonly kind: FatalTransitionKind,
    message: string
  ) {
    super(message);
    this.name = 'FatalTransitionError';
  }
}

export function isFatalTransitionError(error: unknown): error is FatalTransitionError {
  return error instanceof FatalTransitionError;
}
