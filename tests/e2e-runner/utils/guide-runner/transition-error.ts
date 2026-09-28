import type { E2ETransitionKind } from '../../../../src/cli/e2e/schemas/e2e-report.schema';

export type FatalTransitionKind = E2ETransitionKind;

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
