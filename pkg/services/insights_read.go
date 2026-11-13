package services

import (
	"context"
	"errors"
	"net/url"
	"time"
)

const (
	LearningInsightsMaxPages = 20
	LearningInsightsMaxItems = 10000
)

func LearningInsightsPeriod(query url.Values, now time.Time) (time.Time, time.Time, error) {
	now = now.UTC()
	to := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	from := to.AddDate(0, 0, -28)
	var err error
	if raw := query.Get("from"); raw != "" {
		from, err = time.Parse(time.RFC3339Nano, raw)
		if err != nil {
			return from, to, err
		}
	}
	if raw := query.Get("to"); raw != "" {
		to, err = time.Parse(time.RFC3339Nano, raw)
		if err != nil {
			return from, to, err
		}
	}
	if !from.Before(to) {
		return from, to, errors.New("invalid period")
	}
	return from.UTC(), to.UTC(), nil
}

func DrainInsights[T any](ctx context.Context, page func(string) ([]T, string, error), terminal func(error) bool) ([]T, bool, string) {
	out := []T{}
	token := ""
	seen := map[string]bool{}
	for n := 0; n < LearningInsightsMaxPages; n++ {
		if ctx.Err() != nil {
			return out, false, "deadline"
		}
		rows, next, err := page(token)
		if err != nil {
			if ctx.Err() != nil {
				return out, false, "deadline"
			}
			if terminal(err) {
				return out, false, "unsupported"
			}
			return out, false, "fetch-failed"
		}
		remaining := LearningInsightsMaxItems - len(out)
		if len(rows) > remaining {
			return append(out, rows[:remaining]...), false, "item-limit"
		}
		out = append(out, rows...)
		if next == "" {
			return out, true, ""
		}
		if len(out) == LearningInsightsMaxItems {
			return out, false, "item-limit"
		}
		if seen[next] {
			return out, false, "pagination-cycle"
		}
		seen[next], token = true, next
	}
	return out, false, "page-limit"
}
