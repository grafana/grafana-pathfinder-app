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
}
