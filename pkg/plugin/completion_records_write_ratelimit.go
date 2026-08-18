package plugin

import (
	"math"
	"sync"
	"time"
)

// tokenBucket is a single-user token bucket. Thread-safe.
type tokenBucket struct {
	mu           sync.Mutex
	tokens       float64
	maxTokens    float64
	refillPerSec float64
	lastRefill   time.Time
}

func newTokenBucket(burst, refillPerSec float64, now time.Time) *tokenBucket {
	return &tokenBucket{
		tokens:       burst,
		maxTokens:    burst,
		refillPerSec: refillPerSec,
		lastRefill:   now,
	}
}

// take attempts to consume one token. Returns true if successful, false if
// the bucket is empty (request should be rejected).
func (b *tokenBucket) take(now time.Time) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	elapsed := now.Sub(b.lastRefill).Seconds()
	if elapsed > 0 {
		b.tokens = math.Min(b.maxTokens, b.tokens+elapsed*b.refillPerSec)
		b.lastRefill = now
	}
	if b.tokens >= 1 {
		b.tokens--
		return true
	}
	return false
}

// retryAfter returns how long the caller should wait before the bucket has at
// least one token. Should only be called when take() returned false.
func (b *tokenBucket) retryAfter() time.Duration {
	b.mu.Lock()
	defer b.mu.Unlock()
	deficit := 1 - b.tokens
	if deficit <= 0 {
		return 0
	}
	seconds := deficit / b.refillPerSec
	return time.Duration(math.Ceil(seconds*1000)) * time.Millisecond
}

// Per-user rate limit for POST /completion-records (RFC §9 flood guard).
//
// Completions are user-paced and infrequent, so this limit only needs to stop a
// misbehaving (or hostile, running with a valid Grafana session) client from
// hammering the write path in a tight loop. Sized generously for a legitimate
// burst — an offline retry queue draining several buffered completions on
// reconnect — while still capping sustained abuse.
const (
	completionWriteRateRefillPerSec = 1.0  // sustained writes per second per user
	completionWriteRateBurst        = 20.0 // buffered completions drainable at once
)

// completionWriteRateLimiter manages per-user token buckets for the write path.
// Buckets are created lazily and never evicted — memory grows by a small
// constant per distinct caller, acceptable for a single-tenant plugin instance.
//
// Time is read through the package-wide timeNow seam (the repository's single
// clock invariant), so a test that freezes/advances timeNow drives refill and
// Retry-After deterministically — the handler's validation clock and the
// limiter's clock never diverge.
type completionWriteRateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*tokenBucket
}

func newCompletionWriteRateLimiter() *completionWriteRateLimiter {
	return &completionWriteRateLimiter{
		buckets: map[string]*tokenBucket{},
	}
}

// allow returns (true, 0) if the user's bucket had a token, or
// (false, retryAfter) when the request should be rejected.
func (r *completionWriteRateLimiter) allow(user string) (bool, time.Duration) {
	now := timeNow()
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
