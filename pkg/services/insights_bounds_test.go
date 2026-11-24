package services

import (
	"context"
	"errors"
	"testing"
)

func fidelityDrain[T any](ctx context.Context, page func(string) ([]T, string, error)) ([]T, bool, string) {
	return DrainInsights(ctx, page, func(error) bool { return false })
}
func TestLearningInsightsDrainBounds(t *testing.T) {
	calls := 0
	rows, complete, reason := fidelityDrain(context.Background(), func(token string) ([]int, string, error) { calls++; return []int{1}, token + "x", nil })
	if complete || reason != "page-limit" || calls != LearningInsightsMaxPages || len(rows) != calls {
		t.Fatal(calls, reason, rows)
	}
	_, complete, reason = fidelityDrain(context.Background(), func(string) ([]int, string, error) { return make([]int, LearningInsightsMaxItems+1), "", nil })
	if complete || reason != "item-limit" {
		t.Fatal(reason)
	}
	_, complete, reason = fidelityDrain(context.Background(), func(string) ([]int, string, error) { return nil, "same", nil })
	if complete || reason != "pagination-cycle" {
		t.Fatal(reason)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, complete, reason = fidelityDrain(ctx, func(string) ([]int, string, error) { t.Fatal("called canceled page"); return nil, "", nil })
	if complete || reason != "deadline" {
		t.Fatal(reason)
	}
	rows, complete, reason = fidelityDrain(context.Background(), func(token string) ([]int, string, error) {
		if token == "" {
			return []int{7}, "next", nil
		}
		return nil, "", errors.New("failed")
	})
	if complete || reason != "fetch-failed" || len(rows) != 1 {
		t.Fatal(rows, reason)
	}
}
