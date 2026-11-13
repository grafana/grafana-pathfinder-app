package services

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func TestCompletionCacheCarryover(t *testing.T) {
	ResetCompletionCache()
	t.Cleanup(ResetCompletionCache)
	now := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	calls := 0
	outage := false
	load := func(context.Context) (*CompletionIndex, int, error) {
		calls++
		if outage {
			return nil, 0, errors.New("outage")
		}
		return &CompletionIndex{AsOf: now}, 1, nil
	}
	read := func(key string, forced bool) (*CompletionIndex, error) {
		return LoadCompletionIndex(context.Background(), key, forced, log.DefaultLogger, load, func() time.Time { return now }, func(error) bool { return true }, func(error) string { return "outage" })
	}
	key := CallerCompletionCacheKey("default", "user:1")
	first, err := read(key, false)
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(4 * time.Minute)
	if got, err := read(key, false); err != nil || got != first || calls != 1 {
		t.Fatal("cache did not retain TTL")
	}
	now = now.Add(time.Minute)
	if _, err := read(key, false); err != nil || calls != 2 {
		t.Fatal("TTL boundary did not refresh")
	}
	if _, err := read(key, true); err != nil || calls != 3 {
		t.Fatal("forced refresh failed")
	}
	if _, err := read(key, true); err != nil || calls != 3 {
		t.Fatal("forced refresh was not limited")
	}
	now = now.Add(30 * time.Second)
	if _, err := read(key, true); err != nil || calls != 4 {
		t.Fatal("forced refresh did not resume")
	}
	InvalidateCompletionIndex("default")
	outage = true
	stale, err := read(key, false)
	if err == nil || stale == nil || calls != 5 {
		t.Fatal("invalidation discarded stale fallback")
	}
	if got, _ := read(key, false); got != stale || calls != 5 {
		t.Fatal("outage cooldown failed")
	}
	if _, err := read(CallerCompletionCacheKey("default", "user:2"), false); err == nil || calls != 6 {
		t.Fatal("caller failure leaked")
	}
	now = now.Add(30 * time.Second)
	outage = false
	if _, err := read(key, false); err != nil || calls != 7 {
		t.Fatal("cooldown did not recover")
	}
}

func TestCompletionCacheInvalidationFencesFlight(t *testing.T) {
	ResetCompletionCache()
	t.Cleanup(ResetCompletionCache)
	key := CallerCompletionCacheKey("default", "user:1")
	started := make(chan struct{})
	release := make(chan struct{})
	done := make(chan struct{})
	old := &CompletionIndex{AsOf: time.Now()}
	fresh := &CompletionIndex{AsOf: time.Now().Add(time.Second)}
	var calls atomic.Int32
	loader := func(context.Context) (*CompletionIndex, int, error) {
		if calls.Add(1) == 1 {
			close(started)
			<-release
			return old, 1, nil
		}
		return fresh, 1, nil
	}
	read := func() *CompletionIndex {
		idx, err := LoadCompletionIndex(context.Background(), key, false, log.DefaultLogger, loader, time.Now, func(error) bool { return true }, func(error) string { return "" })
		if err != nil {
			t.Error(err)
		}
		return idx
	}
	go func() { defer close(done); read() }()
	<-started
	InvalidateCompletionIndex("default")
	if read() != fresh {
		t.Fatal("new generation joined invalidated flight")
	}
	close(release)
	<-done
	if read() != fresh || calls.Load() != 2 {
		t.Fatal("old flight overwrote new generation")
	}
}

func TestCompletionCacheSingleflightAndCancelledWaiter(t *testing.T) {
	ResetCompletionCache()
	t.Cleanup(ResetCompletionCache)
	started := make(chan struct{})
	release := make(chan struct{})
	done := make(chan struct{})
	var calls atomic.Int32
	loader := func(context.Context) (*CompletionIndex, int, error) {
		calls.Add(1)
		close(started)
		<-release
		return &CompletionIndex{AsOf: time.Now()}, 1, nil
	}
	read := func(ctx context.Context) (*CompletionIndex, error) {
		return LoadCompletionIndex(ctx, "one", false, log.DefaultLogger, loader, time.Now, func(error) bool { return true }, func(error) string { return "" })
	}
	go func() { defer close(done); _, _ = read(context.Background()) }()
	<-started
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := read(ctx); !errors.Is(err, context.Canceled) {
		t.Fatal("waiter cancellation ignored")
	}
	close(release)
	<-done
	if _, err := read(context.Background()); err != nil || calls.Load() != 1 {
		t.Fatal("single flight duplicated load")
	}
}
