/**
 * Async utility functions for consistent promise-based operations
 */

/**
 * Promise-based sleep/delay utility
 *
 * @param ms - Duration to wait in milliseconds
 * @returns Promise that resolves after the specified duration
 *
 * @example
 * // Wait for 500ms
 * await sleep(500);
 *
 * // Use with config values
 * await sleep(INTERACTIVE_CONFIG.delays.perceptual.base);
 */
export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Execute a promise with a timeout
 *
 * @param promise - The promise to execute
 * @param timeoutMs - Maximum time to wait in milliseconds
 * @param errorMessage - Optional error message for timeout
 * @returns Promise that resolves with the result or rejects on timeout
 *
 * @example
 * const result = await withTimeout(fetchData(), 5000, 'Data fetch timed out');
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage = 'Operation timed out'
): Promise<T> {
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
}

/**
 * Retry an async operation with configurable attempts and delay
 *
 * @param operation - The async operation to retry
 * @param maxRetries - Maximum number of retry attempts
 * @param retryDelay - Delay between retries in milliseconds
 * @param shouldRetry - Optional predicate to determine if retry should happen
 * @returns Promise that resolves with the result or rejects after all retries
 *
 * @example
 * const data = await retry(
 *   () => fetchData(),
 *   3,
 *   1000,
 *   (error) => error.message !== 'Auth failed' // Don't retry auth failures
 * );
 */
/**
 * Wait for React state updates to complete before proceeding.
 * Uses a double requestAnimationFrame to ensure we're past React's update cycle,
 * so DOM changes from React state updates have been applied.
 */
export function waitForReactUpdates(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });
}

export async function retry<T>(
  operation: () => Promise<T>,
  maxRetries: number,
  retryDelay: number,
  shouldRetry?: (error: unknown) => boolean
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (shouldRetry && !shouldRetry(error)) {
        throw error;
      }

      // Don't delay after the last attempt
      if (attempt < maxRetries) {
        await sleep(retryDelay);
      }
    }
  }

  throw lastError;
}
