package plugin

import (
	"math"
	"sync"
	"time"
)

// Per-user rate limit for /coda/exec.
//
// Defaults are sized for interactive challenge use: bursts of a handful of
// setup commands run sequentially, plus the occasional Check-my-work click.
// A misbehaving frontend (or a hostile one running with a valid Grafana
// session) can't open SSH channels in a tight loop and exhaust resources.
const (
	codaExecRateRefillPerSec = 5.0  // sustained requests per second per user
	codaExecRateBurst        = 10.0 // tokens available immediately
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

// execRateLimiter manages per-user token buckets for /coda/exec. Buckets are
// created lazily on first use and never evicted — memory grows by a small
// constant per distinct caller. Acceptable trade-off for a single-tenant
// plugin instance.
type execRateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*tokenBucket
	now     func() time.Time // injectable for tests
}

func newExecRateLimiter() *execRateLimiter {
	return &execRateLimiter{
		buckets: map[string]*tokenBucket{},
		now:     time.Now,
	}
}

// allow returns (true, 0) if the user's bucket had a token, or
// (false, retryAfter) when the request should be rejected.
func (r *execRateLimiter) allow(user string) (bool, time.Duration) {
	now := r.now()
	r.mu.Lock()
	b, ok := r.buckets[user]
	if !ok {
		b = newTokenBucket(codaExecRateBurst, codaExecRateRefillPerSec, now)
		r.buckets[user] = b
	}
	r.mu.Unlock()
	if b.take(now) {
		return true, 0
	}
	return false, b.retryAfter()
}
