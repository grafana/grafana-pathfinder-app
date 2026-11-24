package plugin

import (
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	"math"
	"net/http"
	"strconv"
	"time"
)

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

type userRateLimiter struct{ *services.UserRateLimiter }

func newUserRateLimiter(burst, refillPerSec float64) *userRateLimiter {
	return &userRateLimiter{services.NewUserRateLimiter(burst, refillPerSec, func() time.Time { return timeNow() })}
}
func newCompletionWriteRateLimiter() *userRateLimiter {
	return newUserRateLimiter(completionWriteRateBurst, completionWriteRateRefillPerSec)
}
func (r *userRateLimiter) allow(user string) (bool, time.Duration) { return r.Allow(user) }

// writeRateLimited answers 429 with a Retry-After rounded up to whole seconds.
func (a *App) writeRateLimited(w http.ResponseWriter, retryAfter time.Duration) {
	w.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(retryAfter.Seconds()))))
	a.writeError(w, "rate-limited", http.StatusTooManyRequests)
}
