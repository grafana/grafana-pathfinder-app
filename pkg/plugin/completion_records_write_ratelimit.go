package plugin

import (
	"sync"
	"time"
)

// Per-user rate limit for POST /completion-records (RFC §9 flood guard).
//
// Completions are user-paced and infrequent, so this limit only needs to stop a
// misbehaving (or hostile, running with a valid Grafana session) client from
// hammering the write path in a tight loop. Sized generously for a legitimate
// burst — an offline retry queue draining several buffered completions on
// reconnect — while still capping sustained abuse. Mirrors the token-bucket
// shape of execRateLimiter (coda_exec_ratelimit.go), kept as a separate limiter
// so completion-write tuning stays independent of /coda/exec.
const (
	completionWriteRateRefillPerSec = 1.0  // sustained writes per second per user
	completionWriteRateBurst        = 20.0 // buffered completions drainable at once
)

// completionWriteRateLimiter manages per-user token buckets for the write path.
// Buckets are created lazily and never evicted — memory grows by a small
// constant per distinct caller, acceptable for a single-tenant plugin instance.
type completionWriteRateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*tokenBucket
	now     func() time.Time // injectable for tests
}

func newCompletionWriteRateLimiter() *completionWriteRateLimiter {
	return &completionWriteRateLimiter{
		buckets: map[string]*tokenBucket{},
		now:     time.Now,
	}
}

// allow returns (true, 0) if the user's bucket had a token, or
// (false, retryAfter) when the request should be rejected.
func (r *completionWriteRateLimiter) allow(user string) (bool, time.Duration) {
	now := r.now()
	r.mu.Lock()
	b, ok := r.buckets[user]
	if !ok {
		b = newTokenBucket(completionWriteRateBurst, completionWriteRateRefillPerSec, now)
		r.buckets[user] = b
	}
	r.mu.Unlock()
	if b.take(now) {
		return true, 0
	}
	return false, b.retryAfter()
}
