const RETRY_DELAYS_MS = [1_000, 5_000, 30_000];

function waitForRetry(delay: number): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      window.removeEventListener('online', finish);
      resolve();
    };
    const timer = setTimeout(finish, delay);
    window.addEventListener('online', finish, { once: true });
  });
}

export async function retryChunkImport<T>(load: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await load();
    } catch (error) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (!(error instanceof Error) || error.name !== 'ChunkLoadError' || delay === undefined) {
        throw error;
      }
      await waitForRetry(delay);
    }
  }
}
