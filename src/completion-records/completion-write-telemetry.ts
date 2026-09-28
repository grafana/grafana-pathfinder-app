import type { CompletionWriteDegradation } from '../lib/telemetry/types';

export type { CompletionWriteDegradation };

/**
 * Emit the typed, low-cardinality route-degradation event for the durable
 * completion-write path. Lazily requires the telemetry facade — same reason as
 * `lib/logging`'s Faro bridge: an eager import would pull the telemetry package
 * into the entry bundle. Best-effort and never throws on the completion path.
 */
export function reportCompletionWriteDegradation(reason: CompletionWriteDegradation): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    const facade = require('../lib/telemetry/facade') as typeof import('../lib/telemetry/facade');
    facade.recordCompletionWriteDegradation(reason);
  } catch {
    // Telemetry is best-effort; a missing/failed facade must not break writes.
  }
}
