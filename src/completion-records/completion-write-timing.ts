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
 * Bound on a single write request. Deliberately a full 10s under the lease TTL
 * so an in-flight POST can never outlive the lease that authorizes it — if it
 * could, another tab would acquire the expired lease and re-POST the same item
 * while the first request is still open (the double-write hazard). The stable
 * idempotency key is the end-to-end backstop; this timeout keeps a single POST
 * inside one lease.
 */
export const WRITE_REQUEST_TIMEOUT_MS = LEASE_TTL_MS - 10_000;
