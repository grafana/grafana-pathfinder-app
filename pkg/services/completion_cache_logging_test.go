package services

import (
	"context"
	"errors"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"testing"
	"time"
)

type cacheLogCapture struct {
	log.Logger
	entries []map[string]any
}

func (logger *cacheLogCapture) Info(message string, args ...any)  { logger.capture(message, args...) }
func (logger *cacheLogCapture) Debug(message string, args ...any) { logger.capture(message, args...) }
func (logger *cacheLogCapture) capture(message string, args ...any) {
	entry := map[string]any{"message": message}
	for i := 0; i+1 < len(args); i += 2 {
		entry[args[i].(string)] = args[i+1]
	}
	logger.entries = append(logger.entries, entry)
}

func TestCompletionCacheLogsNamespaceWithoutCallerAndStableFields(t *testing.T) {
	ResetCompletionCache()
	t.Cleanup(ResetCompletionCache)
	logger := &cacheLogCapture{Logger: log.NewNullLogger()}
	now := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	key := CallerCompletionCacheKey("stacks-1", "user:private-subject")
	load := func(failed bool) {
		_, _ = LoadCompletionIndex(context.Background(), key, false, logger, func(context.Context) (*CompletionIndex, int, error) {
			if failed {
				return nil, 0, errors.New("outage")
			}
			return &CompletionIndex{AsOf: now}, 1, nil
		}, func() time.Time { return now }, func(error) bool { return true }, func(error) string { return "http-error" })
	}
	load(true)
	now = now.Add(30 * time.Second)
	load(false)
	if len(logger.entries) != 3 {
		t.Fatalf("logs=%v", logger.entries)
	}
	for _, entry := range logger.entries {
		if entry["namespace"] != "stacks-1" {
			t.Fatalf("logged caller cache key: %v", entry)
		}
		if _, ok := entry["RefreshFailures"]; ok {
			t.Fatal("changed legacy log field casing")
		}
	}
	if logger.entries[0]["reason"] != "http-error" || logger.entries[0]["refreshFailures"] != 1 {
		t.Fatalf("failure fields=%v", logger.entries[0])
	}
	if _, ok := logger.entries[2]["misses"]; !ok {
		t.Fatalf("missing legacy misses field: %v", logger.entries[2])
	}
}
