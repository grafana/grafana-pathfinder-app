/**
 * Shared timing constants for the durable completion-write path.
 *
 * Kept in a dependency-free leaf so both the write client and the queue storage
 * can couple to them without importing each other (which would form a cycle
 * with storage's type import of the client body).
 */

/** How long a drain lease is held before another tab may take it over. */
export const LEASE_TTL_MS = 30_000;

/**
 * Longest a queued fact is retained before it is dropped locally. Matches the
 * backend's 30-day `completedAt` acceptance horizon: past it, the backend would
 * terminally reject the replay, so retaining it only wastes queue space. The
 * drop is surfaced (warn + degradation event) rather than silent.
 */
export const MAX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Max records POSTed per leased drain pass. The lease is released between passes
 * so one tab with a full queue cannot hold it for the worst-case
 * `maxSize × WRITE_REQUEST_TIMEOUT_MS` (~33 min); remaining due items drain on
 * the immediately-rescheduled next pass.
 */
export const DRAIN_BUDGET_PER_PASS = 10;

/**
 * Bound on a single write request. Deliberately a full 10s under the lease TTL
 * so the client stops awaiting a POST before the lease expires, keeping the
 * in-flight window inside one lease and shrinking the chance another tab takes
 * over and re-POSTs mid-flight. It cannot prove the server stopped processing —
 * the stable idempotency key is the real end-to-end backstop (a re-POST dedupes
 * to one durable record).
 */
export const WRITE_REQUEST_TIMEOUT_MS = LEASE_TTL_MS - 10_000;
