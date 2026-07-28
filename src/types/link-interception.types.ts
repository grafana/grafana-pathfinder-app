import type { RawContent } from './content.types';
import type { PackageOpenInfo } from './content-panel.types';

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
   * Content already fetched + snippet-expanded by `prepareGuideLaunch`, carried
   * through the cold-sidebar open queue so the tab renders without a second
   * fetch (one-fetch launch). One-shot memory state — the queue is never
   * persisted, so this never reaches storage.
   */
  preparedContent?: RawContent;
  /**
   * Package context derived by `prepareGuideLaunch`, carried through the queue
   * so a package-backed guide keeps its milestone toolbar / package render type
   * on the cold-sidebar path (the destination loader skips re-derivation for
   * prefetched launches). One-shot memory state — never persisted.
   */
  packageInfo?: PackageOpenInfo;
}
