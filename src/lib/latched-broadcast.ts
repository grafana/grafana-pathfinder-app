// A tiny pub/sub channel that latches the last value when nobody is subscribed,
// so a consumer that attaches shortly after an emit still receives it once.
// Decouples producers from late-mounting (e.g. lazy-loaded) consumers without
// losing the event. A TTL bounds the latch so a stale value can't be delivered
// to a subscriber that attaches much later.

export interface LatchedBroadcast<T> {
  emit(detail: T): void;
  subscribe(handler: (detail: T) => void): () => void;
}

const DEFAULT_TTL_MS = 30_000;

export function createLatchedBroadcast<T>(opts: { ttlMs?: number } = {}): LatchedBroadcast<T> {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const subscribers = new Set<(detail: T) => void>();
  let latched: { detail: T; at: number } | null = null;

  return {
    emit(detail: T): void {
      if (subscribers.size > 0) {
        latched = null;
        for (const handler of [...subscribers]) {
          handler(detail);
        }
        return;
      }
      latched = { detail, at: Date.now() };
    },

    subscribe(handler: (detail: T) => void): () => void {
      subscribers.add(handler);
      if (latched && Date.now() - latched.at <= ttlMs) {
        const { detail } = latched;
        latched = null;
        handler(detail);
      }
      return () => {
        subscribers.delete(handler);
      };
    },
  };
}
