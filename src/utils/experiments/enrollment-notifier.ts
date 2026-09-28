/**
 * "An experiment arm just resolved" — subscribers, so no enroller has to know who
 * cares.
 *
 * Two things listen. The Faro session stamper, because `initFaro` stamps the
 * cohorts before any arm is known; importing it from an enroller would be wrong
 * even dynamically, since `lib/telemetry/session` statically pulls in the Faro
 * adapter and the import would download the telemetry chunk on stacks where
 * `pathfinder.frontend-telemetry` is off. `module.tsx` subscribes it from inside
 * its telemetry block instead, so a skipped block subscribes nothing. And the
 * banner, via `useSyncExternalStore`, so it can read the arm rather than enroll.
 *
 * Deliberately importless: every experiment module calls into this one, so any
 * import here is a cycle waiting to happen.
 */

const subscribers = new Set<() => void>();

export function subscribeToEnrollment(onChange: () => void): () => void {
  subscribers.add(onChange);
  return () => {
    subscribers.delete(onChange);
  };
}

export function notifyEnrollment(): void {
  // Snapshotted so a subscriber that unsubscribes mid-notification cannot skip a
  // later one, and wrapped individually so one throwing sink cannot starve the rest
  // or fail the enrollment that triggered it.
  for (const onChange of [...subscribers]) {
    try {
      onChange();
    } catch {
      // A listener's problem is not enrollment's problem.
    }
  }
}
