export const EXIT_OK = 0;
export const EXIT_FAILED_RESULT = 1;
export const EXIT_USAGE = 2;
export const EXIT_RUNTIME = 3;

export class ConcernsError extends Error {
  constructor(message, exitCode = EXIT_USAGE) {
    super(message);
    this.name = 'ConcernsError';
    this.exitCode = exitCode;
  }
}

export function usageError(message) {
  return new ConcernsError(message, EXIT_USAGE);
}

export function runtimeError(message) {
  return new ConcernsError(message, EXIT_RUNTIME);
}
