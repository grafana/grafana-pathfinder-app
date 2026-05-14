package plugin

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

func TestTokenBucket(t *testing.T) {
	// Bucket with burst 3, refill 1/sec, anchored to a fixed start time.
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	b := newTokenBucket(3, 1, start)

	// Initial burst — three takes succeed
	for i := 0; i < 3; i++ {
		if !b.take(start) {
			t.Fatalf("take %d should succeed (burst not exhausted)", i+1)
		}
	}
	// Fourth take same instant — bucket empty
	if b.take(start) {
		t.Errorf("4th take at same instant should fail; tokens=%v", b.tokens)
	}

	// 1 second later — one token refilled
	if !b.take(start.Add(time.Second)) {
		t.Errorf("take after 1s refill should succeed")
	}
	if b.take(start.Add(time.Second)) {
		t.Errorf("second take at +1s should fail (only 1 token refilled)")
	}

	// retryAfter when empty should be > 0
	if d := b.retryAfter(); d <= 0 {
		t.Errorf("retryAfter on empty bucket should be > 0, got %v", d)
	}

	// 5 seconds later — bucket fully refilled (capped at burst)
	for i := 0; i < 3; i++ {
		if !b.take(start.Add(6 * time.Second)) {
			t.Errorf("take %d after long idle should succeed (refill capped at burst)", i+1)
		}
	}
}

func TestExecRateLimiter_IndependentBuckets(t *testing.T) {
	rl := newExecRateLimiter()
	// Force a deterministic clock: every call returns the same instant so
	// no refill happens.
	frozen := time.Now()
	rl.now = func() time.Time { return frozen }

	// Drain alice's bucket — 10 succeeds, 11th fails.
	for i := 0; i < int(codaExecRateBurst); i++ {
		if ok, _ := rl.allow("alice"); !ok {
			t.Fatalf("alice take %d should succeed", i+1)
		}
	}
	if ok, retry := rl.allow("alice"); ok {
		t.Errorf("alice should now be rate limited")
	} else if retry <= 0 {
		t.Errorf("retryAfter for limited user should be > 0, got %v", retry)
	}

	// bob has his own bucket — first take must succeed.
	if ok, _ := rl.allow("bob"); !ok {
		t.Errorf("bob's bucket should be independent of alice's")
	}
}

func TestHandleCodaExec_RateLimit(t *testing.T) {
	app := newExecApp()
	app.execRateLimiter = newExecRateLimiter()
	frozen := time.Now()
	app.execRateLimiter.now = func() time.Time { return frozen }

	// Burst worth of calls should all 409 (no session) — not 429.
	for i := 0; i < int(codaExecRateBurst); i++ {
		req := httptest.NewRequest(http.MethodPost, "/coda/exec", strings.NewReader(`{"command":"true"}`))
		req.Header.Set("Content-Type", "application/json")
		req = req.WithContext(backend.WithPluginContext(req.Context(),
			backend.PluginContext{User: &backend.User{Login: "alice"}}))
		rr := httptest.NewRecorder()
		app.handleCodaExec(rr, req)
		if rr.Code != http.StatusConflict {
			t.Fatalf("burst call %d: got %d, want %d", i+1, rr.Code, http.StatusConflict)
		}
	}

	// One more — bucket empty, should return 429 with Retry-After header.
	req := httptest.NewRequest(http.MethodPost, "/coda/exec", strings.NewReader(`{"command":"true"}`))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(backend.WithPluginContext(req.Context(),
		backend.PluginContext{User: &backend.User{Login: "alice"}}))
	rr := httptest.NewRecorder()
	app.handleCodaExec(rr, req)
	if rr.Code != http.StatusTooManyRequests {
		t.Errorf("over-limit call: got %d, want %d", rr.Code, http.StatusTooManyRequests)
	}
	if rr.Header().Get("Retry-After") == "" {
		t.Error("over-limit response missing Retry-After header")
	}
}
