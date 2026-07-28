/**
 * A docs link captured from an intercepted navigation event, queued for the
 * sidebar to open. Lives in Tier 0 so the link-interception state manager and
 * its event-parsing helpers can share the shape without importing each other
 * (which would form an import cycle).
 */
export interface QueuedDocsLink {
  url: string;
  title: string;
  timestamp: number;
  /**
   * Opaque key redeeming a prepared (one-fetch) launch payload from the
   * module-owned `guideLaunchStore`. The queue is writable by any same-page
   * script, so the payload itself never rides it — only this key, which the
   * auto-open listener redeems at the trusted boundary (a forged or stale
   * key falls back to a normal fetch).
   */
  launchKey?: string;
}
