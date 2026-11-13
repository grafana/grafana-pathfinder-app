package services

import (
	"context"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"strings"
	"sync"
	"time"
)

const completionCacheTTL = 5 * time.Minute
const completionForcedRefreshInterval = 30 * time.Second
const completionFailureCooldown = 30 * time.Second
const completionAggregateDeadline = 60 * time.Second

type CompletionIndex struct {
	ByUser           map[string][]CollatedCompletion
	InProgressByUser map[string][]InProgressCompletion
	AsOf             time.Time
}

type completionCacheEntry struct {
	index *CompletionIndex

	stale bool
}

type completionFailure struct {
	at  time.Time
	err error
}

type completionRefreshFlight struct {
	done       chan struct{}
	generation uint64
	index      *CompletionIndex
	err        error
}

type completionCacheStats struct {
	hits            int
	Misses          int
	staleServes     int
	Refreshes       int
	RefreshFailures int
}

var (
	CompletionCacheMu      sync.Mutex
	completionCacheEntries map[string]*completionCacheEntry
	completionFlights      map[string]*completionRefreshFlight
	completionLastForced   map[string]time.Time
	completionLastFailure  map[string]completionFailure
	completionStats        map[string]*completionCacheStats
	CompletionGenerations  map[string]uint64
)

func InitCompletionCache() {
	if completionCacheEntries == nil {
		completionCacheEntries = map[string]*completionCacheEntry{}
	}
	if completionFlights == nil {
		completionFlights = map[string]*completionRefreshFlight{}
	}
	if completionLastForced == nil {
		completionLastForced = map[string]time.Time{}
	}
	if completionLastFailure == nil {
		completionLastFailure = map[string]completionFailure{}
	}
	if completionStats == nil {
		completionStats = map[string]*completionCacheStats{}
	}
	if CompletionGenerations == nil {
		CompletionGenerations = map[string]uint64{}
	}
}

func CompletionStatsFor(namespace string) *completionCacheStats {
	s := completionStats[namespace]
	if s == nil {
		s = &completionCacheStats{}
		completionStats[namespace] = s
	}
	return s
}

func ResetCompletionCache() {
	CompletionCacheMu.Lock()
	defer CompletionCacheMu.Unlock()
	completionCacheEntries = nil
	completionFlights = nil
	completionLastForced = nil
	completionLastFailure = nil
	completionStats = nil
	CompletionGenerations = nil
}

func InvalidateCompletionIndex(namespace string) {
	CompletionCacheMu.Lock()
	defer CompletionCacheMu.Unlock()
	InitCompletionCache()
	invalidateCompletionKey(namespace)
	for key := range completionStats {
		if strings.HasPrefix(key, namespace+"\x00") {
			invalidateCompletionKey(key)
		}
	}
}

func invalidateCompletionKey(key string) {
	CompletionGenerations[key]++
	if entry := completionCacheEntries[key]; entry != nil {
		completionCacheEntries[key] = &completionCacheEntry{index: entry.index, stale: true}
	}
	delete(completionLastFailure, key)
}

func CallerCompletionCacheKey(namespace, subject string) string {
	return namespace + "\x00" + subject
}

func LoadCompletionIndex(ctx context.Context, namespace string, forced bool, logger log.Logger, load func(context.Context) (*CompletionIndex, int, error), now func() time.Time, namespaceGlobal func(error) bool, reason func(error) string) (*CompletionIndex, error) {
	logNamespace, _, _ := strings.Cut(namespace, "\x00")
	CompletionCacheMu.Lock()
	InitCompletionCache()

	entry := completionCacheEntries[namespace]
	stats := CompletionStatsFor(namespace)

	effectiveForced := false
	if forced {
		last, seen := completionLastForced[namespace]
		if !seen || now().Sub(last) >= completionForcedRefreshInterval {
			effectiveForced = true
			completionLastForced[namespace] = now()
		}
	}

	if entry != nil && !entry.stale && !effectiveForced && now().Sub(entry.index.AsOf) < completionCacheTTL {
		stats.hits++
		idx := entry.index
		CompletionCacheMu.Unlock()
		return idx, nil
	}
	stats.Misses++

	if !effectiveForced {
		if fail, ok := completionLastFailure[namespace]; ok && now().Sub(fail.at) < completionFailureCooldown {
			if entry != nil {
				stats.staleServes++
				idx := entry.index
				CompletionCacheMu.Unlock()
				return idx, nil
			}
			err := fail.err
			CompletionCacheMu.Unlock()
			return nil, err
		}
	}

	generation := CompletionGenerations[namespace]
	if fl := completionFlights[namespace]; fl != nil && fl.generation == generation {
		CompletionCacheMu.Unlock()
		select {
		case <-fl.done:
			return fl.index, fl.err
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}

	fl := &completionRefreshFlight{done: make(chan struct{}), generation: generation}
	completionFlights[namespace] = fl
	CompletionCacheMu.Unlock()

	fetchCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), completionAggregateDeadline)
	idx, pages, err := load(fetchCtx)
	cancel()

	CompletionCacheMu.Lock()
	stats = CompletionStatsFor(namespace)
	if CompletionGenerations[namespace] != fl.generation {
		if err == nil {
			stats.Refreshes++
			fl.index = idx
		} else {
			stats.RefreshFailures++
			if entry != nil {
				stats.staleServes++
				fl.index = entry.index
			}
			fl.err = err
		}
		if completionFlights[namespace] == fl {
			delete(completionFlights, namespace)
		}
		CompletionCacheMu.Unlock()
		close(fl.done)
		return fl.index, fl.err
	}
	if err == nil {
		stats.Refreshes++
		if _, hadFailure := completionLastFailure[namespace]; hadFailure {
			logger.Info("completion index recovered", "namespace", logNamespace)
		}
		completionCacheEntries[namespace] = &completionCacheEntry{index: idx}
		delete(completionLastFailure, namespace)
		fl.index = idx
		logger.Debug("completion index refreshed",
			"namespace", logNamespace, "pages", pages, "users", len(idx.ByUser),
			"hits", stats.hits, "misses", stats.Misses,
			"staleServes", stats.staleServes, "refreshFailures", stats.RefreshFailures)
	} else {
		stats.RefreshFailures++
		namespaceGlobal := namespaceGlobal(err)
		if namespaceGlobal {
			completionLastFailure[namespace] = completionFailure{at: now(), err: err}
		}
		logger.Info("completion index refresh failed",
			"namespace", logNamespace, "reason", reason(err),
			"namespaceGlobal", namespaceGlobal, "servingStale", entry != nil,
			"refreshFailures", stats.RefreshFailures)
		if entry != nil {
			stats.staleServes++
			fl.index = entry.index
			fl.err = err
		} else {
			fl.err = err
		}
	}
	if completionFlights[namespace] == fl {
		delete(completionFlights, namespace)
	}
	CompletionCacheMu.Unlock()
	close(fl.done)

	return fl.index, fl.err
}
